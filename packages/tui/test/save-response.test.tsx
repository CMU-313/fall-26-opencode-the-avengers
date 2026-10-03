import { describe, expect, mock, test } from "bun:test"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { AssistantMessage, Part, UserMessage } from "@opencode-ai/sdk/v2"
import { createTestRenderer } from "@opentui/core/testing"
import { Effect } from "effect"
import path from "node:path"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Global } from "@opencode-ai/core/global"
import { tmpdir } from "./fixture/fixture"
import { createTuiResolvedConfig } from "./fixture/tui-runtime"
import { createEventSource, createFetch, directory, json } from "./fixture/tui-sdk"

const sessionID = "ses_save_response"

const user: UserMessage = {
  id: "msg_save_user",
  sessionID,
  role: "user",
  agent: "build",
  model: { providerID: "anthropic", modelID: "claude" },
  time: { created: 1 },
}

const assistant: AssistantMessage = {
  id: "msg_save_assistant",
  sessionID,
  role: "assistant",
  agent: "build",
  modelID: "claude",
  providerID: "anthropic",
  mode: "",
  parentID: user.id,
  path: { cwd: directory, root: directory },
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 2, completed: 3 },
  finish: "stop",
}

const parts: Record<string, Part[]> = {
  [user.id]: [{ id: "prt_save_user", sessionID, messageID: user.id, type: "text", text: "Explain hash maps" }],
  [assistant.id]: [
    {
      id: "prt_save_assistant",
      sessionID,
      messageID: assistant.id,
      type: "text",
      text: "Hash maps store **key-value** pairs.",
    },
  ],
}

const followUp: UserMessage = { ...user, id: "msg_save_user_2", time: { created: 4 } }
const latest: AssistantMessage = {
  ...assistant,
  id: "msg_save_assistant_2",
  parentID: followUp.id,
  time: { created: 5, completed: 6 },
}
parts[followUp.id] = [{ id: "prt_save_user_2", sessionID, messageID: followUp.id, type: "text", text: "And sets?" }]
parts[latest.id] = [
  { id: "prt_save_assistant_2", sessionID, messageID: latest.id, type: "text", text: "Sets store unique values." },
]

async function startApp(messages: Array<UserMessage | AssistantMessage>) {
  const setup = await createTestRenderer({ width: 120, height: 40, useThread: false })
  const core = await import("@opentui/core")
  mock.module("@opentui/core", () => ({ ...core, createCliRenderer: async () => setup.renderer }))
  const session = {
    id: sessionID,
    title: "Save response",
    slug: "save-response",
    projectID: "proj_test",
    directory,
    version: "0.0.0-test",
    time: { created: 0, updated: 0 },
  }
  const calls = createFetch((url) => {
    // A connected provider keeps the startup "Connect a provider" dialog from capturing input.
    if (url.pathname === "/config/providers")
      return json({
        providers: [{ id: "anthropic", name: "Anthropic", source: "api", env: [], options: {}, models: {} }],
        default: {},
      })
    if (url.pathname === "/session") return json([session])
    if (url.pathname === `/session/${sessionID}`) return json(session)
    if (url.pathname === `/session/${sessionID}/message`)
      return json(messages.map((info) => ({ info, parts: parts[info.id] })))
    if (url.pathname === `/session/${sessionID}/todo`) return json([])
    if (url.pathname === `/session/${sessionID}/diff`) return json([])
    return undefined
  })
  // Exiting prints the session epilogue to stdout; keep it out of test output.
  const originalWrite = process.stdout.write.bind(process.stdout)
  process.stdout.write = (() => true) as typeof process.stdout.write
  let api!: TuiPluginApi
  let started!: () => void
  const ready = new Promise<void>((resolve) => {
    started = resolve
  })

  const { run } = await import("../src/app")
  const task = Effect.runPromise(
    run({
      url: "http://test",
      directory,
      config: createTuiResolvedConfig({ plugin_enabled: {} }),
      fetch: calls.fetch,
      events: createEventSource().source,
      args: { sessionID },
      pluginHost: {
        async start(input) {
          api = input.api
          started()
        },
        async dispose() {},
      },
    }).pipe(Effect.provide(AppNodeBuilder.build(Global.node))),
  )
  await ready

  const screen = async (text: string, timeout = 5000) => {
    const start = Date.now()
    while (!setup.captureCharFrame().includes(text)) {
      if (Date.now() - start > timeout) throw new Error(`timed out waiting for "${text}"\n${setup.captureCharFrame()}`)
      await setup.renderOnce()
      await Bun.sleep(10)
    }
    return setup.captureCharFrame()
  }

  return {
    setup,
    screen,
    api: api.keymap,
    save: () => api.keymap.dispatchCommand("messages.save"),
    async enterFilename(filename: string) {
      await screen("Save Response")
      for (const _ of Array.from({ length: 60 })) setup.mockInput.pressBackspace()
      await setup.mockInput.typeText(filename)
      await setup.renderOnce()
      setup.mockInput.pressEnter()
    },
    async stop() {
      api.keymap.dispatchCommand("app.exit")
      await task.catch(() => undefined)
      if (!setup.renderer.isDestroyed) setup.renderer.destroy()
      process.stdout.write = originalWrite
      mock.restore()
    },
  }
}

