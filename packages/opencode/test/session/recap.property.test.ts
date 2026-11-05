import { describe, expect, test } from "bun:test"
import fc from "fast-check"
import { SessionRecap } from "@/session/recap"

// Words over a four-letter alphabet. The small alphabet makes repeated plan
// items likely, which is what the "later mention wins" rules need to be hit.
const word = fc
  .array(fc.constantFrom("a", "b", "c", "d"), { minLength: 1, maxLength: 4 })
  .map((letters) => letters.join(""))

const role = fc.constantFrom("user", "assistant")

// Mirrors the private cap and marker in recap.ts.
const MAX_TRANSCRIPT_CHARS = 12_000
const OMITTED = "...(earlier messages omitted)...\n"

describe("parsePlanItems properties", () => {
  type Entry = { text: string; done: boolean; bullet: string; mark: string }

  const entry = fc.record({
    text: fc.tuple(word, fc.boolean()).map(([w, upper]) => (upper ? w.toUpperCase() : w)),
    done: fc.boolean(),
    bullet: fc.constantFrom("-", "*"),
    mark: fc.constantFrom("x", "X"),
  })

  const line = (e: Entry) => `${e.bullet} [${e.done ? e.mark : " "}] ${e.text}`

  test("never throws, whatever the messages contain", () => {
    fc.assert(
      fc.property(fc.array(fc.record({ role, text: fc.string() })), (messages) => {
        expect(Array.isArray(SessionRecap.parsePlanItems(messages))).toBe(true)
      }),
    )
  })

  test("finds nothing in text that has no checkboxes", () => {
    const prose = fc.array(word).map((words) => words.join(" "))
    fc.assert(
      fc.property(fc.array(fc.record({ role, text: prose })), (messages) => {
        expect(SessionRecap.parsePlanItems(messages)).toEqual([])
      }),
    )
  })

  test("keeps one item per name, in first-seen order, with the last checkbox and spelling", () => {
    fc.assert(
      fc.property(fc.array(entry, { maxLength: 12 }), fc.boolean(), (entries, single) => {
        const lines = entries.map(line)
        const messages = single
          ? [{ role: "assistant" as const, text: lines.join("\n") }]
          : lines.map((text) => ({ role: "assistant" as const, text }))

        const items = SessionRecap.parsePlanItems(messages)

        const names = entries.map((e) => e.text.toLowerCase()).filter((name, i, all) => all.indexOf(name) === i)
        expect(items.map((item) => item.text.toLowerCase())).toEqual(names)

        for (const item of items) {
          const last = entries.findLast((e) => e.text.toLowerCase() === item.text.toLowerCase())
          expect(item.done).toBe(last?.done)
          expect(item.text).toBe(last?.text)
        }
      }),
    )
  })

  test("does not turn an empty checkbox into a plan item", () => {
    const padding = fc.array(fc.constantFrom(" ", "\t"), { maxLength: 3 }).map((p) => p.join(""))
    fc.assert(
      fc.property(
        fc.constantFrom("-", "*"),
        fc.constantFrom(" ", "x"),
        padding,
        fc.option(word, { nil: undefined }),
        (bullet, mark, pad, following) => {
          const text = `${bullet} [${mark}]${pad}` + (following === undefined ? "" : `\n${following}`)
          expect(SessionRecap.parsePlanItems([{ role: "assistant", text }])).toEqual([])
        },
      ),
    )
  })
})

describe("buildTranscript properties", () => {
  const bigText = fc.integer({ min: 1, max: 9000 }).map((n) => "x".repeat(n))
  const anyMessage = fc.record({ role, text: fc.oneof(fc.string(), bigText) })

  test("never exceeds the cap plus the omission marker", () => {
    fc.assert(
      fc.property(fc.array(anyMessage, { maxLength: 8 }), (messages) => {
        expect(SessionRecap.buildTranscript(messages).length).toBeLessThanOrEqual(
          MAX_TRANSCRIPT_CHARS + OMITTED.length,
        )
      }),
    )
  })

  test("is empty when every message is blank", () => {
    const blank = fc.constantFrom("", " ", "\n", "\t", "  \n ")
    fc.assert(
      fc.property(fc.array(fc.record({ role, text: blank })), (messages) => {
        expect(SessionRecap.buildTranscript(messages)).toBe("")
      }),
    )
  })

  test("leaves a short transcript untouched", () => {
    fc.assert(
      fc.property(fc.array(fc.record({ role, text: fc.string({ maxLength: 100 }) }), { maxLength: 20 }), (messages) => {
        expect(SessionRecap.buildTranscript(messages).startsWith(OMITTED)).toBe(false)
      }),
    )
  })

  test("when over the cap, keeps exactly the most recent characters", () => {
    const big = fc.record({ role, text: fc.integer({ min: 3000, max: 6000 }).map((n) => "x".repeat(n)) })
    fc.assert(
      fc.property(fc.array(big, { minLength: 5, maxLength: 8 }), word, (messages, tail) => {
        const out = SessionRecap.buildTranscript([...messages, { role: "assistant", text: `the end ${tail}` }])

        expect(out.startsWith(OMITTED)).toBe(true)
        expect(out.length).toBe(OMITTED.length + MAX_TRANSCRIPT_CHARS)
        expect(out.endsWith(`ASSISTANT: the end ${tail}`)).toBe(true)
      }),
      { numRuns: 50 },
    )
  })
})

