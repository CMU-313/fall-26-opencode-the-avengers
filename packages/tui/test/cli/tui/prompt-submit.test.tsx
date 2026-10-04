/** @jsxImportSource @opentui/solid */
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { testRender, useRenderer } from "@opentui/solid"
import { expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { onCleanup } from "solid-js"
import { Prompt, type PromptRef } from "../../../src/component/prompt"
import { SyncContext, useSync } from "../../../src/context/sync"
import { useToast } from "../../../src/ui/toast"
import { tmpdir } from "../../fixture/fixture"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"
import { createEventSource, createFetch, directory } from "../../fixture/tui-sdk"
import { TestTuiContexts } from "../../fixture/tui-environment"

async function wait(fn: () => boolean, timeout = 2000) {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > timeout) throw new Error("timed out waiting for condition")
    await Bun.sleep(10)
  }
}

async function mountPrompt(root: string, messageCount: number) {
  const state = path.join(root, "state")
  await mkdir(state, { recursive: true })
  await Bun.write(path.join(state, "kv.json"), "{}")

  const [
    { ClipboardProvider },
    { ArgsProvider },
    { ExitProvider },
    { SDKProvider },
    { ProjectProvider },
    { PermissionProvider },
    { DataProvider },
    { LocalProvider },
    { ThemeProvider },
    { KVProvider },
    { RouteProvider },
    { ToastProvider },
    { DialogProvider },
    { PromptStashProvider },
    { FrecencyProvider },
    { PromptHistoryProvider },
    { EditorContextProvider },
    { LocationProvider },
    { TuiConfigProvider },
    { OpencodeKeymapProvider, registerOpencodeKeymap },
  ] = await Promise.all([
    import("../../../src/context/clipboard"),
    import("../../../src/context/args"),
    import("../../../src/context/exit"),
    import("../../../src/context/sdk"),
    import("../../../src/context/project"),
    import("../../../src/context/permission"),
    import("../../../src/context/data"),
    import("../../../src/context/local"),
    import("../../../src/context/theme"),
    import("../../../src/context/kv"),
    import("../../../src/context/route"),
    import("../../../src/ui/toast"),
    import("../../../src/ui/dialog"),
    import("../../../src/prompt/stash"),
    import("../../../src/prompt/frecency"),
    import("../../../src/prompt/history"),
    import("../../../src/context/editor"),
    import("../../../src/context/location"),
    import("../../../src/config"),
    import("../../../src/keymap"),
  ])

  const requests: URL[] = []
  const events = createEventSource()
  const calls = createFetch((url) => {
    requests.push(url)
    return undefined
  }, events)
  const dispatches: { command: string; context: unknown }[] = []
  let promptRef: PromptRef | undefined
  let toast!: ReturnType<typeof useToast>
  const sync = {
    data: {
      session_status: {},
      message: {
        ses_test: Array.from({ length: messageCount }, (_, index) => ({
          id: `msg_${index}`,
          sessionID: "ses_test",
          role: "user" as const,
          agent: "build",
          time: { created: index },
        })),
      },
      provider: [],
      provider_default: {},
      agent: [{ name: "build", mode: "primary", hidden: false }],
      config: {},
      command: [],
      session: [],
      mcp: {},
    },
    session: { get: () => undefined },
  } as unknown as ReturnType<typeof useSync>

  function Harness() {
    const renderer = useRenderer()
    const keymap = createDefaultOpenTuiKeymap(renderer)
    const dispatchCommand = keymap.dispatchCommand.bind(keymap)
    keymap.dispatchCommand = (...args) => {
      dispatches.push({ command: args[0], context: args[1] })
      return dispatchCommand(...args)
    }
    const config = createTuiResolvedConfig({ leader_timeout: 1000 })
    const off = registerOpencodeKeymap(keymap, renderer, config)
    onCleanup(off)

    return (
      <TestTuiContexts directory={root} paths={{ home: root, state, worktree: root }}>
        <ExitProvider exit={() => {}}>
          <ClipboardProvider>
            <OpencodeKeymapProvider keymap={keymap}>
              <ArgsProvider>
                <KVProvider>
                  <ToastProvider>
                    <RouteProvider initialRoute={{ type: "session", sessionID: "ses_test" }}>
                      <TuiConfigProvider config={config}>
                        <SDKProvider
                          url="http://test"
                          directory={directory}
                          fetch={calls.fetch}
                          events={events.source}
                        >
                          <PermissionProvider>
                            <ProjectProvider>
                              <SyncContext.Provider value={sync}>
                                <DataProvider>
                                  <ThemeProvider mode="dark">
                                    <LocalProvider>
                                      <PromptStashProvider>
                                        <DialogProvider>
                                          <FrecencyProvider>
                                            <PromptHistoryProvider>
                                              <EditorContextProvider>
                                                <LocationProvider>
                                                  <PromptProbe />
                                                </LocationProvider>
                                              </EditorContextProvider>
                                            </PromptHistoryProvider>
                                          </FrecencyProvider>
                                        </DialogProvider>
                                      </PromptStashProvider>
                                    </LocalProvider>
                                  </ThemeProvider>
                                </DataProvider>
                              </SyncContext.Provider>
                            </ProjectProvider>
                          </PermissionProvider>
                        </SDKProvider>
                      </TuiConfigProvider>
                    </RouteProvider>
                  </ToastProvider>
                </KVProvider>
              </ArgsProvider>
            </OpencodeKeymapProvider>
          </ClipboardProvider>
        </ExitProvider>
      </TestTuiContexts>
    )
  }

  function PromptProbe() {
    toast = useToast()
    return <Prompt sessionID="ses_test" ref={(value) => (promptRef = value)} showPlaceholder={false} />
  }

  const app = await testRender(() => <Harness />)

  return {
    app,
    requests,
    dispatches,
    promptRef: () => promptRef,
    toast: () => toast,
    cleanup() {
      app.renderer.destroy()
    },
  }
}

