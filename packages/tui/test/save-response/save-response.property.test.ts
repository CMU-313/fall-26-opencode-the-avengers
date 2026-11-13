import { describe, expect, test } from "bun:test"
import fc from "fast-check"
import type { AssistantMessage, Part, Provider } from "@opencode-ai/sdk/v2"
import { formatResponse, hasResponseText } from "../../src/util/transcript"

// Fixed seed so Stryker sees the same generated inputs on every mutant run.
fc.configureGlobal({ seed: 42 })

const sessionID = "ses_property"

// The model's display name differs from its ID, so the metadata header shows whether the provider list was used.
const providers: Provider[] = [
  {
    id: "anthropic",
    name: "Anthropic",
    source: "api",
    env: [],
    options: {},
    models: {
      claude: {
        id: "claude",
        providerID: "anthropic",
        api: { id: "claude", url: "https://example.com/claude", npm: "@ai-sdk/anthropic" },
        name: "Claude Sonnet 4",
        capabilities: {
          temperature: true,
          reasoning: true,
          attachment: true,
          toolcall: true,
          input: { text: true, audio: false, image: true, video: false, pdf: true },
          output: { text: true, audio: false, image: false, video: false, pdf: false },
          interleaved: false,
        },
        cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
        limit: { context: 200_000, output: 8_192 },
        status: "active",
        options: {},
        headers: {},
        release_date: "2025-05-14",
      },
    },
  },
]

// durationMs is undefined for a message that has not completed yet.
function assistantMessage(id: string, created: number, durationMs: number | undefined): AssistantMessage {
  return {
    id,
    sessionID,
    role: "assistant",
    agent: "build",
    modelID: "claude",
    providerID: "anthropic",
    mode: "",
    parentID: "msg_user",
    path: { cwd: "/test", root: "/test" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created, completed: durationMs === undefined ? undefined : created + durationMs },
    finish: "stop",
  }
}

function textPart(messageID: string, text: string, synthetic?: boolean): Part {
  return { id: `prt_${messageID}_text`, sessionID, messageID, type: "text", text, synthetic }
}

function reasoningPart(messageID: string, text: string): Part {
  return { id: `prt_${messageID}_reasoning`, sessionID, messageID, type: "reasoning", text, time: { start: 1 } }
}

function toolPart(messageID: string, input: Record<string, unknown>, output: string): Part {
  return {
    id: `prt_${messageID}_tool`,
    sessionID,
    messageID,
    type: "tool",
    callID: "call_1",
    tool: "bash",
    state: { status: "completed", input, output, title: "bash", metadata: {}, time: { start: 1, end: 2 } },
  }
}

function errorToolPart(messageID: string, input: Record<string, unknown>, error: string): Part {
  return {
    id: `prt_${messageID}_tool`,
    sessionID,
    messageID,
    type: "tool",
    callID: "call_1",
    tool: "bash",
    state: { status: "error", input, error, time: { start: 1, end: 2 } },
  }
}

// A part the model emits that the saved file should not show at all.
function stepStartPart(messageID: string): Part {
  return { id: `prt_${messageID}_step`, sessionID, messageID, type: "step-start" }
}

// Each section's content starts with a unique marker, so "does the file contain X" can't be satisfied by
// a different section's randomly generated text. Trailing whitespace is dropped because the saved file is
// trimmed at the end, which would otherwise make a legitimately saved answer look truncated.
const content = (marker: string) =>
  fc.string({ minLength: 1, maxLength: 40 }).map((text) => `${marker}${text.trimEnd()}`)

const toggles = fc.record({ thinking: fc.boolean(), toolDetails: fc.boolean(), assistantMetadata: fc.boolean() })

describe("R1: optional content is included only when its toggle is on", () => {
  // R1: "A .md save includes thinking, tool details and assistant metadata only when the toggle for each
  // type of information is on. When the toggle is off, that content is left out of the file."
  // Kind: invariant
  // Generators: all 8 toggle combinations come up from fc.boolean(); the three parts are put in a random
  // order, because the file must hold for any order the model produced them in. Durations start at 1ms so
  // the metadata header always has a duration to print.
  // Strengthened in P5: tool calls may have failed (error state), messages may not have finished (no
  // duration), a step-start marker is mixed in, and the checks now cover the exact metadata header, the
  // error block, paragraph breaks, and that a part toggled off leaves the file exactly as if it were absent.
  test("R1: thinking, tool details and metadata appear exactly when toggled on", () => {
    fc.assert(
      fc.property(
        toggles,
        content("ANSWER:"),
        content("THINKING:"),
        content("TOOLIN:"),
        content("TOOLOUT:"),
        fc.boolean(),
        fc.shuffledSubarray([0, 1, 2, 3], { minLength: 4, maxLength: 4 }),
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.option(fc.integer({ min: 1, max: 600_000 }), { nil: undefined }),
        (options, answer, thinking, toolInput, toolResult, toolFailed, order, created, durationMs) => {
          const msg = assistantMessage("msg_r1", created, durationMs)
          const input = { command: toolInput }
          const candidates = [
            textPart(msg.id, answer),
            reasoningPart(msg.id, thinking),
            toolFailed ? errorToolPart(msg.id, input, toolResult) : toolPart(msg.id, input, toolResult),
            stepStartPart(msg.id),
          ]
          const parts = order.map((index) => candidates[index])
          const save = (list: Part[]) => formatResponse(msg, list, "md", { ...options, providers })
          const file = save(parts)

          // The answer is the one thing the user always asked for, and it starts its own paragraph.
          expect(file).toContain(answer)
          expect(file).toContain(`\n\n${answer}`)
          expect(file.endsWith("\n") && !file.endsWith("\n\n")).toBe(true)
          expect(file.includes("_Thinking:_")).toBe(options.thinking)
          expect(file.includes(thinking)).toBe(options.thinking)
          expect(file.includes(JSON.stringify(input, null, 2))).toBe(options.toolDetails)
          expect(file.includes(toolResult)).toBe(options.toolDetails)
          expect(file.includes("**Output:**")).toBe(options.toolDetails && !toolFailed)
          expect(file.includes("**Error:**")).toBe(options.toolDetails && toolFailed)
          const duration = durationMs === undefined ? "" : ` · ${(durationMs / 1000).toFixed(1)}s`
          expect(file.startsWith(`## Assistant (Build · Claude Sonnet 4${duration})\n\n`)).toBe(
            options.assistantMetadata,
          )
          if (!options.assistantMetadata) expect(file.startsWith("## Assistant\n\n")).toBe(true)

          // Content that is toggled off, or never shown, must not leave anything behind in the file.
          expect(save(parts.filter((part) => part.type !== "step-start"))).toBe(file)
          if (!options.thinking) expect(save(parts.filter((part) => part.type !== "reasoning"))).toBe(file)
        },
      ),
    )
  })
})