async function waitForFile(filepath: string, timeout = 5000) {
  const start = Date.now()
  while (!(await Bun.file(filepath).exists())) {
    if (Date.now() - start > timeout) throw new Error(`timed out waiting for ${filepath}`)
    await Bun.sleep(10)
  }
}

describe("save last assistant response", () => {
  test("saves the latest response as plain text", async () => {
    await using tmp = await tmpdir()
    const filepath = path.join(tmp.path, "answer.txt")
    const app = await startApp([user, assistant])
    try {
      await app.screen("key-value")
      app.save()
      await app.enterFilename(filepath)
      await waitForFile(filepath)
      expect(await Bun.file(filepath).text()).toBe("Hash maps store **key-value** pairs.\n")
      await app.screen("Response saved to")
    } finally {
      await app.stop()
    }
  })

  test("saves the latest response as markdown with a header", async () => {
    await using tmp = await tmpdir()
    const filepath = path.join(tmp.path, "answer.md")
    const app = await startApp([user, assistant])
    try {
      await app.screen("key-value")
      app.save()
      await app.enterFilename(filepath)
      await waitForFile(filepath)
      const content = await Bun.file(filepath).text()
      expect(content).toStartWith("## Assistant")
      expect(content).toContain("Hash maps store **key-value** pairs.")
    } finally {
      await app.stop()
    }
  })

  test("saves the most recent response when there are several", async () => {
    await using tmp = await tmpdir()
    const filepath = path.join(tmp.path, "latest.txt")
    const app = await startApp([user, assistant, followUp, latest])
    try {
      await app.screen("unique values")
      app.save()
      await app.enterFilename(filepath)
      await waitForFile(filepath)
      expect(await Bun.file(filepath).text()).toBe("Sets store unique values.\n")
    } finally {
      await app.stop()
    }
  })

  test("rejects unsupported file extensions without writing", async () => {
    await using tmp = await tmpdir()
    const filepath = path.join(tmp.path, "answer.pdf")
    const app = await startApp([user, assistant])
    try {
      await app.screen("key-value")
      app.save()
      await app.enterFilename(filepath)
      await app.screen("Filename must end in .md or .txt")
      expect(await Bun.file(filepath).exists()).toBe(false)
    } finally {
      await app.stop()
    }
  })

  test("asks before overwriting and replaces the file when confirmed", async () => {
    await using tmp = await tmpdir()
    const filepath = path.join(tmp.path, "answer.txt")
    await Bun.write(filepath, "original\n")
    const app = await startApp([user, assistant])
    try {
      await app.screen("key-value")
      app.save()
      await app.enterFilename(filepath)
      await app.screen("Overwrite file?")
      expect(await Bun.file(filepath).text()).toBe("original\n")
      app.setup.mockInput.pressEnter()
      await app.screen("Response saved to")
      expect(await Bun.file(filepath).text()).toBe("Hash maps store **key-value** pairs.\n")
    } finally {
      await app.stop()
    }
  })

  test("keeps the existing file when overwrite is cancelled", async () => {
    await using tmp = await tmpdir()
    const filepath = path.join(tmp.path, "answer.txt")
    await Bun.write(filepath, "original\n")
    const app = await startApp([user, assistant])
    try {
      await app.screen("key-value")
      app.save()
      await app.enterFilename(filepath)
      await app.screen("Overwrite file?")
      app.setup.mockInput.pressArrow("left")
      await app.setup.renderOnce()
      app.setup.mockInput.pressEnter()
      await app.setup.renderOnce()
      await Bun.sleep(100)
      expect(app.setup.captureCharFrame()).not.toContain("Response saved to")
      expect(await Bun.file(filepath).text()).toBe("original\n")
    } finally {
      await app.stop()
    }
  })

  test("the /save slash command runs the save flow", async () => {
    await using tmp = await tmpdir()
    const filepath = path.join(tmp.path, "from-slash.txt")
    const app = await startApp([user, assistant])
    try {
      await app.screen("key-value")
      // Prompt autocomplete builds slash commands from these same palette entries.
      const entry = app.api
        .getCommandEntries({ visibility: "reachable", namespace: "palette" })
        .find((item) => item.command.slashName === "save")
      expect(entry?.command.name).toBe("messages.save")
      app.api.dispatchCommand(entry!.command.name)
      await app.enterFilename(filepath)
      await waitForFile(filepath)
      expect(await Bun.file(filepath).text()).toBe("Hash maps store **key-value** pairs.\n")
    } finally {
      await app.stop()
    }
  })

  test("reports when there is no assistant response to save", async () => {
    const app = await startApp([user])
    try {
      await app.screen("Explain hash maps")
      app.save()
      await app.screen("No assistant messages found")
      expect(app.setup.captureCharFrame()).not.toContain("Save Response")
    } finally {
      await app.stop()
    }
  })
})