test("Prompt.submit keeps empty-chat /copy commands as no-ops", async () => {
  await using tmp = await tmpdir()
  const prompt = await mountPrompt(tmp.path, 0)

  try {
    await wait(() => Boolean(prompt.promptRef()))
    const ref = prompt.promptRef()
    if (!ref) throw new Error("expected prompt ref")

    for (const command of ["/copy 0", "/copy 1", "/copy a"]) {
      ref.set({ input: command, parts: [] })
      const requestsBeforeSubmit = prompt.requests.length

      ref.submit()
      await Bun.sleep(0)

      expect(ref.current.input).toBe(command)
      expect(prompt.requests).toHaveLength(requestsBeforeSubmit)
    }
  } finally {
    prompt.cleanup()
  }
})

test("Prompt.submit shows the integer error for invalid counts in a populated chat", async () => {
  await using tmp = await tmpdir()
  const prompt = await mountPrompt(tmp.path, 1)

  try {
    await wait(() => Boolean(prompt.promptRef()))
    const ref = prompt.promptRef()
    if (!ref) throw new Error("expected prompt ref")

    for (const command of ["/copy 0", "/copy a", "/copy -1"]) {
      ref.set({ input: command, parts: [] })
      const requestsBeforeSubmit = prompt.requests.length

      ref.submit()
      await Bun.sleep(0)

      expect(ref.current.input).toBe(command)
      expect(prompt.toast().currentToast?.message).toBe("Message count must be a positive integer.")
      expect(prompt.requests).toHaveLength(requestsBeforeSubmit)
    }
  } finally {
    prompt.cleanup()
  }
})

test("Prompt.submit dispatches the requested count for a valid /copy x command", async () => {
  await using tmp = await tmpdir()
  const prompt = await mountPrompt(tmp.path, 3)

  try {
    await wait(() => Boolean(prompt.promptRef()))
    const ref = prompt.promptRef()
    if (!ref) throw new Error("expected prompt ref")
    const dispatchCount = prompt.dispatches.length
    const requestCount = prompt.requests.length

    ref.set({ input: "/copy 2", parts: [] })
    ref.submit()
    await wait(() => ref.current.input === "")

    expect(prompt.dispatches.slice(dispatchCount)).toEqual([
      { command: "session.copy", context: { payload: 2 } },
    ])
    expect(ref.current.input).toBe("")
    expect(prompt.requests).toHaveLength(requestCount)
  } finally {
    prompt.cleanup()
  }
})