/** @jsxImportSource @opentui/solid */
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { testRender, useRenderer } from "@opentui/solid"
import { expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { onCleanup } from "solid-js"
import { tmpdir } from "../../fixture/fixture"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"
import { TestTuiContexts } from "../../fixture/tui-environment"

async function mountExportOptions(input: { root: string; title?: string }) {
  const state = path.join(input.root, "state")
  await mkdir(state, { recursive: true })
  await Bun.write(path.join(state, "kv.json"), "{}")

  const [
    { DialogProvider },
    { DialogExportOptions },
    { KVProvider },
    { ThemeProvider },
    { TuiConfigProvider },
    { ToastProvider },
    { OpencodeKeymapProvider, registerOpencodeKeymap },
  ] = await Promise.all([
    import("../../../src/ui/dialog"),
    import("../../../src/ui/dialog-export-options"),
    import("../../../src/context/kv"),
    import("../../../src/context/theme"),
    import("../../../src/config"),
    import("../../../src/ui/toast"),
    import("../../../src/keymap"),
  ])

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
            <KVProvider>
              <ThemeProvider mode="dark">
                <ToastProvider>
                  <DialogProvider>
                    <DialogExportOptions
                      title={input.title}
                      defaultFilename="response-msg_1234.md"
                      defaultThinking={false}
                      defaultToolDetails={false}
                      defaultAssistantMetadata={true}
                      defaultOpenWithoutSaving={false}
                    />
                  </DialogProvider>
                </ToastProvider>
              </ThemeProvider>
            </KVProvider>
          </TuiConfigProvider>
        </OpencodeKeymapProvider>
      </TestTuiContexts>
    )
  }

  const app = await testRender(() => <Harness />, { kittyKeyboard: true, width: 100, height: 30 })
  const start = Date.now()
  while (!app.captureCharFrame().includes("Filename:")) {
    if (Date.now() - start > 2000) throw new Error("timed out waiting for export options dialog")
    await Bun.sleep(10)
    await app.renderOnce()
  }
  return app
}

test("export options dialog keeps its default title", async () => {
  await using tmp = await tmpdir()
  const app = await mountExportOptions({ root: tmp.path })
  try {
    const frame = app.captureCharFrame()
    expect(frame).toContain("Export Options")
    expect(frame).toContain("response-msg_1234.md")
  } finally {
    app.renderer.destroy()
  }
})

test("export options dialog renders a custom title", async () => {
  await using tmp = await tmpdir()
  const app = await mountExportOptions({ root: tmp.path, title: "Save Response" })
  try {
    const frame = app.captureCharFrame()
    expect(frame).toContain("Save Response")
    expect(frame).not.toContain("Export Options")
  } finally {
    app.renderer.destroy()
  }
})
