// packages/opencode/src/session/recap.ts
//
// WHAT THIS FILE DOES
// When a user comes back to a project, we show them a "recap":
//   1. completed    -> what got done last session (summarized by the LLM)
//   2. carriedOver  -> plan items that were NOT finished (computed by US, not the LLM)
//   3. nextSteps    -> recommendations (from the LLM; built from carriedOver if there was a plan)

import { Effect, Layer, Context, Stream, Schema, Option } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { LLMEvent } from "@opencode-ai/llm"
import { Session } from "./session"
import { Todo } from "./todo"
import { LLM } from "./llm"
import { Storage } from "@/storage/storage"
import { Agent } from "@/agent/agent"
import { Provider } from "@/provider/provider"
import type { SessionID } from "./schema"

// ---------------------------------------------------------------------------
// 1. TYPES
// Effect schemas validate data at runtime (stored JSON, model output) and double
// as the HTTP response type. Schema.Schema.Type gives the matching TS type.
// ---------------------------------------------------------------------------

export interface PlanItem {
  text: string
  done: boolean
}

export const Result = Schema.Struct({
  completed: Schema.Array(Schema.String),
  carriedOver: Schema.Array(Schema.String),
  nextSteps: Schema.Array(Schema.String),
  hadPlan: Schema.Boolean,
  generatedAt: Schema.Number, // when we made this recap
  sourceUpdatedAt: Schema.Number, // the session's "last updated" time when we made it
}).annotate({ identifier: "SessionRecap" })
export type Result = Schema.Schema.Type<typeof Result>

// A simplified message. We convert OpenCode's richer message objects into this
// so the recap logic doesn't depend on OpenCode's internal message shape.
export interface SimpleMessage {
  role: "user" | "assistant"
  text: string
}

const MAX_TRANSCRIPT_CHARS = 12_000 // keeps the prompt small (cheaper, faster)

// Stored recaps are untrusted JSON (old format, hand edits), so decode before use
const decodeResult = Schema.decodeUnknownOption(Result)

// Where recaps live in storage: ["recap", "<sessionID>"]
const storageKey = (sessionID: string) => ["recap", sessionID]

// ---------------------------------------------------------------------------
// 2. PLAN PARSING (pure function = easy to test)
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
// 3. TRANSCRIPT BUILDING
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
// 4. PROMPT
// The JSON shape and rules live in the "recap" agent's system prompt
// (agent/prompt/recap.txt). This builds the per-session user message. Two branches:
//   - had a plan -> next steps should come from the unfinished items
//   - no plan    -> model recommends reasonable next steps on its own
// ---------------------------------------------------------------------------

export function buildPrompt(transcript: string, unfinished: string[], hadPlan: boolean): string {
  const planSection = hadPlan
    ? `The session had a plan. These items are still unfinished:\n${unfinished.map((t) => `- ${t}`).join("\n") || "(none, all done)"}\n` +
      "Base nextSteps on these unfinished items, in a sensible order."
    : "The session had no explicit plan. Recommend 2-4 reasonable next steps based on the work so far."

  return `${planSection}\n\nTRANSCRIPT:\n${transcript}`
}

// ---------------------------------------------------------------------------
// 5. PARSING THE MODEL'S ANSWER (defensive)
// Models sometimes wrap JSON in ```json fences or return junk. We never let a
// bad model response crash the resume flow; we fall back to empty lists.
// ---------------------------------------------------------------------------

const StringList = Schema.Array(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed([])))

// Decodes a JSON string straight into {completed, nextSteps}; missing lists become []
const decodeModelOutput = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ completed: StringList, nextSteps: StringList })),
)

export function parseModelOutput(raw: string) {
  const cleaned = raw.replace(/```json|```/g, "").trim()
  // If there's extra text around the JSON, grab from the first { to the last }
  return decodeModelOutput(cleaned.slice(cleaned.indexOf("{"), cleaned.lastIndexOf("}") + 1)).pipe(
    Option.getOrElse(() => ({ completed: [], nextSteps: [] })),
  )
}

// ---------------------------------------------------------------------------
// 6. FORMAT for display (TUI / CLI). Frontend can also use the Result directly.
// ---------------------------------------------------------------------------

