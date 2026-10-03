/** @jsxImportSource @opentui/solid */
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { testRender, useRenderer } from "@opentui/solid"
import { describe, expect, test } from "bun:test"
import type { AssistantMessage, Part, UserMessage } from "@opencode-ai/sdk/v2"
import path from "node:path"
import { onCleanup, onMount } from "solid-js"
import { tmpdir } from "../../fixture/fixture"
import { createEventSource, createFetch, directory, json } from "../../fixture/tui-sdk"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"
import { TestTuiContexts } from "../../fixture/tui-environment"

const sessionID = "ses_dialog_message"

const user: UserMessage = {
  id: "msg_user",
  sessionID,
  role: "user",
  agent: "build",
  model: { providerID: "anthropic", modelID: "claude" },
  time: { created: 1 },
}

const assistant: AssistantMessage = {
  id: "msg_assistant",
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
}

const parts: Record<string, Part[]> = {
  [user.id]: [{ id: "prt_user", sessionID, messageID: user.id, type: "text", text: "Explain hash maps" }],
  [assistant.id]: [
    { id: "prt_assistant_1", sessionID, messageID: assistant.id, type: "text", text: "A hash map stores " },
    { id: "prt_assistant_2", sessionID, messageID: assistant.id, type: "text", text: "key-value pairs." },
  ],
}

async function wait(fn: () => boolean, timeout = 3000) {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > timeout) throw new Error("timed out waiting for condition")
    await Bun.sleep(10)
  }
}

async function mountDialogMessage(input: { root: string; messageID: string }) {
  const state = path.join(input.root, "state")
  await Bun.write(path.join(state, "kv.json"), "{}")

  const [
    { DialogProvider },
    { DialogMessage },
    { KVProvider },
    { ThemeProvider },
    { TuiConfigProvider },
    { ToastProvider },
    { OpencodeKeymapProvider, registerOpencodeKeymap },
    { ArgsProvider },
    { SDKProvider },
    { PermissionProvider },
    { ProjectProvider },
    { ExitProvider },
    { SyncProvider, useSync },
    { RouteProvider },
    { ClipboardProvider },
  ] = await Promise.all([
    import("../../../src/ui/dialog"),
    import("../../../src/routes/session/dialog-message"),
    import("../../../src/context/kv"),
    import("../../../src/context/theme"),
    import("../../../src/config"),
    import("../../../src/ui/toast"),
    import("../../../src/keymap"),
    import("../../../src/context/args"),
    import("../../../src/context/sdk"),
    import("../../../src/context/permission"),
    import("../../../src/context/project"),
    import("../../../src/context/exit"),
    import("../../../src/context/sync"),
    import("../../../src/context/route"),
    import("../../../src/context/clipboard"),
  ])

  const events = createEventSource()
  const calls = createFetch((url) => {
    if (url.pathname === `/session/${sessionID}`)
      return json({ id: sessionID, title: "Dialog message", time: { created: 0, updated: 0 }, directory })
    if (url.pathname === `/session/${sessionID}/message`)
      return json([user, assistant].map((info) => ({ info, parts: parts[info.id] })))
    if (url.pathname === `/session/${sessionID}/todo`) return json([])
    if (url.pathname === `/session/${sessionID}/diff`) return json([])
    return undefined
  }, events)

  const copied: string[] = []
  const saved: AssistantMessage[] = []
  let sync!: ReturnType<typeof useSync>
  let ready!: () => void
  const mounted = new Promise<void>((resolve) => {
    ready = resolve
  })

  function Probe() {
    sync = useSync()
    onMount(ready)
    return <DialogMessage messageID={input.messageID} sessionID={sessionID} onSave={(message) => saved.push(message)} />
  }

  function Harness() {
    const renderer = useRenderer()
    const keymap = createDefaultOpenTuiKeymap(renderer)
    const resolvedConfig = createTuiResolvedConfig({ leader_timeout: 1000 })
    const off = registerOpencodeKeymap(keymap, renderer, resolvedConfig)
    onCleanup(off)

    return (
      <TestTuiContexts directory={input.root} paths={{ home: input.root, state, worktree: input.root }}>
        <OpencodeKeymapProvider keymap={keymap}>
          <TuiConfigProvider config={resolvedConfig}>
            <ArgsProvider>
              <KVProvider>
                <SDKProvider url="http://test" directory={directory} fetch={calls.fetch} events={events.source}>
                  <PermissionProvider>
                    <ProjectProvider>
                      <ExitProvider exit={() => {}}>
                        <SyncProvider>
                          <RouteProvider>
                            <ClipboardProvider value={{ write: async (text) => void copied.push(text) }}>
                              <ThemeProvider mode="dark">
                                <ToastProvider>
                                  <DialogProvider>
                                    <Probe />
                                  </DialogProvider>
                                </ToastProvider>
                              </ThemeProvider>
                            </ClipboardProvider>
                          </RouteProvider>
                        </SyncProvider>
                      </ExitProvider>
                    </ProjectProvider>
                  </PermissionProvider>
                </SDKProvider>
              </KVProvider>
            </ArgsProvider>
          </TuiConfigProvider>
        </OpencodeKeymapProvider>
      </TestTuiContexts>
    )
  }

  const app = await testRender(() => <Harness />, { kittyKeyboard: true, width: 100, height: 30 })
  await mounted
  await wait(() => sync.status === "complete")
  await sync.session.sync(sessionID)

  const frame = async (text: string) => {
    await wait(() => {
      void app.renderOnce()
      return app.captureCharFrame().includes(text)
    })
    return app.captureCharFrame()
  }

  return { app, copied, saved, frame }
}

