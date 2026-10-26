import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import plugin from "../plugins/sessions/v2/sessions.js"

async function register(overrides = {}) {
  const tools = {}
  await plugin.setup({
    tool: {
      transform: async (callback) => {
        callback({ add: (tool) => { tools[tool.name] = tool } })
      },
    },
    session: overrides.session ?? {},
  })
  return tools
}

test("exports the OpenCode 2 plugin definition", () => {
  assert.equal(plugin.id, "sessions")
  assert.equal(typeof plugin.setup, "function")
})

test("sessions_list prefers ctx.session.list and paginates", async () => {
  const calls = []
  const ctx = {
    session: {
      list: async (input) => {
        calls.push(input)
        if (!input.cursor) {
          return {
            data: [
              {
                id: "ses_a",
                title: "Kitchen light",
                model: { id: "glm-5.3", providerID: "litellm" },
                time: { updated: 200 },
                location: { directory: "/homeassistant" },
              },
            ],
            cursor: { next: "page-2" },
          }
        }
        return {
          data: [
            {
              id: "ses_b",
              title: "Garage door",
              model: { id: "glm-5.3", providerID: "litellm" },
              time: { updated: 100 },
              location: { directory: "/homeassistant" },
            },
          ],
          cursor: { next: null },
        }
      },
    },
  }
  const tools = await register(ctx)
  const result = await tools.sessions_list.execute({}, { sessionID: "ses_a" })
  assert.equal(calls.length, 2)
  assert.match(result.content, /ses_a .*Kitchen light .*litellm\/glm-5\.3/)
  assert.match(result.content, /<-- this session/)
  assert.match(result.content, /ses_b .*Garage door/)
  assert.match(result.content, /\[2 sessions total\]/)
})

test("sessions_list falls back to the read-only database on 2.0.x", async () => {
  const root = mkdtempSync(join(tmpdir(), "opencode-sessions-"))
  const previous = process.env.XDG_DATA_HOME
  try {
    mkdirSync(join(root, "opencode"), { recursive: true })
    const db = new DatabaseSync(join(root, "opencode", "opencode.db"))
    db.exec(`
      CREATE TABLE session_v2 (
        id TEXT PRIMARY KEY, parent_id TEXT, title TEXT, directory TEXT,
        model TEXT, time_updated INTEGER
      )
    `)
    const insert = db.prepare("INSERT INTO session_v2 VALUES (?, ?, ?, ?, ?, ?)")
    insert.run("ses_top", null, "Kitchen light", "/homeassistant", JSON.stringify({ id: "glm-5.3", providerID: "litellm" }), 200)
    insert.run("ses_other", null, "Garage door", "/homeassistant", JSON.stringify({ id: "glm-5.3", providerID: "litellm" }), 100)
    insert.run("ses_child", "ses_top", "Child", "/homeassistant", null, 300)
    db.close()

    process.env.XDG_DATA_HOME = root
    const tools = await register({ session: {} })
    const all = await tools.sessions_list.execute({}, { sessionID: "ses_top" })
    assert.match(all.content, /ses_top .*Kitchen light/)
    assert.match(all.content, /ses_other .*Garage door/)
    assert.doesNotMatch(all.content, /ses_child/)
    assert.match(all.content, /<-- this session/)

    const filtered = await tools.sessions_list.execute({ query: "kitchen" }, {})
    assert.match(filtered.content, /ses_top/)
    assert.doesNotMatch(filtered.content, /ses_other/)
    assert.match(filtered.content, /\[2 sessions total\]/)
  } finally {
    if (previous === undefined) delete process.env.XDG_DATA_HOME
    else process.env.XDG_DATA_HOME = previous
    rmSync(root, { recursive: true, force: true })
  }
})

test("sessions_get formats V2 messages and truncates from the end", async () => {
  const ctx = {
    session: {
      get: async ({ sessionID }) => ({ id: sessionID, title: "A past session" }),
      context: async () => [
        { type: "user", time: { created: 1000 }, text: "hello" },
        {
          type: "assistant",
          time: { created: 2000 },
          content: [
            { type: "reasoning", text: "thinking" },
            { type: "text", text: "hi there" },
            { type: "tool", name: "bash" },
          ],
        },
        { type: "shell", time: { created: 3000 }, command: "ls" },
      ],
    },
  }
  const tools = await register(ctx)

  const truncated = await tools.sessions_get.execute({ session_id: "ses_x", limit: 2 }, {})
  assert.match(truncated.content, /Session: A past session \(3 messages\)/)
  assert.match(truncated.content, /oldest 1 messages omitted/)
  assert.match(truncated.content, /### assistant/)
  assert.match(truncated.content, /hi there/)
  assert.match(truncated.content, /\[tool: bash\]/)
  assert.match(truncated.content, /\[shell: ls\]/)
  assert.doesNotMatch(truncated.content, /thinking/)
  assert.doesNotMatch(truncated.content, /hello/)

  const full = await tools.sessions_get.execute({ session_id: "ses_x" }, {})
  assert.match(full.content, /### user/)
  assert.match(full.content, /hello/)
  assert.doesNotMatch(full.content, /omitted/)
})

test("sessions_get reports an unknown session", async () => {
  const tools = await register({
    session: {
      get: async () => {
        throw new Error("not found")
      },
    },
  })
  const result = await tools.sessions_get.execute({ session_id: "ses_missing" }, {})
  assert.match(result.content, /Session not found: ses_missing/)
})
