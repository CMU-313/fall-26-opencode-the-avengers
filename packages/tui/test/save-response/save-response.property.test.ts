import { describe, expect, test } from "bun:test"
import fc from "fast-check"
import type { AssistantMessage, Part } from "@opencode-ai/sdk/v2"
import { formatResponse, hasResponseText } from "../../src/util/transcript"

const sessionID = "ses_property"

function assistantMessage(id: string, created: number, durationMs: number): AssistantMessage {
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
    time: { created, completed: created + durationMs },
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
  test("R1: thinking, tool details and metadata appear exactly when toggled on", () => {
    fc.assert(
      fc.property(
        toggles,
        content("ANSWER:"),
        content("THINKING:"),
        content("TOOLIN:"),
        content("TOOLOUT:"),
        fc.shuffledSubarray([0, 1, 2], { minLength: 3, maxLength: 3 }),
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.integer({ min: 1, max: 600_000 }),
        (options, answer, thinking, toolInput, toolOutput, order, created, durationMs) => {
          const msg = assistantMessage("msg_r1", created, durationMs)
          const input = { command: toolInput }
          const candidates = [
            textPart(msg.id, answer),
            reasoningPart(msg.id, thinking),
            toolPart(msg.id, input, toolOutput),
          ]
          const file = formatResponse(
            msg,
            order.map((index) => candidates[index]),
            "md",
            options,
          )

          // The answer is the one thing the user always asked for.
          expect(file).toContain(answer)
          expect(file.includes("_Thinking:_")).toBe(options.thinking)
          expect(file.includes(thinking)).toBe(options.thinking)
          expect(file.includes(JSON.stringify(input, null, 2))).toBe(options.toolDetails)
          expect(file.includes(toolOutput)).toBe(options.toolDetails)
          expect(file.startsWith("## Assistant (Build · ")).toBe(options.assistantMetadata)
          if (!options.assistantMetadata) expect(file.startsWith("## Assistant\n\n")).toBe(true)
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
      }),
    )
  })
})
