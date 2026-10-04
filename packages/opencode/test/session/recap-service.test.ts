import { describe, expect } from "bun:test"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Database } from "@opencode-ai/core/database/database"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { LLMEvent } from "@opencode-ai/llm"
import { Effect, Layer, Stream } from "effect"
import { EventV2Bridge } from "@/event-v2-bridge"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { LLM } from "@/session/llm"
import { SessionRecap } from "@/session/recap"
import { Session } from "@/session/session"
import { Storage } from "@/storage/storage"
import { Todo } from "@/session/todo"
import { MessageID, PartID, type SessionID } from "@/session/schema"
import { testEffect } from "../lib/effect"

const ref = { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("test-model") }

const config = {
  provider: {
    test: {
      name: "Test",
      id: "test",
      env: [],
      npm: "@ai-sdk/openai-compatible",
      models: {
        "test-model": {
          id: "test-model",
          name: "Test Model",
          attachment: false,
          reasoning: false,
          temperature: false,
          tool_call: true,
          release_date: "2025-01-01",
          limit: { context: 100000, output: 10000 },
          cost: { input: 0, output: 0 },
          options: {},
        },
      },
      options: { apiKey: "test-key", baseURL: "http://localhost:1/v1" },
    },
  },
}

const GOOD = '{"completed":["wired up auth"],"nextSteps":["add tests"]}'

/**
 * Build a test harness around one canned model reply.
 *
 * Only the LLM layer is replaced; session storage, todos, the agent registry
 * and the provider all run for real, so these exercise the actual wiring
 * rather than a reimplementation of it. `prompts` records what the service
 * sent, which is how the "never calls the model" cases are proved rather than
 * assumed.
 */
function harness(reply: string | Error) {
  const prompts: string[] = []
  const llm = Layer.succeed(
    LLM.Service,
    LLM.Service.of({
      stream: (input) => {
        const last = input.messages.at(-1)
        prompts.push(typeof last?.content === "string" ? last.content : "")
        if (reply instanceof Error) return Stream.fail(reply)
        return Stream.make(LLMEvent.textDelta({ id: "block-1", text: reply }))
      },
    }),
  )

  const it = testEffect(
    LayerNode.compile(
      LayerNode.group([
        SessionRecap.node,
        Session.node,
        Todo.node,
        Storage.node,
        Database.node,
        SessionProjector.node,
        EventV2Bridge.node,
        CrossSpawnSpawner.node,
      ]),
      [
        [LLM.node, llm],
        [RuntimeFlags.node, RuntimeFlags.layer({ experimentalEventSystem: true })],
      ],
    ),
  )

  type Env = SessionRecap.Service | Session.Service | Todo.Service | Storage.Service

  const scenario = <A, E>(name: string, body: () => Effect.Effect<A, E, Env>) =>
    it.instance(
      name,
      () =>
        Effect.gen(function* () {
          prompts.length = 0
          return yield* body()
        }),
      { config: () => config },
    )

  return { prompts, scenario }
}