describe("DialogMessage", () => {
  test("assistant responses offer only copy and save to file", async () => {
    await using tmp = await tmpdir()
    const dialog = await mountDialogMessage({ root: tmp.path, messageID: assistant.id })
    try {
      const frame = await dialog.frame("Save to file")
      expect(frame).toContain("Message Actions")
      expect(frame).toContain("Copy")
      expect(frame).not.toContain("Revert")
      expect(frame).not.toContain("Fork")
    } finally {
      dialog.app.renderer.destroy()
    }
  })

  test("user messages keep revert, copy, and fork without save to file", async () => {
    await using tmp = await tmpdir()
    const dialog = await mountDialogMessage({ root: tmp.path, messageID: user.id })
    try {
      const frame = await dialog.frame("Fork")
      expect(frame).toContain("Revert")
      expect(frame).toContain("Copy")
      expect(frame).not.toContain("Save to file")
    } finally {
      dialog.app.renderer.destroy()
    }
  })

  test("save to file hands the selected assistant message to the save flow", async () => {
    await using tmp = await tmpdir()
    const dialog = await mountDialogMessage({ root: tmp.path, messageID: assistant.id })
    try {
      await dialog.frame("Save to file")
      dialog.app.mockInput.pressArrow("down")
      dialog.app.mockInput.pressEnter()
      await wait(() => dialog.saved.length > 0)
      expect(dialog.saved.map((message) => message.id)).toEqual([assistant.id])
      expect(dialog.copied).toEqual([])
    } finally {
      dialog.app.renderer.destroy()
    }
  })

  test("copy on an assistant response copies its visible text", async () => {
    await using tmp = await tmpdir()
    const dialog = await mountDialogMessage({ root: tmp.path, messageID: assistant.id })
    try {
      await dialog.frame("Save to file")
      dialog.app.mockInput.pressEnter()
      await wait(() => dialog.copied.length > 0)
      expect(dialog.copied).toEqual(["A hash map stores key-value pairs."])
      expect(dialog.saved).toEqual([])
    } finally {
      dialog.app.renderer.destroy()
    }
  })
})