export function format(r: Result): string {
  const section = (title: string, items: readonly string[]) =>
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

// ---------------------------------------------------------------------------
// 7. SERVICE
// Wires the pure logic above to OpenCode's session, todo, storage and LLM services.
// ---------------------------------------------------------------------------

// Public API of the service
export interface Interface {
  // Cached recap if still fresh, otherwise generates a new one
  readonly get: (sessionID: SessionID) => Effect.Effect<Result, Session.NotFound>
  readonly peek: (sessionID: SessionID) => Effect.Effect<Result | undefined> // cache only, no LLM call
}

// Effect service tag, other code gets it with `yield* SessionRecap.Service`
export class Service extends Context.Service<Service, Interface>()("@opencode/SessionRecap") {}

// Implementation: grabs the services it needs once, then defines the methods
const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const todos = yield* Todo.Service
    const storage = yield* Storage.Service
    const agents = yield* Agent.Service
    const provider = yield* Provider.Service
    const llm = yield* LLM.Service

    // Flatten OpenCode messages to {role, text}, keeping only text parts
    const toSimple = (history: SessionV1.WithParts[]): SimpleMessage[] =>
      history.map((m) => ({
        role: m.info.role,
        text: m.parts
          .filter((p) => p.type === "text")
          .map((p) => p.text)
          .join("\n"),
      }))

    // Runs the hidden "recap" agent on the prompt and returns its full text.
    // Mirrors ensureTitle() in prompt.ts:193
    const callModel = Effect.fn("Recap.callModel")(function* (
      sessionID: SessionID,
      history: SessionV1.WithParts[],
      prompt: string,
    ) {
      const lastUser = history.findLast((m) => m.info.role === "user")?.info
      if (!lastUser || lastUser.role !== "user") return ""
      const ag = yield* agents.get("recap")
      if (!ag) return ""
      const mdl =
        (yield* provider.getSmallModel(lastUser.model.providerID)) ??
        (yield* provider.getModel(lastUser.model.providerID, lastUser.model.modelID))
      return yield* llm
        .stream({
          agent: ag,
          user: lastUser,
          system: [],
          small: true,
          tools: {},
          model: mdl,
          sessionID,
          retries: 2,
          messages: [{ role: "user", content: prompt }],
        })
        .pipe(
          Stream.filter(LLMEvent.is.textDelta),
          Stream.map((e) => e.text),
          Stream.mkString,
        )
    })

    // Read the stored recap, or undefined if missing or invalid
    const peek = Effect.fn("Recap.peek")(function* (sessionID: SessionID) {
      const stored = yield* storage.read<unknown>(storageKey(sessionID)).pipe(Effect.orElseSucceed(() => undefined))
      return Option.getOrUndefined(decodeResult(stored))
    })

    // Build a fresh recap from history + plan, call the model, then save it
    const generate = Effect.fn("Recap.generate")(function* (sessionID: SessionID) {
      const info = yield* sessions.get(sessionID)
      const history = yield* sessions.messages({ sessionID })
      const messages = toSimple(history)
      const todoList = yield* todos.get(sessionID)
      // Prefer the structured todo list and fall back to markdown checklists in chat
      const plan: PlanItem[] =
        todoList.length > 0
          ? todoList.map((t) => ({ text: t.content, done: t.status === "completed" || t.status === "cancelled" }))
          : parsePlanItems(messages)
      const hadPlan = plan.length > 0
      // Computed in code, so it's always accurate (acceptance criterion #2)
      const carriedOver = plan.filter((p) => !p.done).map((p) => p.text)
      // Empty session: skip the model call. A model/network error counts as an empty answer.
      const modelOut =
        messages.length === 0
          ? { completed: [], nextSteps: [] }
          : parseModelOutput(
              yield* callModel(sessionID, history, buildPrompt(buildTranscript(messages), carriedOver, hadPlan)).pipe(
                Effect.orElseSucceed(() => ""),
              ),
            )
      const result: Result = {
        completed: modelOut.completed,
        carriedOver,
        // If the model gave nothing but we have unfinished plan items, use those as next steps
        nextSteps: modelOut.nextSteps.length > 0 ? modelOut.nextSteps : carriedOver,
        hadPlan,
        generatedAt: Date.now(),
        sourceUpdatedAt: info.time.updated,
      }
      yield* storage.write(storageKey(sessionID), result).pipe(Effect.ignore)
      return result
    })

    // Reuse the cached recap unless the session changed after it was made
    const get = Effect.fn("Recap.get")(function* (sessionID: SessionID) {
      const info = yield* sessions.get(sessionID)
      const cached = yield* peek(sessionID)
      if (cached && cached.sourceUpdatedAt >= info.time.updated) return cached
      return yield* generate(sessionID)
    })

    return Service.of({ get, peek })
  }),
)

// Registers the service and its dependencies with the app's layer graph
export const node = LayerNode.make({
  service: Service,
  layer,
  deps: [Session.node, Todo.node, Storage.node, Agent.node, Provider.node, LLM.node],
})

export * as SessionRecap from "./recap"
