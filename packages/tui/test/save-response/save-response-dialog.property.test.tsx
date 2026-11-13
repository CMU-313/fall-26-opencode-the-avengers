import { describe, expect, mock, test } from "bun:test"
import fc from "fast-check"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { AssistantMessage, Part, UserMessage } from "@opencode-ai/sdk/v2"
import { createTestRenderer } from "@opentui/core/testing"
import { Effect } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Global } from "@opencode-ai/core/global"
import path from "node:path"
import { formatResponse } from "../../src/util/transcript"
import { tmpdir } from "../fixture/fixture"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"
import { createEventSource, createFetch, directory, json } from "../fixture/tui-sdk"

// Fixed seed so Stryker sees the same generated inputs on every mutant run.
fc.configureGlobal({ seed: 42 })

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

// A second, newer exchange, so the message menu can be opened on a response that is not the latest.
const followUp: UserMessage = { ...user, id: "msg_dialog_user_2", time: { created: 4 } }
const newer: AssistantMessage = {
  ...assistant,
  id: "msg_dialog_assistant_2",
  parentID: followUp.id,
  time: { created: 5, completed: 6 },
}

const parts: Record<string, Part[]> = {
  [user.id]: [{ id: "prt_dialog_user", sessionID, messageID: user.id, type: "text", text: "Explain hash maps" }],
  [assistant.id]: [
    { id: "prt_dialog_assistant", sessionID, messageID: assistant.id, type: "text", text: "Hash maps store pairs." },
  ],
  [followUp.id]: [{ id: "prt_dialog_user_2", sessionID, messageID: followUp.id, type: "text", text: "And sets?" }],
  [newer.id]: [
    { id: "prt_dialog_assistant_2", sessionID, messageID: newer.id, type: "text", text: "Sets keep unique keys." },
  ],
}

const options = [
  "Include thinking",
  "Include tool details",
  "Include assistant metadata",
  "Open without saving",
] as const