describe("R2: saving through /save and the message menu gives the same file", () => {
  // R2: "Saving a message through /save and through 'Save to file' in the message menu produces the same
  // files. The menu option saves the message that was clicked, even if it is not the latest."
  // Kind: metamorphic
  // Both entry points call the same formatResponse with the message they were given, so the file may only
  // depend on that message's own content. These properties change everything *about where the message
  // sits* (ids, timestamps, which other messages exist) and check that the file does not change.
  // Generators: timestamps and durations are independent integers so older/newer ordering is arbitrary.
  test("R2: the saved file does not depend on message ids or absolute timestamps", () => {
    fc.assert(
      fc.property(
        toggles,
        content("ANSWER:"),
        content("THINKING:"),
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.integer({ min: 1, max: 600_000 }),
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.constantFrom("md" as const, "txt" as const),
        (options, answer, thinking, created, durationMs, shift, format) => {
          const slash = assistantMessage("msg_latest", created, durationMs)
          const menu = assistantMessage("msg_clicked", created + shift, durationMs)
          const parts = (id: string) => [reasoningPart(id, thinking), textPart(id, answer)]

          expect(formatResponse(menu, parts(menu.id), format, options)).toBe(
            formatResponse(slash, parts(slash.id), format, options),
          )
        },
      ),
    )
  })

  test("R2: saving an older message contains that message and none of the newer one", () => {
    fc.assert(
      fc.property(
        toggles,
        content("OLDER:"),
        content("NEWER:"),
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.constantFrom("md" as const, "txt" as const),
        (options, olderText, newerText, created, gap, format) => {
          const older = assistantMessage("msg_older", created, 10)
          const newer = assistantMessage("msg_newer", created + gap, 10)

          const olderFile = formatResponse(older, [textPart(older.id, olderText)], format, options)
          const newerFile = formatResponse(newer, [textPart(newer.id, newerText)], format, options)

          expect(olderFile).toContain(olderText)
          expect(olderFile).not.toContain("NEWER:")
          expect(newerFile).toContain(newerText)
          expect(newerFile).not.toContain("OLDER:")
        },
      ),
    )
  })
})

describe("R4: a response with no visible text is never saved", () => {
  // R4: "When a response has no visible text, no file is created, even when metadata, thinking or tool
  // details toggles are turned on."
  // Kinds: model / oracle (the expected answer comes from how the parts were generated, not from calling
  // the code), plus an invariant that the plain-text save agrees with it.
  // Generators: invisible parts are the tricky ones the guard has to reject: reasoning, tool calls,
  // synthetic text (which has text but isn't the model's answer), and whitespace-only text. Visible parts
  // contain at least one non-space character. All kinds are mixed in random order and counts, including
  // empty lists and a single visible part among many invisible ones.
  const whitespace = fc.stringMatching(/^[ \t\n\r]{0,10}$/)
  const visible = fc.string({ minLength: 1, maxLength: 30 }).filter((text) => text.trim().length > 0)

  const part = fc.oneof(
    fc.record({ visible: fc.constant(false), part: fc.string().map((text) => reasoningPart("m", text)) }),
    fc.record({
      visible: fc.constant(false),
      part: fc.string().map((text) => toolPart("m", { command: text }, text)),
    }),
    fc.record({ visible: fc.constant(false), part: fc.string().map((text) => textPart("m", text, true)) }),
    fc.record({ visible: fc.constant(false), part: whitespace.map((text) => textPart("m", text)) }),
    fc.record({ visible: fc.constant(true), part: visible.map((text) => textPart("m", text)) }),
  )

  test("R4: hasResponseText is true exactly when some part is visible answer text", () => {
    fc.assert(
      fc.property(fc.array(part, { maxLength: 8 }), (generated) => {
        const parts = generated.map((item) => item.part)
        expect(hasResponseText(parts)).toBe(generated.some((item) => item.visible))
      }),
    )
  })

  test("R4: a plain-text save is empty exactly when there is no visible text", () => {
    fc.assert(
      fc.property(fc.array(part, { maxLength: 8 }), toggles, (generated, options) => {
        const parts = generated.map((item) => item.part)
        const file = formatResponse(assistantMessage("m", 1, 1), parts, "txt", options)
        expect(file === "").toBe(!hasResponseText(parts))

        // Strengthened in P5: every visible answer keeps its own paragraph, in order, with nothing glued on.
        const answers = generated
          .filter((item) => item.visible)
          .map((item) => (item.part.type === "text" ? item.part.text.trim() : ""))
        answers.slice(1).forEach((next, index) => expect(file).toContain(`${answers[index]}\n\n${next}`))
      }),
    )
  })
})
