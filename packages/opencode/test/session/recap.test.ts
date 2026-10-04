import { describe, expect, test } from "bun:test"
import { SessionRecap } from "@/session/recap"

const user = (text: string) => ({ role: "user" as const, text })
const assistant = (text: string) => ({ role: "assistant" as const, text })

describe("SessionRecap.parsePlanItems", () => {
  test("reads unchecked and checked items", () => {
    expect(SessionRecap.parsePlanItems([assistant("- [ ] add login page\n- [x] set up database")])).toEqual([
      { text: "add login page", done: false },
      { text: "set up database", done: true },
    ])
  })

  test("accepts asterisk bullets, capital X, and indentation", () => {
    expect(SessionRecap.parsePlanItems([assistant("  * [X] deploy\n\t- [ ] monitor")])).toEqual([
      { text: "deploy", done: true },
      { text: "monitor", done: false },
    ])
  })

  test("lets a later mention of the same item win", () => {
    // Plans get re-posted as work lands; the newest checkbox is the truth.
    expect(SessionRecap.parsePlanItems([assistant("- [ ] write tests"), assistant("- [x] write tests")])).toEqual([
      { text: "write tests", done: true },
    ])
  })

  test("treats items differing only in case as the same item", () => {
    const items = SessionRecap.parsePlanItems([assistant("- [ ] Add Tests"), assistant("- [x] add tests")])
    expect(items).toHaveLength(1)
    expect(items[0]!.done).toBe(true)
  })

  test("keeps the first spelling when a later mention re-cases it", () => {
    // Map.set on an existing key keeps the original insertion position but
    // replaces the value, so the later text wins.
    expect(SessionRecap.parsePlanItems([assistant("- [ ] Add Tests"), assistant("- [x] add tests")])[0]!.text).toBe(
      "add tests",
    )
  })

  test("preserves the order items first appeared in", () => {
    const items = SessionRecap.parsePlanItems([assistant("- [ ] one\n- [ ] two\n- [ ] three"), assistant("- [x] one")])
    expect(items.map((item) => item.text)).toEqual(["one", "two", "three"])
  })

  test("scans user messages as well as assistant messages", () => {
    expect(SessionRecap.parsePlanItems([user("- [ ] from the user")])).toEqual([{ text: "from the user", done: false }])
  })

  test("trims trailing whitespace from item text", () => {
    expect(SessionRecap.parsePlanItems([assistant("- [ ] spaced out   ")])[0]!.text).toBe("spaced out")
  })

  test("ignores lines that are not checklists", () => {
    expect(
      SessionRecap.parsePlanItems([
        assistant(
          "Here is what I did:\n- a plain bullet\n1. [ ] numbered\n-[ ] no space after the bullet\n[ ] no bullet",
        ),
      ]),
    ).toEqual([])
  })

  test("ignores a checkbox with no text after it", () => {
    expect(SessionRecap.parsePlanItems([assistant("- [ ] ")])).toEqual([])
  })

  test("returns nothing for no messages", () => {
    expect(SessionRecap.parsePlanItems([])).toEqual([])
  })
})

describe("SessionRecap.buildTranscript", () => {
  test("labels each message with its role", () => {
    expect(SessionRecap.buildTranscript([user("hello"), assistant("hi")])).toBe("USER: hello\n\nASSISTANT: hi")
  })

  test("drops blank messages", () => {
    expect(SessionRecap.buildTranscript([user("hello"), assistant("   "), assistant("hi")])).toBe(
      "USER: hello\n\nASSISTANT: hi",
    )
  })

  test("trims each message body", () => {
    expect(SessionRecap.buildTranscript([user("  padded  ")])).toBe("USER: padded")
  })

  test("returns an empty string when every message is blank", () => {
    expect(SessionRecap.buildTranscript([user(""), assistant("  ")])).toBe("")
  })

  test("keeps the end of an over-long transcript, not the start", () => {
    // Where you left off matters more than where you began.
    const result = SessionRecap.buildTranscript([user("x".repeat(20_000)), assistant("THE LAST THING")])
    expect(result.startsWith("...(earlier messages omitted)...\n")).toBe(true)
    expect(result.endsWith("THE LAST THING")).toBe(true)
    expect(result).not.toContain("USER:")
  })

  test("leaves a transcript under the cap untouched", () => {
    const result = SessionRecap.buildTranscript([user("short")])
    expect(result).toBe("USER: short")
    expect(result).not.toContain("omitted")
  })
})

