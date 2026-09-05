// Read-only access to past opencode sessions: sessions_list + sessions_get
// tools backed by the SDK client opencode hands to every plugin.
import { tool } from "@opencode-ai/plugin"

const MAX_LIST = 50
const MAX_MESSAGES = 200
const TEXT_LIMIT = 2000
const TITLE_LIMIT = 90

const cut = (s, n) => (s.length > n ? s.slice(0, n) + "…" : s)
const fmtTime = (ms) => (typeof ms === "number" ? new Date(ms).toISOString() : String(ms ?? ""))

function unwrap(res) {
  if (res && typeof res === "object" && "response" in res) {
    if (res.error) {
      const msg = typeof res.error === "string" ? res.error : JSON.stringify(res.error)
      throw new Error(msg)
    }
    return res.data
  }
  return res
}

function partToText(part) {
  if (part.type === "text") return part.text ?? ""
  if (part.type === "tool") return `[tool: ${part.tool ?? "unknown"}]`
  if (part.type === "patch") return "[file patch]"
  if (part.type === "reasoning") return ""
  if (part.type === "snapshot") return ""
  return ""
}

export default async ({ client }) => ({
  tool: {
    sessions_list: tool({
      description:
        "List previous opencode sessions on this machine (id, title, model, last update, directory). " +
        "Use sessions_get with an id for the transcript. Useful for finding what was done or decided earlier.",
      args: {
        query: tool.schema.string().optional().describe(
          "Case-insensitive substring matched against session title and directory"
        ),
        limit: tool.schema.number().int().min(1).max(MAX_LIST).optional().describe(
          `Maximum sessions to return (default 20, max ${MAX_LIST})`
        ),
      },
      async execute(args, ctx) {
        const all = (await client.session.list().then(unwrap)) ?? []
        const q = (args.query ?? "").toLowerCase()
        const filtered = all.filter(
          (s) => !q || `${s.title ?? ""} ${s.directory ?? ""}`.toLowerCase().includes(q)
        )
        filtered.sort((a, b) => (b.time?.updated ?? 0) - (a.time?.updated ?? 0))
        const limit = args.limit ?? 20
        const shown = filtered.slice(0, limit)
        if (!shown.length) {
          return q ? `No sessions match "${args.query}" (${all.length} total).` : "No sessions recorded yet."
        }
        const lines = shown.map((s) => {
          const model = s.model ? s.model.id ?? `${s.model.providerID}/${s.model.modelID}` : "?"
          const mark = s.id === ctx.sessionID ? "  <-- this session" : ""
          return `${s.id} | ${cut(s.title || "(untitled)", TITLE_LIMIT)} | ${model} | ${fmtTime(s.time?.updated)} | ${s.directory ?? ""}${mark}`
        })
        const footer =
          filtered.length > shown.length
            ? `\n[showing ${shown.length} of ${filtered.length} matching, ${all.length} sessions total]`
            : `\n[${all.length} sessions total]`
        return lines.join("\n") + footer
      },
    }),

    sessions_get: tool({
      description:
        "Read the transcript of one previous opencode session by id (as listed by sessions_list). " +
        "Text and tool markers only; reasoning and diffs are skipped. Most recent messages first when truncated.",
      args: {
        session_id: tool.schema.string().describe("Session id from sessions_list"),
        limit: tool.schema.number().int().min(1).max(MAX_MESSAGES).optional().describe(
          `Maximum messages returned, taken from the end of the session (default 50, max ${MAX_MESSAGES})`
        ),
      },
      async execute(args) {
        const session = await client.session
          .get({ path: { id: args.session_id } })
          .then(unwrap)
          .catch(() => null)
        if (!session) return `Session not found: ${args.session_id} (use sessions_list to find ids)`
        const messages = (await client.session.messages({ path: { id: args.session_id } }).then(unwrap)) ?? []
        if (!messages.length) return `Session "${session.title}" has no messages.`
        const limit = args.limit ?? 50
        const shown = messages.length > limit ? messages.slice(-limit) : messages
        const omitted = messages.length - shown.length
        const lines = shown.map((m) => {
          const when = fmtTime(m.info?.time?.created)
          const body = (m.parts ?? [])
            .map(partToText)
            .filter(Boolean)
            .map((t) => cut(t, TEXT_LIMIT))
            .join("\n")
          return `### ${m.info?.role ?? "?"} ${when}\n${body || "(no text)"}`
        })
        const header = `Session: ${session.title || "(untitled)"} (${messages.length} messages)`
        const note = omitted ? `\n[oldest ${omitted} messages omitted — raise limit to see them]` : ""
        return header + note + "\n\n" + lines.join("\n\n")
      },
    }),
  },
})