async function startApp(messages: Array<UserMessage | AssistantMessage> = [user, assistant]) {
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
      return json(messages.map((info) => ({ info, parts: parts[info.id] })))
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
    setup
      .captureCharFrame()
      .split("\n")
      .find((line) => line.includes(label))
      ?.includes("[x]")

  // Opens the save dialog, replaces the filename, and sets each toggle in `options` order to `wanted`.
  const fillDialog = async (name: string, wanted: boolean[]) => {
    for (const _ of Array.from({ length: 120 })) setup.mockInput.pressBackspace()
    await setup.mockInput.typeText(name)
    await setup.renderOnce()
    // Tab moves from the filename to each toggle in turn; space flips the focused toggle.
    for (const [index, label] of options.entries()) {
      setup.mockInput.pressTab()
      await setup.renderOnce()
      if (toggleOn(label) !== wanted[index]) setup.mockInput.pressKey(" ")
      await setup.renderOnce()
    }
  }

  // Clicks the first character of the first on-screen line that contains `text`.
  const click = async (text: string) => {
    const lines = setup.captureCharFrame().split("\n")
    const y = lines.findIndex((line) => line.includes(text))
    if (y === -1) throw new Error(`"${text}" is not on screen\n${setup.captureCharFrame()}`)
    await setup.mockMouse.click(lines[y].indexOf(text), y)
    await setup.renderOnce()
  }

  const waitForFile = async (filepath: string) => {
    const start = Date.now()
    while (!(await Bun.file(filepath).exists())) {
      if (Date.now() - start > 5000) throw new Error(`timed out waiting for ${filepath}`)
      await setup.renderOnce()
      await Bun.sleep(10)
    }
  }

  return {
    setup,
    screen,
    click,
    waitForFile,
    toggleOn,
    fillDialog,
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
  // fit on one line of the filename box; each of the four toggles is drawn independently so all 16
  // combinations can be reached. Strengthened in P5: "Open without saving" is a toggle too, so it is drawn
  // and checked as well (it is safe here because the dialog is always cancelled, never confirmed). The whole property runs in one app instance because driving the TUI is
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
          fc.tuple(fc.boolean(), fc.boolean(), fc.boolean(), fc.boolean()),
          async (name, wanted) => {
            let open = false
            try {
              app.save()
              await app.screen("Save Response")
              open = true
              await app.fillDialog(name, wanted)

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

describe("R2: /save writes the same file as formatting that message directly", () => {
  // R2: "Saving a message through /save and through 'Save to file' in the message menu produces the same
  // files." Both entry points end in the same dialog and formatResponse call, so the /save path is checked
  // end to end against formatResponse for the same message and toggles.
  // Kind: metamorphic (the TUI path and the direct formatter must agree)
  // Generators: either extension, and each of the three content toggles drawn independently. "Open without
  // saving" stays off so the dialog writes a file instead of launching an editor. Added in P5 because no
  // property ever confirmed the dialog, so every mutant on the confirm path survived.
  test("R2: confirming /save writes formatResponse of the latest message with the chosen toggles", async () => {
    await using tmp = await tmpdir()
    const app = await startApp()
    try {
      await app.screen("Hash maps")
      await fc.assert(
        fc.asyncProperty(
          fc.stringMatching(/^[a-z]{3,8}$/),
          fc.constantFrom("md" as const, "txt" as const),
          fc.tuple(fc.boolean(), fc.boolean(), fc.boolean()),
          async (base, format, wanted) => {
            const filepath = path.join(tmp.path, `${base}-${wanted.map(Number).join("")}.${format}`)
            await Bun.file(filepath)
              .delete()
              .catch(() => undefined)
            app.save()
            await app.screen("Save Response")
            await app.fillDialog(filepath, [...wanted, false])
            app.setup.mockInput.pressEnter()
            await app.waitForFile(filepath)
            expect(await Bun.file(filepath).text()).toBe(
              formatResponse(assistant, parts[assistant.id], format, {
                thinking: wanted[0],
                toolDetails: wanted[1],
                assistantMetadata: wanted[2],
              }),
            )
            await app.screen("Response saved to")
          },
        ),
        { numRuns: 4, endOnFailure: true },
      )
    } finally {
      await app.stop()
    }
  }, 120_000)
})

describe("R2: the message menu saves the message that was clicked", () => {
  // R2: "The menu option saves the message that was clicked, even if it is not the latest."
  // Kind: model / oracle (which message was clicked decides the expected file)
  // Generators: the clicked response is either the older or the newer of two, with either extension and
  // random toggles. Added in P5: the earlier R2 properties only called formatResponse, so a menu that
  // always saved the latest response (hand-written mutant H3) passed them.
  test("R2: Save to file on a response writes that response, not the latest one", async () => {
    await using tmp = await tmpdir()
    const app = await startApp([user, assistant, followUp, newer])
    try {
      await app.screen("Sets keep unique keys.")
      await fc.assert(
        fc.asyncProperty(
          fc.boolean(),
          fc.constantFrom("md" as const, "txt" as const),
          fc.tuple(fc.boolean(), fc.boolean(), fc.boolean()),
          async (clickOlder, format, wanted) => {
            const clicked = clickOlder ? assistant : newer
            const filepath = path.join(
              tmp.path,
              `menu-${clickOlder ? "older" : "newer"}-${wanted.map(Number).join("")}.${format}`,
            )
            await Bun.file(filepath)
              .delete()
              .catch(() => undefined)
            const text = parts[clicked.id][0]
            await app.click(text.type === "text" ? text.text : "")
            await app.screen("Message Actions")
            await app.click("Save to file")
            await app.screen("Save Response")
            await app.fillDialog(filepath, [...wanted, false])
            app.setup.mockInput.pressEnter()
            await app.waitForFile(filepath)

            expect(await Bun.file(filepath).text()).toBe(
              formatResponse(clicked, parts[clicked.id], format, {
                thinking: wanted[0],
                toolDetails: wanted[1],
                assistantMetadata: wanted[2],
              }),
            )
            await app.screen("Response saved to")
          },
        ),
        { numRuns: 4, endOnFailure: true },
      )
    } finally {
      await app.stop()
    }
  }, 120_000)
})

describe("R4: /save on a response with no visible text refuses to save", () => {
  // R4: "When a response has no visible text, no file is created, even when the metadata, thinking or tool
  // details toggles are turned on."
  // Kind: invariant (whatever invisible parts the response has, /save shows the error and opens no dialog)
  // Generators: a response made only of parts that carry no visible answer: reasoning, a tool call,
  // synthetic text, or whitespace-only text, in any non-empty combination. Each run starts its own app
  // because the session's parts are served at startup, which is why numRuns is small. Added in P5: the
  // earlier R4 properties only tested hasResponseText, so deleting the guard in /save went unnoticed.
  test("R4: /save shows the no-text error and never opens the save dialog", async () => {
    const invisible = fc.constantFrom<Part>(
      {
        id: "prt_r4_reasoning",
        sessionID,
        messageID: assistant.id,
        type: "reasoning",
        text: "Thinking it over",
        time: { start: 1 },
      },
      {
        id: "prt_r4_tool",
        sessionID,
        messageID: assistant.id,
        type: "tool",
        callID: "call_r4",
        tool: "bash",
        state: {
          status: "completed",
          input: { command: "ls" },
          output: "a.txt",
          title: "bash",
          metadata: {},
          time: { start: 1, end: 2 },
        },
      },
      {
        id: "prt_r4_synthetic",
        sessionID,
        messageID: assistant.id,
        type: "text",
        text: "Synthetic note",
        synthetic: true,
      },
      { id: "prt_r4_blank", sessionID, messageID: assistant.id, type: "text", text: "  \n " },
    )
    const visible = parts[assistant.id]
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(invisible, { minLength: 1, maxLength: 4, selector: (part) => part.id }),
        async (generated) => {
          parts[assistant.id] = generated
          const app = await startApp()
          try {
            await app.screen("Explain hash maps")
            app.save()
            const frame = await app.screen("No text content found in assistant response")
            expect(frame).not.toContain("Save Response")
          } finally {
            await app.stop()
            parts[assistant.id] = visible
          }
        },
      ),
      { numRuns: 3, endOnFailure: true },
    )
  }, 120_000)
})
