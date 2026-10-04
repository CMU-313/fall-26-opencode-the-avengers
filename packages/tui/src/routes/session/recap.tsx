import { createEffect, createResource, createSignal, For, on, Show } from "solid-js"
import { useSDK } from "../../context/sdk"
import { useSync } from "../../context/sync"
import { useTheme } from "../../context/theme"
import { SplitBorder } from "../../ui/border"

export function SessionRecap(props: { sessionID: string }) {
  const sdk = useSDK()
  const sync = useSync()
  const { theme } = useTheme()
  const [dismissed, setDismissed] = createSignal(false)

  // Keyed on sessionID so switching sessions loads that session's recap.
  // Failures resolve to undefined: a missing recap must never block resuming.
  const [recap] = createResource(
    () => props.sessionID,
    (sessionID) =>
      sdk.client.session
        .recap({ sessionID })
        .then((result) => result.data?.recap)
        .catch(() => undefined),
  )

  createEffect(
    on(
      () => props.sessionID,
      () => setDismissed(false),
    ),
  )
  // Hide for good once the user starts working again
  createEffect(() => {
    if (sync.data.session_status?.[props.sessionID]?.type === "busy") setDismissed(true)
  })

  const visible = () => {
    const r = recap()
    if (!r || dismissed()) return undefined
    if (r.completed.length + r.carriedOver.length + r.nextSteps.length === 0) return undefined
    return r
  }

  return (
    <Show when={visible()}>
      {(r) => (
        <box
          flexShrink={0}
          border={["left"]}
          customBorderChars={SplitBorder.customBorderChars}
          borderColor={theme.accent}
          onMouseUp={() => setDismissed(true)}
        >
          <box paddingTop={1} paddingBottom={1} paddingLeft={2} backgroundColor={theme.backgroundPanel}>
            <text fg={theme.text}>
              <b>Welcome back! Here's where you left off</b>
            </text>
            <Section title="Completed" items={r().completed} />
            <Section title="Unfinished from your plan" items={r().carriedOver} />
            <Section title={r().hadPlan ? "Next steps" : "Suggested next steps"} items={r().nextSteps} />
            <text fg={theme.textMuted} marginTop={1}>
              click to dismiss
            </text>
          </box>
        </box>
      )}
    </Show>
  )
}

function Section(props: { title: string; items: readonly string[] }) {
  const { theme } = useTheme()
  return (
    <Show when={props.items.length > 0}>
      <box marginTop={1}>
        <text fg={theme.textMuted}>{props.title}</text>
        <For each={props.items}>{(item) => <text fg={theme.text}>{"  • " + item}</text>}</For>
      </box>
    </Show>
  )
}