const say = Effect.fn("TestRecap.say")(function* (sessionID: SessionID, role: "user" | "assistant", text: string) {
  const session = yield* Session.Service
  const base = { id: MessageID.ascending(), sessionID, time: { created: Date.now() } }
  // An assistant message must hang off a user message, so resolve the most
  // recent one rather than making callers thread the id through.
  const parentID = (yield* session.messages({ sessionID })).findLast((m) => m.info.role === "user")?.info.id
  const msg =
    role === "user"
      ? yield* session.updateMessage({ ...base, role: "user" as const, agent: "build", model: ref })
      : yield* session.updateMessage({
          ...base,
          role: "assistant" as const,
          mode: "build",
          agent: "build",
          path: { cwd: "/tmp", root: "/tmp" },
          cost: 0,
          tokens: { total: 0, input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          modelID: ref.modelID,
          providerID: ref.providerID,
          parentID: parentID!,
          finish: "end_turn",
        } satisfies SessionV1.Assistant)
  yield* session.updatePart({ id: PartID.ascending(), messageID: msg.id, sessionID, type: "text", text })
  // SessionPrompt.loop touches the session on every turn, and the recap cache
  // keys off that timestamp, so the helper has to do it too.
  yield* session.touch(sessionID)
  return msg
})

const newSession = Effect.fn("TestRecap.newSession")(function* (text?: string) {
  const chat = yield* (yield* Session.Service).create({})
  if (text !== undefined) yield* say(chat.id, "user", text)
  return chat
})

describe("SessionRecap.peek", () => {
  const h = harness(GOOD)

  h.scenario("is undefined before anything has been generated", () =>
    Effect.gen(function* () {
      const chat = yield* newSession()
      expect(yield* (yield* SessionRecap.Service).peek(chat.id)).toBeUndefined()
    }),
  )

  h.scenario("never calls the model", () =>
    Effect.gen(function* () {
      const chat = yield* newSession("do the thing")
      yield* (yield* SessionRecap.Service).peek(chat.id)
      expect(h.prompts).toHaveLength(0)
    }),
  )

  h.scenario("ignores a stored recap that does not match the schema", () =>
    Effect.gen(function* () {
      // Stored recaps are untrusted: an older format or a hand edit must not
      // surface as a half-populated recap.
      const chat = yield* newSession()
      yield* (yield* Storage.Service).write(["recap", chat.id], { completed: "not a list" })
      expect(yield* (yield* SessionRecap.Service).peek(chat.id)).toBeUndefined()
    }),
  )

  h.scenario("returns the recap that get wrote", () =>
    Effect.gen(function* () {
      const recap = yield* SessionRecap.Service
      const chat = yield* newSession("do the thing")
      const generated = yield* recap.get(chat.id)
      expect(yield* recap.peek(chat.id)).toEqual(generated)
    }),
  )
})

describe("SessionRecap.get model output", () => {
  const good = harness(GOOD)
  good.scenario("summarizes completed work and next steps from the model", () =>
    Effect.gen(function* () {
      const chat = yield* newSession("do the thing")
      const result = yield* (yield* SessionRecap.Service).get(chat.id)
      expect(result.completed).toEqual(["wired up auth"])
      expect(result.nextSteps).toEqual(["add tests"])
    }),
  )

  good.scenario("sends the transcript to the model", () =>
    Effect.gen(function* () {
      const chat = yield* newSession("please add the login page")
      yield* (yield* SessionRecap.Service).get(chat.id)
      expect(good.prompts).toHaveLength(1)
      expect(good.prompts[0]).toContain("USER: please add the login page")
    }),
  )

  const junk = harness("I'm sorry, I can't do that")
  junk.scenario("treats unparseable model output as an empty summary", () =>
    Effect.gen(function* () {
      const chat = yield* newSession("do the thing")
      expect((yield* (yield* SessionRecap.Service).get(chat.id)).completed).toEqual([])
    }),
  )

  const broken = harness(new Error("provider exploded"))
  broken.scenario("survives a provider failure", () =>
    Effect.gen(function* () {
      // A provider outage must never block resuming a session.
      const chat = yield* newSession("do the thing")
      const result = yield* (yield* SessionRecap.Service).get(chat.id)
      expect(result.completed).toEqual([])
      expect(result.hadPlan).toBe(false)
    }),
  )
})

describe("SessionRecap.get caching", () => {
  const h = harness(GOOD)

  h.scenario("reuses the cached recap while the session is unchanged", () =>
    Effect.gen(function* () {
      const recap = yield* SessionRecap.Service
      const chat = yield* newSession("do the thing")
      const first = yield* recap.get(chat.id)
      const second = yield* recap.get(chat.id)
      expect(second.generatedAt).toBe(first.generatedAt)
      expect(h.prompts).toHaveLength(1)
    }),
  )

  h.scenario("regenerates once the session has moved on", () =>
    Effect.gen(function* () {
      const recap = yield* SessionRecap.Service
      const chat = yield* newSession("do the thing")
      const first = yield* recap.get(chat.id)

      yield* Effect.sleep("5 millis")
      yield* say(chat.id, "assistant", "and now some more work")

      expect((yield* recap.get(chat.id)).generatedAt).toBeGreaterThan(first.generatedAt)
      expect(h.prompts).toHaveLength(2)
    }),
  )

  h.scenario("records the session timestamp it was generated against", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const chat = yield* newSession("do the thing")
      const result = yield* (yield* SessionRecap.Service).get(chat.id)
      expect(result.sourceUpdatedAt).toBe((yield* session.get(chat.id)).time.updated)
    }),
  )

  h.scenario("fails for a session that does not exist", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit((yield* SessionRecap.Service).get("ses_nope" as SessionID))
      expect(exit._tag).toBe("Failure")
    }),
  )
})