describe("parseModelOutput properties", () => {
  type Lists = { completed: readonly string[]; nextSteps: readonly string[] }

  const plain = fc.string().filter((s) => !s.includes("`"))
  const lists = fc.record({ completed: fc.array(plain, { maxLength: 5 }), nextSteps: fc.array(plain, { maxLength: 5 }) })

  test("always returns two lists of strings, whatever the model said", () => {
    const anything = fc.oneof(fc.string(), fc.json(), fc.string().map((s) => `{${s}}`))
    fc.assert(
      fc.property(anything, (raw) => {
        const out: Lists = SessionRecap.parseModelOutput(raw)
        expect(out.completed.every((item) => typeof item === "string")).toBe(true)
        expect(out.nextSteps.every((item) => typeof item === "string")).toBe(true)
      }),
    )
  })

  test("returns exactly what was serialized", () => {
    fc.assert(
      fc.property(lists, (value) => {
        expect(SessionRecap.parseModelOutput(JSON.stringify(value))).toEqual(value)
      }),
    )
  })

  test("still reads it when wrapped in a code fence or in prose", () => {
    fc.assert(
      fc.property(lists, (value) => {
        const json = JSON.stringify(value)
        expect(SessionRecap.parseModelOutput("```json\n" + json + "\n```")).toEqual(value)
        expect(SessionRecap.parseModelOutput(`Sure! Here you go:\n${json}\nHope that helps.`)).toEqual(value)
      }),
    )
  })

  test("keeps backticks inside a summary line intact", () => {
    const snippet = fc
      .array(fc.oneof(fc.string(), fc.constantFrom("```", "```json", "`")))
      .map((parts) => parts.join(""))
    fc.assert(
      fc.property(fc.array(snippet, { maxLength: 4 }), (completed) => {
        const value = { completed, nextSteps: [] }
        expect(SessionRecap.parseModelOutput(JSON.stringify(value))).toEqual(value)
      }),
    )
  })
})

describe("format properties", () => {
  const list = fc.array(word, { maxLength: 4 })
  const result = fc.record({
    completed: list,
    carriedOver: list,
    nextSteps: list,
    hadPlan: fc.boolean(),
    generatedAt: fc.nat(),
    sourceUpdatedAt: fc.nat(),
  })

  test("opens with the greeting and lists every item on its own line", () => {
    fc.assert(
      fc.property(result, (r) => {
        const out = SessionRecap.format(r)
        expect(out.startsWith("Welcome back! Here's where you left off:")).toBe(true)
        for (const item of [...r.completed, ...r.carriedOver, ...r.nextSteps]) {
          expect(out.split("\n")).toContain(`  • ${item}`)
        }
      }),
    )
  })

  test("shows a section exactly when it has items, and names next steps by whether there was a plan", () => {
    fc.assert(
      fc.property(result, (r) => {
        const out = SessionRecap.format(r)
        expect(out.includes("Completed:")).toBe(r.completed.length > 0)
        expect(out.includes("Unfinished from your plan:")).toBe(r.carriedOver.length > 0)
        expect(out.includes("Next steps:")).toBe(r.hadPlan && r.nextSteps.length > 0)
        expect(out.includes("Suggested next steps:")).toBe(!r.hadPlan && r.nextSteps.length > 0)
      }),
    )
  })
})

describe("buildPrompt properties", () => {
  test("always ends with the transcript, whatever it contains", () => {
    fc.assert(
      fc.property(fc.string(), fc.array(word), fc.boolean(), (transcript, unfinished, hadPlan) => {
        const prompt = SessionRecap.buildPrompt(transcript, unfinished, hadPlan)
        expect(prompt.endsWith(`TRANSCRIPT:\n${transcript}`)).toBe(true)
      }),
    )
  })

  test("lists every unfinished item when there was a plan", () => {
    fc.assert(
      fc.property(fc.array(word, { minLength: 1 }), (unfinished) => {
        const lines = SessionRecap.buildPrompt("t", unfinished, true).split("\n")
        for (const item of unfinished) expect(lines).toContain(`- ${item}`)
      }),
    )
  })
})
