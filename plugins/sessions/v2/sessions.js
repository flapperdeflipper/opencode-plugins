// Read-only access to past OpenCode sessions: sessions_list + sessions_get.
//
// OpenCode 2 plugin API: the default export is a definition with an id and a
// setup function. OpenCode 2.0.x does not expose session listing on the plugin
// context (ctx.session.list arrived in 2.1), so sessions_list prefers the
// native API when present and otherwise reads the local OpenCode database
// read-only. sessions_get always uses the public ctx.session API.
import { homedir } from "node:os"
import { join } from "node:path"

const MAX_LIST = 50
const MAX_MESSAGES = 200
const TEXT_LIMIT = 2000
const TITLE_LIMIT = 90
const LIST_LIMIT = 1000
const LIST_PAGE_SIZE = 200
const LIST_MAX_PAGES = 20

const cut = (s, n) => (s.length > n ? s.slice(0, n) + "…" : s)
const fmtTime = (ms) => (typeof ms === "number" ? new Date(ms).toISOString() : String(ms ?? ""))

function modelLabel(model) {
  if (!model) return "?"
  let value = model
  if (typeof value === "string") {
    try {
      value = JSON.parse(value)
    } catch {
      return value
    }
  }
  const id = value.id ?? value.modelID
  if (!id) return "?"
  return value.providerID ? `${value.providerID}/${id}` : id
}

function dataHome() {
  return process.env.XDG_DATA_HOME || join(homedir(), ".local", "share")
}

function sessionDbPath() {
  return join(dataHome(), "opencode", "opencode.db")
}

async function readSessionRows() {
  const dbPath = sessionDbPath()
  const sql =
    "SELECT id, title, directory, model, time_updated FROM session_v2 " +
    "WHERE parent_id IS NULL ORDER BY time_updated DESC LIMIT " +
    LIST_LIMIT
  try {
    if (typeof Bun !== "undefined") {
      const { Database } = await import("bun:sqlite")
      const db = new Database(dbPath, { readonly: true })
      try {
        return db.query(sql).all()
      } finally {
        db.close()
      }
    }
    const { DatabaseSync } = await import("node:sqlite")
    const db = new DatabaseSync(dbPath, { readOnly: true })
    try {
      return db.prepare(sql).all()
    } finally {
      db.close()
    }
  } catch (error) {
    throw new Error(`cannot read ${dbPath}: ${error.message}`)
  }
}

// Normalizes native Session.Info and database rows to one shape.
function normalize(row) {
  return {
    id: row.id,
    title: row.title,
    directory: row.location?.directory ?? row.directory ?? "",
    model: row.model,
    updated: row.time?.updated ?? row.time_updated ?? 0,
  }
}

async function listSessions(ctx) {
  if (typeof ctx.session.list === "function") {
    const all = []
    let cursor
    for (let page = 0; page < LIST_MAX_PAGES && all.length < LIST_LIMIT; page++) {
      const response = await ctx.session.list({
        limit: LIST_PAGE_SIZE,
        ...(cursor ? { cursor } : {}),
      })
      const items = Array.isArray(response) ? response : response.data ?? []
      for (const item of items) {
        all.push(normalize(item))
        if (all.length >= LIST_LIMIT) break
      }
      cursor = Array.isArray(response) ? undefined : response.cursor?.next
      if (!cursor) break
    }
    return all
  }
  return (await readSessionRows()).map(normalize)
}

function partToText(part) {
  if (part.type === "text") return part.text ?? ""
  if (part.type === "tool") return `[tool: ${part.name ?? "unknown"}]`
  if (part.type === "reasoning") return ""
  return ""
}

function messageBody(message) {
  if (message.type === "user" || message.type === "synthetic" || message.type === "system" || message.type === "skill") {
    return message.text ?? ""
  }
  if (message.type === "assistant") {
    return (message.content ?? [])
      .map(partToText)
      .filter(Boolean)
      .join("\n")
  }
  if (message.type === "shell") return `[shell: ${message.command ?? "unknown"}]`
  if (message.type === "compaction") return "[compaction]"
  return ""
}

