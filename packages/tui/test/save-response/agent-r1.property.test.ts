import { describe, expect, test } from "bun:test"
import fc from "fast-check"
import type { AssistantMessage, Part, Provider } from "@opencode-ai/sdk/v2"
import { formatResponse } from "../../src/util/transcript"

// Agent failure case (P5). The original version of this property was written by opencode (gemini-3.6-flash);
// see "Agent failure case" in traceability/kgeng2.md. Its generator only varied the three toggles: the
// message, parts, part order and duration were constants, and the tool call always completed. So a mutant
// that leaks a failed tool's error message with tool details off (mutants/kgeng2/agent-failure.patch)
// survived. This strengthened version generates those too.
fc.configureGlobal({ seed: 42 })

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

const marked = (marker: string) =>
  fc.string({ minLength: 1, maxLength: 30 }).map((text) => `${marker}${text.trimEnd()}`)

describe("Requirement R1: save response to file inclusion toggles", () => {
  test("formatResponse includes thinking, tool details, and assistant metadata only when enabled", () => {
    fc.assert(
      fc.property(
        fc.record({
          thinking: fc.boolean(),
          toolDetails: fc.boolean(),
          assistantMetadata: fc.boolean(),
        }),
        marked("ANSWER:"),
        marked("REASONING:"),
        marked("CMD:"),
        marked("RESULT:"),
        // The tool call may have completed or failed; failed calls carry an error message instead of output.
        fc.constantFrom("completed" as const, "error" as const),
        fc.shuffledSubarray([0, 1, 2], { minLength: 3, maxLength: 3 }),
        fc.option(fc.integer({ min: 1, max: 600_000 }), { nil: undefined }),
        (toggles, answer, reasoning, command, result, status, order, durationMs) => {
          const msg: AssistantMessage = {
            id: "msg_1",
            sessionID: "ses_1",
            role: "assistant",
            agent: "build",
            modelID: "claude",
            providerID: "anthropic",
            mode: "",
            parentID: "msg_0",
            path: { cwd: "/test", root: "/test" },
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            time: { created: 1000000, completed: durationMs === undefined ? undefined : 1000000 + durationMs },
            finish: "stop",
          }

          const reasoningPart: Part = {
            id: "p_reasoning",
            sessionID: "ses_1",
            messageID: "msg_1",
            type: "reasoning",
            text: reasoning,
            time: { start: 1000 },
          }
          const toolPart: Part = {
            id: "p_tool",
            sessionID: "ses_1",
            messageID: "msg_1",
            type: "tool",
            callID: "call_1",
            tool: "bash",
            state:
              status === "completed"
                ? {
                    status,
                    input: { command },
                    output: result,
                    title: "bash",
                    metadata: {},
                    time: { start: 1000, end: 1100 },
                  }
                : { status, input: { command }, error: result, time: { start: 1000, end: 1100 } },
          }
          const textPart: Part = { id: "p_text", sessionID: "ses_1", messageID: "msg_1", type: "text", text: answer }
          const parts = order.map((index) => [reasoningPart, toolPart, textPart][index])

          const file = formatResponse(msg, parts, "md", { ...toggles, providers })

          // Message answer text is always present regardless of toggles
          expect(file).toContain(answer)

          // Assistant metadata toggle check; an unfinished message has no duration to show
          const duration = durationMs === undefined ? "" : ` · ${(durationMs / 1000).toFixed(1)}s`
          expect(file.startsWith(`## Assistant (Build · Claude Sonnet 4${duration})\n\n`)).toBe(
            toggles.assistantMetadata,
          )
          if (!toggles.assistantMetadata) expect(file.startsWith("## Assistant\n\n")).toBe(true)

          // Thinking toggle check; with thinking off the file is exactly as if there were no reasoning part
          expect(file.includes("_Thinking:_")).toBe(toggles.thinking)
          expect(file.includes(reasoning)).toBe(toggles.thinking)
          if (!toggles.thinking)
            expect(
              formatResponse(
                msg,
                parts.filter((part) => part !== reasoningPart),
                "md",
                { ...toggles, providers },
              ),
            ).toBe(file)

          // Tool details toggle check, for both completed and failed tool calls
          expect(file.includes(JSON.stringify({ command }, null, 2))).toBe(toggles.toolDetails)
          expect(file.includes(result)).toBe(toggles.toolDetails)
          expect(file.includes("**Input:**")).toBe(toggles.toolDetails)
          expect(file.includes("**Output:**")).toBe(toggles.toolDetails && status === "completed")
          expect(file.includes("**Error:**")).toBe(toggles.toolDetails && status === "error")
        },
      ),
    )
  })
})
