// recap.ts: add at the bottom (the service part)
import { Effect, Layer, Context, Stream } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Session } from "./session"
import { Todo } from "./todo"
import { LLM } from "./llm"
import { Storage } from "@/storage/storage"
import { Agent } from "@/agent/agent"
import { Provider } from "@/provider/provider"
import type { SessionID } from "./schema"
// + LLMEvent / SessionV1: copy the same imports prompt.ts uses

export interface Interface {
  readonly get: (sessionID: SessionID) => Effect.Effect<Result, Session.NotFound>
  readonly peek: (sessionID: SessionID) => Effect.Effect<Result | undefined> // cache only, no LLM call
}
export class Service extends Context.Service<Service, Interface>()("@opencode/SessionRecap") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const todos = yield* Todo.Service
    const storage = yield* Storage.Service
    const agents = yield* Agent.Service
    const provider = yield* Provider.Service
    const llm = yield* LLM.Service

    const toSimple = (history: SessionV1.WithParts[]): SimpleMessage[] =>
      history.map((m) => ({
        role: m.info.role,
        text: m.parts
          .filter((p) => p.type === "text")
          .map((p) => p.text)
          .join("\n"),
      }))

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

    const peek = Effect.fn("Recap.peek")(function* (sessionID: SessionID) {
      const stored = yield* storage.read<unknown>(storageKey(sessionID)).pipe(Effect.orElseSucceed(() => undefined))
      const parsed = Result.safeParse(stored)
      return parsed.success ? parsed.data : undefined
    })

    const generate = Effect.fn("Recap.generate")(function* (sessionID: SessionID) {
      const info = yield* sessions.get(sessionID)
      const history = yield* sessions.messages({ sessionID })
      const messages = toSimple(history)
      const todoList = yield* todos.get(sessionID)
      const plan: PlanItem[] =
        todoList.length > 0
          ? todoList.map((t) => ({ text: t.content, done: t.status === "completed" || t.status === "cancelled" }))
          : parsePlanItems(messages)
      // ...same logic as your current generate(), but:
      //   raw = yield* callModel(...).pipe(Effect.orElseSucceed(() => ""))
      //   yield* storage.write(storageKey(sessionID), result).pipe(Effect.ignore)
      //   sourceUpdatedAt: info.time.updated
    })

    const get = Effect.fn("Recap.get")(function* (sessionID: SessionID) {
      const info = yield* sessions.get(sessionID)
      const cached = yield* peek(sessionID)
      if (cached && cached.sourceUpdatedAt >= info.time.updated) return cached
      return yield* generate(sessionID)
    })

    return Service.of({ get, peek })
  }),
)

export const node = LayerNode.make({
  service: Service,
  layer,
  deps: [Session.node, Todo.node, Storage.node, Agent.node, Provider.node, LLM.node],
})