export default {
  id: "sessions",
  async setup(ctx) {
    await ctx.tool.transform((editor) => {
      editor.add({
        name: "sessions_list",
        description:
          "List previous opencode sessions on this machine (id, title, model, last update, directory). " +
          "Use sessions_get with an id for the transcript. Useful for finding what was done or decided earlier.",
        input: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Case-insensitive substring matched against session title and directory",
            },
            limit: {
              type: "integer",
              minimum: 1,
              maximum: MAX_LIST,
              description: `Maximum sessions to return (default 20, max ${MAX_LIST})`,
            },
          },
          additionalProperties: false,
        },
        async execute(input, context) {
          let all
          try {
            all = await listSessions(ctx)
          } catch (error) {
            return { content: `sessions_list unavailable: ${error.message}` }
          }
          const q = (input.query ?? "").toLowerCase()
          const filtered = all.filter(
            (s) => !q || `${s.title ?? ""} ${s.directory ?? ""}`.toLowerCase().includes(q)
          )
          filtered.sort((a, b) => (b.updated ?? 0) - (a.updated ?? 0))
          const limit = input.limit ?? 20
          const shown = filtered.slice(0, limit)
          if (!shown.length) {
            return {
              content: q ? `No sessions match "${input.query}" (${all.length} total).` : "No sessions recorded yet.",
            }
          }
          const lines = shown.map((s) => {
            const mark = s.id === context?.sessionID ? "  <-- this session" : ""
            return `${s.id} | ${cut(s.title || "(untitled)", TITLE_LIMIT)} | ${modelLabel(s.model)} | ${fmtTime(s.updated)} | ${s.directory ?? ""}${mark}`
          })
          const footer =
            filtered.length > shown.length
              ? `\n[showing ${shown.length} of ${filtered.length} matching, ${all.length} sessions total]`
              : `\n[${all.length} sessions total]`
          return { content: lines.join("\n") + footer }
        },
      })

      editor.add({
        name: "sessions_get",
        description:
          "Read the transcript of one previous opencode session by id (as listed by sessions_list). " +
          "Text and tool markers only; reasoning and diffs are skipped. Most recent messages first when truncated.",
        input: {
          type: "object",
          properties: {
            session_id: { type: "string", description: "Session id from sessions_list" },
            limit: {
              type: "integer",
              minimum: 1,
              maximum: MAX_MESSAGES,
              description: `Maximum messages returned, taken from the end of the session (default 50, max ${MAX_MESSAGES})`,
            },
          },
          required: ["session_id"],
          additionalProperties: false,
        },
        async execute(input) {
          let session
          try {
            session = await ctx.session.get({ sessionID: input.session_id })
          } catch {
            return { content: `Session not found: ${input.session_id} (use sessions_list to find ids)` }
          }
          let messages
          try {
            messages = await ctx.session.context({ sessionID: input.session_id })
          } catch (error) {
            return { content: `Cannot read session ${input.session_id}: ${error.message}` }
          }
          if (!messages?.length) return { content: `Session "${session.title}" has no messages.` }
          const limit = input.limit ?? 50
          const shown = messages.length > limit ? messages.slice(-limit) : messages
          const omitted = messages.length - shown.length
          const lines = shown.map((message) => {
            const when = fmtTime(message.time?.created)
            const body = cut(messageBody(message), TEXT_LIMIT)
            return `### ${message.type ?? "?"} ${when}\n${body || "(no text)"}`
          })
          const header = `Session: ${session.title || "(untitled)"} (${messages.length} messages)`
          const note = omitted ? `\n[oldest ${omitted} messages omitted — raise limit to see them]` : ""
          return { content: header + note + "\n\n" + lines.join("\n\n") }
        },
      })
    })
  },
}
