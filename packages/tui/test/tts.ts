// Run explicitly from packages/tui: bun test ./test/tts.ts
// Bun does not auto-discover the requested tts.ts filename.
import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import { Audio, type AudioStreamBody, type AudioStreamBodyOptions } from "@opentui/core"
import ts from "typescript"

// Re-enter this same file in a child process to isolate the transport's global
// WebSocket replacement and module mock without a separate fixture file.
if (process.env.OPENCODE_TTS_TRANSPORT_TEST === "1") {
  const sockets: Socket[] = []
  const state = { mode: "audio", bytes: [] as number[] }

  class Socket {
    binaryType = ""
    onopen?: () => void
    onmessage?: (event: { data: string | ArrayBuffer }) => void
    onerror?: () => void
    onclose?: (event: { code: number }) => void
    sent: string[] = []
    closed = false

    constructor(
      readonly url: string,
      readonly init: { headers: Record<string, string> },
    ) {
      sockets.push(this)
      queueMicrotask(() => this.onopen?.())
    }

    send(value: string) {
      this.sent.push(value)
      if (!value.includes("Path:ssml")) return
      queueMicrotask(() => {
        if (state.mode === "error") return this.onerror?.()
        if (state.mode === "close") return this.onclose?.({ code: 1006 })
        this.onmessage?.({ data: "Path:turn.start\r\n" })
        this.frame("Path:metadata\r\n", [99])
        this.frame("Path:audio\r\n", [])
        this.frame("Path:audio\r\n", [1, 2, 3])
        this.frame("Path:audio\r\n", [4, 5])
        this.onmessage?.({ data: "Path:turn.end\r\n" })
      })
    }

    frame(header: string, payload: number[]) {
      const bytes = new TextEncoder().encode(header)
      const frame = new Uint8Array(2 + bytes.length + payload.length)
      new DataView(frame.buffer).setUint16(0, bytes.length)
      frame.set(bytes, 2)
      frame.set(payload, bytes.length + 2)
      this.onmessage?.({ data: frame.buffer })
    }

    close() {
      this.closed = true
      this.onclose?.({ code: 1000 })
    }
  }

  // The production module captures WebSocket during import and exposes no injected
  // transport. This fixture runs only in a child process; no real network is used.
  Object.defineProperty(globalThis, "WebSocket", { value: Socket, configurable: true })
  const playback = mock(
    async (source: ReadableStream<Uint8Array>, _options: { format: string; signal: AbortSignal }) => {
      const reader = source.getReader()
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          state.bytes.push(...value)
        }
      } finally {
        reader.releaseLock()
      }
      return { closed: Promise.resolve() } as { closed: Promise<void> } | null
    },
  )
  mock.module("../src/audio", () => ({ playStream: playback }))
  const { speak } = await import("../src/speech")

  beforeEach(() => {
    state.mode = "audio"
    state.bytes = []
    sockets.length = 0
    playback.mockClear()
  })

  test("a second request stops playback and a third starts a fresh reading", async () => {
    const closed = Promise.withResolvers<void>()
    playback.mockImplementationOnce(async (source, options) => {
      await source.cancel()
      options.signal.addEventListener("abort", () => closed.resolve(), { once: true })
      return { closed: closed.promise }
    })
    await speak("First response")
    const signal = playback.mock.calls[0][1].signal
    expect(signal.aborted).toBe(false)
    // Even empty text must stop an existing reading, without revalidating it.
    await speak("")
    expect(signal.aborted).toBe(true)
    await closed.promise
    expect(playback).toHaveBeenCalledTimes(1)
    await speak("Restarted response")
    expect(playback).toHaveBeenCalledTimes(2)
    expect(playback.mock.calls[1][1].signal.aborted).toBe(false)
  })

  test("stopping during startup suppresses cancellation errors without clearing a newer reading", async () => {
    const pending = Promise.withResolvers<{ closed: Promise<void> } | null>()
    const closed = Promise.withResolvers<void>()
    playback.mockImplementationOnce(async (source) => {
      await source.cancel()
      return pending.promise
    })
    const first = speak("Still loading")
    await speak("Stop")
    expect(playback.mock.calls[0][1].signal.aborted).toBe(true)
    playback.mockImplementationOnce(async (source, options) => {
      await source.cancel()
      options.signal.addEventListener("abort", () => closed.resolve(), { once: true })
      return { closed: closed.promise }
    })
    await speak("New reading")
    pending.reject(new Error("Playback canceled"))
    await expect(first).resolves.toBeUndefined()
    await speak("Stop the new reading")
    expect(playback).toHaveBeenCalledTimes(2)
    expect(playback.mock.calls[1][1].signal.aborted).toBe(true)
  })

  test("late completion from an old reading cannot clear a newer reading", async () => {
    const old = Promise.withResolvers<void>()
    playback.mockImplementationOnce(async (source) => {
      await source.cancel()
      return { closed: old.promise }
    })
    await speak("Old reading")
    await speak("Stop old")
    const next = Promise.withResolvers<void>()
    playback.mockImplementationOnce(async (source, options) => {
      await source.cancel()
      options.signal.addEventListener("abort", () => next.resolve(), { once: true })
      return { closed: next.promise }
    })
    await speak("New reading")
    old.resolve()
    await Promise.resolve()
    await speak("Stop new")
    expect(playback).toHaveBeenCalledTimes(2)
    expect(playback.mock.calls[1][1].signal.aborted).toBe(true)
  })

  test("natural completion allows the next request to start immediately", async () => {
    await speak("First reading")
    await speak("Second reading")
    expect(playback).toHaveBeenCalledTimes(2)
    expect(playback.mock.calls.every((call) => !call[1].signal.aborted)).toBe(true)
  })

  test("rejects empty speakable content before opening a socket or audio device", async () => {
    await expect(speak("\n---\n🌍")).rejects.toThrow("There is no text to read aloud")
    expect(playback).not.toHaveBeenCalled()
    expect(sockets).toHaveLength(0)
  })

  test("sends configuration and escaped SSML and forwards only MP3 payloads", async () => {
    await speak("# Hello\nA & B \"quoted\" 'single' 2 < 3")
    expect(playback).toHaveBeenCalledWith(expect.any(ReadableStream), {
      format: "mp3",
      signal: expect.any(AbortSignal),
    })
    expect(sockets).toHaveLength(1)
    const socket = sockets[0]
    expect(socket.binaryType).toBe("arraybuffer")
    expect(socket.sent).toHaveLength(2)
    expect(socket.sent[0]).toContain("Path:speech.config")
    expect(socket.sent[0]).toContain("audio-24khz-48kbitrate-mono-mp3")
    expect(socket.sent[1]).toContain("Path:ssml")
    expect(socket.sent[1]).toContain("Hello. A &amp; B &quot;quoted&quot; &apos;single&apos; 2 &lt; 3.")
    expect(socket.sent[1]).toContain("AvaMultilingualNeural")
    expect(state.bytes).toEqual([1, 2, 3, 4, 5])
    expect(socket.closed).toBe(true)
  })

  test("includes authentication and browser headers without hardcoding time-dependent hashes", async () => {
    await speak("Hello")
    const url = new URL(sockets[0].url)
    expect(url.protocol).toBe("wss:")
    expect(url.hostname).toBe("speech.platform.bing.com")
    expect(url.searchParams.get("ConnectionId")).toMatch(/^[a-f0-9]{32}$/)
    expect(url.searchParams.get("Sec-MS-GEC")).toMatch(/^[A-F0-9]{64}$/)
    expect(url.searchParams.get("TrustedClientToken")).toBeTruthy()
    expect(sockets[0].init.headers.Cookie).toMatch(/^muid=[A-F0-9]{32};$/)
    expect(sockets[0].init.headers.Origin).toStartWith("chrome-extension://")
  })

  test("downloads all chunks in order and closes each completed socket", async () => {
    await speak("First sentence. ".repeat(600))
    expect(sockets.length).toBeGreaterThan(1)
    expect(sockets.every((socket) => socket.closed)).toBe(true)
    expect(state.bytes).toEqual(sockets.flatMap(() => [1, 2, 3, 4, 5]))
    const text = sockets.map((socket) => socket.sent[1].match(/<prosody[^>]*>(.*?)<\/prosody>/)?.[1]).join(" ")
    expect(text).toBe("First sentence. ".repeat(600).trim())
  })

  test("cancellation prevents downloading later chunks", async () => {
    playback.mockImplementationOnce(async (source) => {
      await source.cancel()
      return { closed: Promise.resolve() }
    })
    await speak("Long sentence. ".repeat(900))
    await Bun.sleep(0)
    expect(sockets).toHaveLength(1)
    expect(sockets[0].closed).toBe(true)
  })

  test.each([
    ["error", "Couldn't connect to speech.platform.bing.com"],
    ["close", "Speech connection closed early (1006)"],
  ])("propagates transport %s", async (mode, message) => {
    state.mode = mode
    await expect(speak("Hello")).rejects.toThrow(message)
  })

  test("reports unavailable audio output", async () => {
    playback.mockImplementationOnce(async (source) => {
      await source.cancel()
      return null
    })
    await expect(speak("Hello")).rejects.toThrow("No audio output device")
  })

  test.each([true, false])("preserves the underlying playback error (wrapped=%s)", async (wrapped) => {
    const cause = new Error("decoder failure")
    playback.mockImplementationOnce(async (source) => {
      await source.cancel()
      throw wrapped ? new Error("download failed", { cause }) : cause
    })
    await expect(speak("Hello")).rejects.toBe(cause)
  })
} else {
  const { edgeChunks, speakable } = await import("../src/speech")
  const { dispose, playStream } = await import("../src/audio")

  describe("speakable", () => {
    test.each([
      ["# Hello\n## World", "Hello. World."],
      ["**bold** _italic_ ~~old~~ `name`", "bold italic old name."],
      ["- [x] Done\n+ [ ] Next\n1. First\n2) Second", "Done. Next. First. Second."],
      ["> A quote\n---\n***\n___", "A quote."],
      ["[Docs](https://example.com) ![Diagram](image.png)", "Docs Diagram."],
      ["See https://example.com and <https://example.org>", "See link and link."],
      ["<b>Hello</b> 🌍", "Hello."],
      ["A\u0000B\u0007C", "A B C."],
      ["| Name | Value |\n| :--- | ---: |\n| Apples | 3 |", "Name, Value. Apples, 3."],
      ["Ready?\nYes!\nNote:\nDone.", "Ready? Yes! Note: Done."],
      ["snake_case and 3 * 4", "snake_case and 3 * 4."],
      [" \n\t\n", ""],
      ["---\n🌍", ""],
    ])("cleans %j", (input, expected) => {
      expect(speakable(input)).toBe(expected)
    })

    test.each(["```", "~~~"])("omits closed and still-streaming %s code fences", (fence) => {
      expect(speakable(`Before\n${fence}ts\nsecret()\n${fence}\nAfter`)).toBe("Before. Code block omitted. After.")
      expect(speakable(`Before\n${fence}ts\nsecret()`)).toBe("Before. Code block omitted.")
      expect(speakable(fence)).toBe("Code block omitted.")
    })
  })

  describe("edgeChunks", () => {
    test("handles empty input", () => {
      expect(edgeChunks("")).toEqual([])
      expect(edgeChunks("   \n")).toEqual([])
    })

    test("packs complete sentences in order and retains punctuation", () => {
      expect(edgeChunks("One. Two! Three?", 10)).toEqual(["One. Two!", "Three?"])
    })

    test("accepts the exact byte boundary", () => {
      expect(edgeChunks("123456789.", 10)).toEqual(["123456789."])
    })

    test("counts XML expansion rather than raw characters", () => {
      expect(edgeChunks("A&B. C<D.", 10)).toEqual(["A&B.", "C<D."])
      expect(edgeChunks("\"'. X.", 14)).toEqual(["\"'.", "X."])
    })

    test("counts UTF-8 bytes rather than JavaScript character length", () => {
      expect(edgeChunks("你好. 世界.", 10)).toEqual(["你好.", "世界."])
    })

    test.each(["word ".repeat(2000), "x".repeat(9500), "&".repeat(3000), "界".repeat(4000)])(
      "keeps large requests within the default escaped-byte limit",
      (input) => {
        const chunks = edgeChunks(input)
        expect(chunks.length).toBeGreaterThan(1)
        expect(chunks.join("").replaceAll(" ", "")).toBe(input.replaceAll(" ", ""))
        for (const chunk of chunks) {
          // Use a deliberately conservative independent bound for these fixtures.
          const bytes = Buffer.byteLength(chunk.replaceAll("&", "&amp;"))
          expect(bytes).toBeLessThanOrEqual(4096)
          expect(chunk).toBe(chunk.trim())
        }
      },
    )
  })

  test("speech transport and playback boundaries in an isolated process", async () => {
    // speech.ts captures the WebSocket constructor at import time. Isolate that
    // unavoidable global replacement and module mocks from the rest of the suite.
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      cwd: new URL("..", import.meta.url).pathname,
      env: { ...process.env, OPENCODE_TTS_TRANSPORT_TEST: "1" },
      stdout: "pipe",
      stderr: "pipe",
    })
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    expect({ code, failures: code === 0 ? "" : stdout + stderr }).toEqual({ code: 0, failures: "" })
  }, 15000)

  afterEach(() => {
    dispose()
    mock.restore()
  })

  function device(started = false, starts = true) {
    const output = { id: "stream" } as unknown as Awaited<ReturnType<Audio["playStream"]>>
    const current = {
      on: mock(() => {}),
      isStarted: mock(() => started),
      start: mock(() => starts),
      playStream: mock(async (_source: AudioStreamBody, _options?: AudioStreamBodyOptions) => output),
      dispose: mock(() => {}),
    }
    const create = spyOn(Audio, "create").mockReturnValue(current as unknown as Audio)
    return { current, create, output }
  }

  describe("playStream", () => {
    test("lazily creates audio, starts it, and forwards the stream and options unchanged", async () => {
      const { current, create, output } = device()
      const source = new ReadableStream<Uint8Array>()
      const options = { format: "mp3" } as const
      expect(create).not.toHaveBeenCalled()
      expect(Object.is(await playStream(source, options), output)).toBe(true)
      expect(create).toHaveBeenCalledWith({ autoStart: false })
      expect(current.on).toHaveBeenCalledWith("error", expect.any(Function))
      expect(current.start).toHaveBeenCalledTimes(1)
      expect(current.playStream).toHaveBeenCalledWith(source, options)
    })

    test("reuses an already-started device without restarting it", async () => {
      const { current, create } = device(true)
      await playStream(new ReadableStream())
      await playStream(new ReadableStream(), { format: "flac" })
      expect(create).toHaveBeenCalledTimes(1)
      expect(current.start).not.toHaveBeenCalled()
      expect(current.playStream).toHaveBeenCalledTimes(2)
      expect(current.playStream.mock.calls[0][1]).toBeUndefined()
    })

    test("returns null and does not play when starting fails", async () => {
      const { current } = device(false, false)
      expect(await playStream(new ReadableStream())).toBeNull()
      expect(current.playStream).not.toHaveBeenCalled()
    })

    test("caches unavailable hardware until disposal, then permits retry", async () => {
      spyOn(console, "debug").mockImplementation(() => {})
      const create = spyOn(Audio, "create").mockImplementation(() => {
        throw new Error("no device")
      })
      expect(await playStream(new ReadableStream())).toBeNull()
      expect(await playStream(new ReadableStream())).toBeNull()
      expect(create).toHaveBeenCalledTimes(1)
      dispose()
      expect(await playStream(new ReadableStream())).toBeNull()
      expect(create).toHaveBeenCalledTimes(2)
    })

    test("preserves playback failures for the caller", async () => {
      const { current } = device(true)
      const error = new Error("decoder failed")
      current.playStream.mockRejectedValueOnce(error)
      await expect(playStream(new ReadableStream())).rejects.toBe(error)
    })

    test("waits for playback startup rather than resolving before the engine", async () => {
      const { current, output } = device(true)
      const ready = Promise.withResolvers<typeof output>()
      current.playStream.mockReturnValueOnce(ready.promise)
      const settled = mock(() => {})
      const task = playStream(new ReadableStream()).then(settled)
      await Promise.resolve()
      expect(settled).not.toHaveBeenCalled()
      ready.resolve(output)
      await task
      expect(settled).toHaveBeenCalledWith(output)
    })

    test("disposal releases the device and subsequent playback creates another", async () => {
      const { current, create } = device(true)
      await playStream(new ReadableStream())
      dispose()
      expect(current.dispose).toHaveBeenCalledTimes(1)
      await playStream(new ReadableStream())
      expect(create).toHaveBeenCalledTimes(2)
    })
  })

  // Execute the actual command and revert-selector expressions from the Session
  // component, without duplicating their logic or mounting unrelated TUI providers.
  // This is a focused command-unit harness, not a renderer/slash-input integration test.
  const source = ts.createSourceFile(
    "session.tsx",
    await Bun.file(new URL("../src/routes/session/index.tsx", import.meta.url)).text(),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  )
  const expressions = { command: "", visible: "" }
  function visit(node: ts.Node) {
    if (
      ts.isObjectLiteralExpression(node) &&
      node.properties.some(
        (property) =>
          ts.isPropertyAssignment(property) &&
          property.name.getText(source) === "value" &&
          ts.isStringLiteral(property.initializer) &&
          property.initializer.text === "session.speech",
      )
    )
      expressions.command = node.getText(source)
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === "messagesBeforeRevert") {
      expressions.visible = node.initializer?.getText(source) ?? ""
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  if (!expressions.command || !expressions.visible)
    throw new Error("Session speech command or revert selector not found")

  type Message = { id: string; role: "user" | "assistant"; parentID?: string }
  type Part = { type: string; text?: string }
  function harness(messages: readonly Message[], parts: Record<string, Part[]>, revert?: string) {
    const dialog = { clear: mock(() => {}) }
    const speak = mock(async (_text: string) => {})
    const evaluate = new Function(
      "messages",
      "session",
      "sync",
      "dialog",
      "speak",
      `const messagesBeforeRevert = ${expressions.visible}; return (${expressions.command});`,
    )
    const command = evaluate(
      () => messages,
      () => ({ revert: revert ? { messageID: revert } : undefined }),
      { data: { part: parts } },
      dialog,
      speak,
    ) as { title: string; value: string; category: string; slash: { name: string }; run: () => void }
    return { command, dialog, speak }
  }

  const messages: Message[] = [
    { id: "u1", role: "user" },
    { id: "a1", role: "assistant", parentID: "u1" },
    { id: "u2", role: "user" },
    { id: "a2", role: "assistant", parentID: "u2" },
    { id: "a3", role: "assistant", parentID: "u2" },
  ]
  const parts = {
    u1: [{ type: "text", text: "User secret" }],
    a1: [{ type: "text", text: "Older response" }],
    a2: [
      { type: "text", text: "First segment" },
      { type: "reasoning", text: "Private reasoning" },
    ],
    a3: [
      { type: "tool", text: "Tool output" },
      { type: "text", text: "Second segment" },
      { type: "text", text: "Third segment" },
    ],
  }

  describe("session.speech", () => {
    test("does not start speech or open an audio device when the command is unused", () => {
      const create = spyOn(Audio, "create")
      const { command, dialog, speak } = harness(messages, parts)
      expect(command.slash.name).toBe("speech")
      expect(speak).not.toHaveBeenCalled()
      expect(dialog.clear).not.toHaveBeenCalled()
      expect(create).not.toHaveBeenCalled()
    })

    test("repeated command invocation reaches the speech playback toggle", () => {
      const { command, speak } = harness(messages, parts)
      command.run()
      command.run()
      expect(speak).toHaveBeenCalledTimes(2)
      expect(speak.mock.calls[0]).toEqual(speak.mock.calls[1])
    })

    test("exposes the command palette title and /speech alias", () => {
      expect(harness([], {}).command).toMatchObject({
        title: "Speak last response",
        value: "session.speech",
        category: "Session",
        slash: { name: "speech" },
      })
    })

    test("reads all text segments from the latest assistant turn in order", () => {
      const { command, dialog, speak } = harness(messages, parts)
      command.run()
      expect(dialog.clear).toHaveBeenCalledTimes(1)
      expect(speak).toHaveBeenCalledTimes(1)
      expect(speak).toHaveBeenCalledWith("First segment\n\nSecond segment\n\nThird segment")
      expect(dialog.clear.mock.invocationCallOrder[0]).toBeLessThan(speak.mock.invocationCallOrder[0])
    })

    test("a trailing user message does not hide the last assistant response", () => {
      const { command, speak } = harness([...messages, { id: "u3", role: "user" }], parts)
      command.run()
      expect(speak).toHaveBeenCalledWith("First segment\n\nSecond segment\n\nThird segment")
    })

    test("excludes reverted messages using the real visibility selector", () => {
      const { command, speak } = harness(messages, parts, "u2")
      command.run()
      expect(speak).toHaveBeenCalledWith("Older response")
    })

    test("retains the visible portion of a partially reverted assistant turn", () => {
      const { command, speak } = harness(messages, parts, "a3")
      command.run()
      expect(speak).toHaveBeenCalledWith("First segment")
    })

    test("an unknown revert ID leaves current history visible", () => {
      const { command, speak } = harness(messages, parts, "missing")
      command.run()
      expect(speak).toHaveBeenCalledWith("First segment\n\nSecond segment\n\nThird segment")
    })

    test("tolerates missing parts during hydration", () => {
      const { command, speak } = harness(messages, { a2: parts.a2 })
      command.run()
      expect(speak).toHaveBeenCalledWith("First segment")
    })

    test.each([{ history: [] }, { history: [{ id: "u1", role: "user" as const }] }])(
      "delegates empty-content validation to speak",
      ({ history }) => {
        const { command, dialog, speak } = harness(history, {})
        command.run()
        expect(dialog.clear).toHaveBeenCalledTimes(1)
        expect(speak).toHaveBeenCalledWith("")
      },
    )
  })
}
