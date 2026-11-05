import { describe, expect, mock, test } from "bun:test"
import fc from "fast-check"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { AssistantMessage, Part, UserMessage } from "@opencode-ai/sdk/v2"
import { createTestRenderer } from "@opentui/core/testing"
import { Effect } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Global } from "@opencode-ai/core/global"
import path from "node:path"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"
import { createEventSource, createFetch, directory, json } from "../fixture/tui-sdk"

const sessionID = "ses_save_dialog_property"

const user: UserMessage = {
  id: "msg_dialog_user",
  sessionID,
  role: "user",
  agent: "build",
  model: { providerID: "anthropic", modelID: "claude" },
  time: { created: 1 },
}

const assistant: AssistantMessage = {
  id: "msg_dialog_assistant",
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
  [user.id]: [{ id: "prt_dialog_user", sessionID, messageID: user.id, type: "text", text: "Explain hash maps" }],
  [assistant.id]: [
    { id: "prt_dialog_assistant", sessionID, messageID: assistant.id, type: "text", text: "Hash maps store pairs." },
  ],
}

const options = ["Include thinking", "Include tool details", "Include assistant metadata"] as const

async function startApp() {
  const setup = await createTestRenderer({ width: 120, height: 40, useThread: false })
  const core = await import("@opentui/core")
  mock.module("@opentui/core", () => ({ ...core, createCliRenderer: async () => setup.renderer }))
  const session = {
    id: sessionID,
    title: "Save dialog",
    slug: "save-dialog",
    projectID: "proj_test",
    directory,
    version: "0.0.0-test",
    time: { created: 0, updated: 0 },
  }
  const calls = createFetch((url) => {
    if (url.pathname === "/config/providers")
      return json({
        providers: [{ id: "anthropic", name: "Anthropic", source: "api", env: [], options: {}, models: {} }],
        default: {},
      })
    if (url.pathname === "/session") return json([session])
    if (url.pathname === `/session/${sessionID}`) return json(session)
    if (url.pathname === `/session/${sessionID}/message`)
      return json([user, assistant].map((info) => ({ info, parts: parts[info.id] })))
    if (url.pathname === `/session/${sessionID}/todo`) return json([])
    if (url.pathname === `/session/${sessionID}/diff`) return json([])
    return undefined
  })
  const originalWrite = process.stdout.write.bind(process.stdout)
  process.stdout.write = (() => true) as typeof process.stdout.write
  let api!: TuiPluginApi
  let started!: () => void
  const ready = new Promise<void>((resolve) => {
    started = resolve
  })

  const { run } = await import("../../src/app")
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

  // The save dialog draws each toggle as "[x] <label>" or "[ ] <label>".
  const toggleOn = (label: string) =>
    setup.captureCharFrame().split("\n").find((line) => line.includes(label))?.includes("[x]")

  return {
    setup,
    screen,
    toggleOn,
    save: () => api.keymap.dispatchCommand("messages.save"),
    async stop() {
      api.keymap.dispatchCommand("app.exit")
      await task.catch(() => undefined)
      if (!setup.renderer.isDestroyed) setup.renderer.destroy()
      process.stdout.write = originalWrite
      mock.restore()
    },
  }
}

describe("R5: cancelling the save dialog keeps what the user entered", () => {
  // R5: "If the user cancels the save and then opens it again for the same message, the interface restores
  // the filename and toggle settings they had entered before cancelling. Cancelling still writes no file."
  // Kind: round-trip (open the dialog, change it, cancel, reopen: the entered values come back)
  // Generators: filenames are short relative names with either extension, so they are always valid and
  // fit on one line of the filename box; each of the three toggles is drawn independently so all 8
  // combinations can be reached. The whole property runs in one app instance because driving the TUI is
  // slow, which is why numRuns is small. endOnFailure skips shrinking for the same reason: every shrink
  // attempt would replay the full dialog flow.
  test("R5: reopening the dialog for the same message restores the cancelled filename and toggles", async () => {
    const app = await startApp()
    const closeDialog = async () => {
      app.setup.mockInput.pressEscape()
      await app.setup.renderOnce()
      await Bun.sleep(50)
      await app.setup.renderOnce()
    }
    try {
      await app.screen("Hash maps")
      await fc.assert(
        fc.asyncProperty(
          fc.stringMatching(/^[a-z]{3,8}\.(md|txt)$/).map((name) => `r5-${name}`),
          fc.tuple(fc.boolean(), fc.boolean(), fc.boolean()),
          async (name, wanted) => {
            let open = false
            try {
              app.save()
              await app.screen("Save Response")
              open = true
              for (const _ of Array.from({ length: 80 })) app.setup.mockInput.pressBackspace()
              await app.setup.mockInput.typeText(name)
              await app.setup.renderOnce()

              // Tab moves from the filename to each toggle in turn; space flips the focused toggle.
              for (const [index, label] of options.entries()) {
                app.setup.mockInput.pressTab()
                await app.setup.renderOnce()
                if (app.toggleOn(label) !== wanted[index]) app.setup.mockInput.pressKey(" ")
                await app.setup.renderOnce()
              }

              // Confirms the test really entered these values, so a failure below is about restoring them.
              expect(app.setup.captureCharFrame()).toContain(name)
              options.forEach((label, index) => expect(app.toggleOn(label)).toBe(wanted[index]))

              await closeDialog()
              open = false
              expect(app.setup.captureCharFrame()).not.toContain("Save Response")
              expect(await Bun.file(path.join(process.cwd(), name)).exists()).toBe(false)

              app.save()
              const frame = await app.screen("Save Response")
              open = true
              expect(frame).toContain(name)
              options.forEach((label, index) => expect(app.toggleOn(label)).toBe(wanted[index]))
            } finally {
              if (open) await closeDialog()
            }
          },
        ),
        { numRuns: 5, endOnFailure: true },
      )
    } finally {
      await app.stop()
    }
  }, 120_000)
})
