// packages/opencode/src/session/recap.ts
//
// WHAT THIS FILE DOES
// When a user comes back to a project, we show them a "recap":
//   1. completed    -> what got done last session (summarized by the LLM)
//   2. carriedOver  -> plan items that were NOT finished (computed by US, not the LLM)
//   3. nextSteps    -> recommendations (from the LLM; built from carriedOver if there was a plan)
//
// KEY DESIGN IDEA (worth learning):
//   Use code for things that must be exact, and use the LLM for things that need judgment.
//   "Which checklist items are unchecked?" has one right answer, so we compute it in code.
//   "Summarize what happened" needs judgment, so we ask the model.
//   This keeps the "unfinished items are carried over" acceptance criterion reliable.

import { z } from "zod"

export namespace Recap {
  // ---------------------------------------------------------------------------
  // 1. TYPES
  // zod schemas let us validate data at runtime (e.g. model output, stored JSON),
  // and z.infer gives us the matching TypeScript type for free.
  // ---------------------------------------------------------------------------

  export const PlanItem = z.object({
    text: z.string(),
    done: z.boolean(),
  })
  export type PlanItem = z.infer<typeof PlanItem>

  export const Result = z.object({
    completed: z.array(z.string()),
    carriedOver: z.array(z.string()),
    nextSteps: z.array(z.string()),
    hadPlan: z.boolean(),
    generatedAt: z.number(), // when we made this recap
    sourceUpdatedAt: z.number(), // the session's "last updated" time when we made it
  })
  export type Result = z.infer<typeof Result>

  // A simplified message. We convert OpenCode's richer message objects into this
  // so the recap logic doesn't depend on OpenCode's internal message shape.
  export interface SimpleMessage {
    role: "user" | "assistant"
    text: string
  }

  // ---------------------------------------------------------------------------
  // 2. DEPENDENCIES ("dependency injection")
  // Instead of importing Session/Storage/Provider directly, we ask the caller to
  // pass in these functions. Two benefits:
  //   - Tests can pass fake versions (no real LLM or disk needed).
  //   - If OpenCode's internal API changes, you only fix the wiring, not this file.
  // ---------------------------------------------------------------------------

  export interface Deps {
    loadMessages(sessionID: string): Promise<SimpleMessage[]>
    loadTodos?(sessionID: string): Promise<PlanItem[]> // optional: OpenCode's todo list, if you use it
    callModel(system: string, prompt: string): Promise<string> // returns the model's raw text
    read(key: string[]): Promise<unknown | undefined>
    write(key: string[], value: unknown): Promise<void>
    sessionUpdatedAt(sessionID: string): Promise<number>
  }

  const MAX_TRANSCRIPT_CHARS = 12_000 // keeps the prompt small (cheaper, faster)

  // Where recaps live in storage: ["recap", "<sessionID>"]
  const storageKey = (sessionID: string) => ["recap", sessionID]

  // ---------------------------------------------------------------------------
  // 3. PLAN PARSING (pure function = easy to test)
  // Finds markdown checklists like:
  //   - [ ] add login page
  //   - [x] set up database
  // If the same item appears again later with a different checkbox, the LATER
  // one wins, because plans get updated as work happens.
  // ---------------------------------------------------------------------------

  export function parsePlanItems(messages: SimpleMessage[]): PlanItem[] {
    // ^\s*        start of line, optional indentation
    // [-*]\s+     a bullet "-" or "*"
    // \[( |x|X)\] the checkbox; group 1 captures " " or "x"
    // \s+(.+)$    the item text; group 2
    // flags: g = find all matches, m = ^ and $ match per line
    const pattern = /^\s*[-*]\s+\[( |x|X)\]\s+(.+)$/gm

    // Map keeps insertion order AND lets later entries overwrite earlier ones.
    const items = new Map<string, PlanItem>()

    for (const msg of messages) {
      for (const match of msg.text.matchAll(pattern)) {
        const text = match[2].trim()
        const key = text.toLowerCase() // "Add Tests" and "add tests" count as the same item
        items.set(key, { text, done: match[1].toLowerCase() === "x" })
      }
    }
    return [...items.values()]
  }

  // ---------------------------------------------------------------------------
  // 4. TRANSCRIPT BUILDING
  // Turn messages into plain text for the prompt. If it's too long we keep the
  // END, because the most recent work matters most for "where did I leave off".
  // ---------------------------------------------------------------------------

  export function buildTranscript(messages: SimpleMessage[]): string {
    const full = messages
      .filter((m) => m.text.trim().length > 0)
      .map((m) => `${m.role.toUpperCase()}: ${m.text.trim()}`)
      .join("\n\n")
    return full.length > MAX_TRANSCRIPT_CHARS
      ? "...(earlier messages omitted)...\n" + full.slice(-MAX_TRANSCRIPT_CHARS)
      : full
  }

  // ---------------------------------------------------------------------------
  // 5. PROMPT
  // We tell the model exactly what JSON shape to return. Two branches:
  //   - had a plan -> next steps should come from the unfinished items
  //   - no plan    -> model recommends reasonable next steps on its own
  // ---------------------------------------------------------------------------