describe("SessionRecap.buildPrompt", () => {
  test("asks the model to base next steps on unfinished items when there was a plan", () => {
    const prompt = SessionRecap.buildPrompt("T", ["ship it", "write docs"], true)
    expect(prompt).toContain("The session had a plan")
    expect(prompt).toContain("- ship it")
    expect(prompt).toContain("- write docs")
    expect(prompt).toContain("Base nextSteps on these unfinished items")
  })

  test("says so explicitly when a plan exists but everything is done", () => {
    expect(SessionRecap.buildPrompt("T", [], true)).toContain("(none, all done)")
  })

  test("asks for free-form recommendations when there was no plan", () => {
    const prompt = SessionRecap.buildPrompt("T", [], false)
    expect(prompt).toContain("no explicit plan")
    expect(prompt).toContain("2-4 reasonable next steps")
    expect(prompt).not.toContain("Base nextSteps")
  })

  test("always includes the transcript", () => {
    expect(SessionRecap.buildPrompt("THE TRANSCRIPT", [], false)).toContain("TRANSCRIPT:\nTHE TRANSCRIPT")
  })
})

describe("SessionRecap.parseModelOutput", () => {
  test("reads plain JSON", () => {
    expect(SessionRecap.parseModelOutput('{"completed":["a"],"nextSteps":["b"]}')).toEqual({
      completed: ["a"],
      nextSteps: ["b"],
    })
  })

  test("strips a fenced code block", () => {
    expect(SessionRecap.parseModelOutput('```json\n{"completed":["a"],"nextSteps":[]}\n```')).toEqual({
      completed: ["a"],
      nextSteps: [],
    })
  })

  test("ignores prose around the JSON", () => {
    expect(
      SessionRecap.parseModelOutput('Sure! Here you go:\n{"completed":["a"],"nextSteps":[]}\nHope that helps.'),
    ).toEqual({ completed: ["a"], nextSteps: [] })
  })

  test("defaults a missing list to empty", () => {
    expect(SessionRecap.parseModelOutput('{"completed":["a"]}')).toEqual({ completed: ["a"], nextSteps: [] })
    expect(SessionRecap.parseModelOutput("{}")).toEqual({ completed: [], nextSteps: [] })
  })

  test("handles nested objects by taking the outermost braces", () => {
    expect(SessionRecap.parseModelOutput('{"completed":["a"],"nextSteps":[],"extra":{"nested":true}}')).toEqual({
      completed: ["a"],
      nextSteps: [],
    })
  })

  // A bad model response must never break resuming a session.
  test.each([
    ["not json at all", "plain prose"],
    ["malformed json", '{"completed": ['],
    ["empty string", ""],
    ["wrong value types", '{"completed":"a string","nextSteps":[]}'],
    ["a JSON array", "[1,2,3]"],
    ["numbers inside the list", '{"completed":[1,2],"nextSteps":[]}'],
  ])("falls back to empty lists for %s", (_label, input) => {
    expect(SessionRecap.parseModelOutput(input)).toEqual({ completed: [], nextSteps: [] })
  })
})

describe("SessionRecap.format", () => {
  const base = { hadPlan: true, generatedAt: 0, sourceUpdatedAt: 0 }

  test("renders every section as bullets", () => {
    expect(SessionRecap.format({ ...base, completed: ["did a"], carriedOver: ["left b"], nextSteps: ["do b"] })).toBe(
      [
        "Welcome back! Here's where you left off:",
        "Completed:\n  • did a",
        "Unfinished from your plan:\n  • left b",
        "Next steps:\n  • do b",
      ].join("\n\n"),
    )
  })

  test("omits sections that have no items", () => {
    const out = SessionRecap.format({ ...base, completed: ["did a"], carriedOver: [], nextSteps: [] })
    expect(out).toContain("Completed:")
    expect(out).not.toContain("Unfinished")
    expect(out).not.toContain("Next steps")
  })

  test("calls next steps suggested when there was no plan", () => {
    const out = SessionRecap.format({ ...base, hadPlan: false, completed: [], carriedOver: [], nextSteps: ["try x"] })
    expect(out).toContain("Suggested next steps:")
  })

  test("returns just the greeting when the recap is empty", () => {
    expect(SessionRecap.format({ ...base, completed: [], carriedOver: [], nextSteps: [] })).toBe(
      "Welcome back! Here's where you left off:",
    )
  })
})