describe("SessionRecap plan handling", () => {
  const h = harness(GOOD)

  h.scenario("carries over unfinished todos and marks the recap as planned", () =>
    Effect.gen(function* () {
      const chat = yield* newSession("do the thing")
      yield* (yield* Todo.Service).update({
        sessionID: chat.id,
        todos: [
          { content: "ship it", status: "pending", priority: "high" },
          { content: "already done", status: "completed", priority: "low" },
          { content: "abandoned", status: "cancelled", priority: "low" },
          { content: "half way", status: "in_progress", priority: "medium" },
        ],
      })

      const result = yield* (yield* SessionRecap.Service).get(chat.id)
      expect(result.hadPlan).toBe(true)
      // Completed and cancelled both count as closed; in_progress does not.
      expect(result.carriedOver).toEqual(["ship it", "half way"])
    }),
  )

  h.scenario("prefers the todo list over markdown checklists in chat", () =>
    Effect.gen(function* () {
      const chat = yield* newSession("plan it")
      yield* say(chat.id, "assistant", "- [ ] stale checklist item")
      yield* (yield* Todo.Service).update({
        sessionID: chat.id,
        todos: [{ content: "the real task", status: "pending", priority: "high" }],
      })

      expect((yield* (yield* SessionRecap.Service).get(chat.id)).carriedOver).toEqual(["the real task"])
    }),
  )

  h.scenario("falls back to markdown checklists when there are no todos", () =>
    Effect.gen(function* () {
      const chat = yield* newSession("plan it")
      yield* say(chat.id, "assistant", "- [x] scaffold\n- [ ] write the handler")

      const result = yield* (yield* SessionRecap.Service).get(chat.id)
      expect(result.hadPlan).toBe(true)
      expect(result.carriedOver).toEqual(["write the handler"])
    }),
  )

  h.scenario("reports no plan when there is neither a todo list nor a checklist", () =>
    Effect.gen(function* () {
      const chat = yield* newSession("just chatting")
      const result = yield* (yield* SessionRecap.Service).get(chat.id)
      expect(result.hadPlan).toBe(false)
      expect(result.carriedOver).toEqual([])
    }),
  )

  h.scenario("tells the model which items are still unfinished", () =>
    Effect.gen(function* () {
      const chat = yield* newSession("plan it")
      yield* (yield* Todo.Service).update({
        sessionID: chat.id,
        todos: [{ content: "finish the migration", status: "pending", priority: "high" }],
      })
      yield* (yield* SessionRecap.Service).get(chat.id)
      expect(h.prompts[0]).toContain("The session had a plan")
      expect(h.prompts[0]).toContain("- finish the migration")
    }),
  )
})

describe("SessionRecap empty sessions", () => {
  const h = harness(GOOD)

  h.scenario("skips the model entirely for a session with no messages", () =>
    Effect.gen(function* () {
      const chat = yield* newSession()
      const result = yield* (yield* SessionRecap.Service).get(chat.id)
      expect(result).toMatchObject({ completed: [], carriedOver: [], nextSteps: [], hadPlan: false })
      expect(h.prompts).toHaveLength(0)
    }),
  )
})

describe("SessionRecap next step fallback", () => {
  const h = harness('{"completed":["did work"],"nextSteps":[]}')

  h.scenario("uses unfinished plan items as next steps when the model offers none", () =>
    Effect.gen(function* () {
      const chat = yield* newSession("do the thing")
      yield* (yield* Todo.Service).update({
        sessionID: chat.id,
        todos: [{ content: "finish the migration", status: "pending", priority: "high" }],
      })

      expect((yield* (yield* SessionRecap.Service).get(chat.id)).nextSteps).toEqual(["finish the migration"])
    }),
  )
})