  const SYSTEM = [
    "You summarize a coding session so the developer can resume later.",
    "Respond with ONLY a JSON object, no markdown fences, no extra text.",
    'Shape: {"completed": string[], "nextSteps": string[]}',
    "Each entry is one short, concrete sentence. Max 6 entries per list.",
    "Only list work that actually happened in the transcript. Do not invent work.",
  ].join("\n")

  export function buildPrompt(transcript: string, unfinished: string[], hadPlan: boolean): string {
    const planSection = hadPlan
      ? `The session had a plan. These items are still unfinished:\n${unfinished.map((t) => `- ${t}`).join("\n") || "(none, all done)"}\n` +
        "Base nextSteps on these unfinished items, in a sensible order."
      : "The session had no explicit plan. Recommend 2-4 reasonable next steps based on the work so far."

    return `${planSection}\n\nTRANSCRIPT:\n${transcript}`
  }

  // ---------------------------------------------------------------------------
  // 6. PARSING THE MODEL'S ANSWER (defensive)
  // Models sometimes wrap JSON in ```json fences or return junk. We never let a
  // bad model response crash the resume flow; we fall back to empty lists.
  // ---------------------------------------------------------------------------

  const ModelOutput = z.object({
    completed: z.array(z.string()).default([]),
    nextSteps: z.array(z.string()).default([]),
  })

  export function parseModelOutput(raw: string): z.infer<typeof ModelOutput> {
    try {
      const cleaned = raw.replace(/```json|```/g, "").trim()
      // If there's extra text around the JSON, grab from the first { to the last }
      const start = cleaned.indexOf("{")
      const end = cleaned.lastIndexOf("}")
      const json = JSON.parse(cleaned.slice(start, end + 1))
      return ModelOutput.parse(json)
    } catch {
      return { completed: [], nextSteps: [] }
    }
  }

  // ---------------------------------------------------------------------------
  // 7. GENERATE: the main pipeline
  //   messages -> plan items -> carriedOver (code) -> model call -> save
  // ---------------------------------------------------------------------------

  export async function generate(sessionID: string, deps: Deps): Promise<Result> {
    const messages = await deps.loadMessages(sessionID)
    const updatedAt = await deps.sessionUpdatedAt(sessionID)

    // Prefer OpenCode's structured todo list if it has items; otherwise parse checklists from chat.
    const todos = deps.loadTodos ? await deps.loadTodos(sessionID) : []
    const plan = todos.length > 0 ? todos : parsePlanItems(messages)
    const hadPlan = plan.length > 0

    // Computed in code, so it's always accurate (acceptance criterion #2).
    const carriedOver = plan.filter((p) => !p.done).map((p) => p.text)

    // Empty session? Skip the model call entirely; no point paying for it.
    let modelOut = { completed: [] as string[], nextSteps: [] as string[] }
    if (messages.length > 0) {
      const raw = await deps
        .callModel(SYSTEM, buildPrompt(buildTranscript(messages), carriedOver, hadPlan))
        .catch(() => "") // network/model error -> treated like a bad response
      modelOut = parseModelOutput(raw)
    }

    const result: Result = {
      completed: modelOut.completed,
      carriedOver,
      // If the model gave nothing but we have unfinished plan items, use those as next steps.
      nextSteps: modelOut.nextSteps.length > 0 ? modelOut.nextSteps : carriedOver,
      hadPlan,
      generatedAt: Date.now(),
      sourceUpdatedAt: updatedAt,
    }

    await deps.write(storageKey(sessionID), result)
    return result
  }

  // ---------------------------------------------------------------------------
  // 8. GET (with caching)
  // Call this on resume. Reuses the saved recap unless the session changed since
  // it was made. This avoids an LLM call every time someone opens the project.
  // ---------------------------------------------------------------------------

  export async function get(sessionID: string, deps: Deps): Promise<Result> {
    const updatedAt = await deps.sessionUpdatedAt(sessionID)
    const stored = await deps.read(storageKey(sessionID)).catch(() => undefined)
    const parsed = Result.safeParse(stored) // safeParse doesn't throw; check .success

    if (parsed.success && parsed.data.sourceUpdatedAt >= updatedAt) return parsed.data
    return generate(sessionID, deps)
  }

  // ---------------------------------------------------------------------------
  // 9. FORMAT for display (TUI / CLI). Frontend can also use the Result directly.
  // ---------------------------------------------------------------------------

  export function format(r: Result): string {
    const section = (title: string, items: string[]) =>
      items.length ? `${title}\n${items.map((i) => `  • ${i}`).join("\n")}` : ""

    return [
      "Welcome back! Here's where you left off:",
      section("Completed:", r.completed),
      section("Unfinished from your plan:", r.carriedOver),
      section(r.hadPlan ? "Next steps:" : "Suggested next steps:", r.nextSteps),
    ]
      .filter(Boolean)
      .join("\n\n")
  }
}
