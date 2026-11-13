# Traceability: Toby Yang (ttyang)

**Target feature:** /copy x command to copy a specific number of recent messages instead of the full chat history.

**Relevant Files:**
- `packages/http-recorder/dist/effect.d.ts`
- `packages/http-recorder/dist/index.d.ts`
- `packages/http-recorder/dist/socket.d.ts`
- `packages/http-recorder/dist/types.d.ts`
- `packages/tui/src/component/prompt/index.tsx`
- `packages/tui/src/routes/session/index.tsx`
- `packages/tui/src/util/transcript.ts`
- `packages/tui/test/cli/tui/prompt-submit.test.tsx`
- `packages/tui/test/util/transcript.test.ts`
- `packages/tui/test/util/transcript.property.test.ts`

## Requirements

| ID | Interview evidence | Requirement | Acceptance Criteria | Changed in P4? | Property (kind) | Test | Mutants it kills |
|---|---|---|---|---|---|---|---|
| R1 | C-1, S-1, O-1: Users copy past messages to move them to new containers, remind the AI of the current topic, or run a prompt without previous context. | The /copy x command should copy the text of the x most recent messages from the current conversation. | Running /copy 2 successfully captures the exact text of the 2 most recent messages. | No | Invariant | `test/util/transcript.property.test.ts` — R1 | H5 |
| R2 | C-2, S-2, O-2: If a user requests more messages than exist, it should only copy what is available and provide a warning. | If the requested number x is greater than the available messages, the system must copy all available messages and display a warning indicating the actual number copied. | If the user runs the command /copy 6 but only 4 messages exist, it should copy the 4 messages and display a warning such as "Only 4 messages copied." | No | Invariant | `test/util/transcript.property.test.ts` — R2 | H1 |
| R3 | S-3, O-3: Previously deleted messages should not be included in the copied output. | The command must automatically exclude any deleted messages from the copied output without requiring explicit confirmation. | If a chat contains a deleted message, running a /copy command that contains it should ignore the deleted message and copy the previous messages instead. | No | Round-trip | `test/util/transcript.property.test.ts` — R3 | H2 |
| R4 | C-4, S-4, O-4: Invalid inputs like 0 should trigger an error or warning message and block the command from executing. | If the user inputs an invalid amount (such as 0), the system must block the action and return an error message. | Running /copy 0 results in no messages being copied and an error displaying that at least one message must be copied. | No | Metamorphic | `test/util/transcript.property.test.ts` — R4; `test/cli/tui/prompt-submit.test.tsx` | H3 |
| R5 | C-5, S-5, O-5: Changing message order decreases chat quality and is strictly wrong because context matters. | The copied messages must be formatted and preserved in their exact chronological order (oldest to newest). | When copying multiple messages, the older message appears above the newer message in the output. | No | Oracle | `test/util/transcript.property.test.ts` — R5 | H4 |

Properties written or suggested by opencode or another AI tool: R2, R3, R4, and R5

## Requirement changes

All five requirements are feasible and testable as written, so none were revised.

## Handwritten Mutants

| Mutant | Requirement | Change | Predicted killer | Actual result |
|---|---|---|---|---|
| H1 | R2 | In `packages/tui/src/util/transcript.ts`, report the requested count instead of the available count; patch: `mutants/ttyang/H1.patch`. | R2 property | Killed by R2 with seed 42. |
| H2 | R3 | In `packages/tui/src/util/transcript.ts`, return all messages without applying the revert boundary; patch: `mutants/ttyang/H2.patch`. | R3 property | Killed by R3 with seed 42. |
| H3 | R4 | In `packages/tui/src/util/transcript.ts`, allow non-digit arguments through count validation; patch: `mutants/ttyang/H3.patch`. | R4 nonnumeric property | Killed by the R4 nonnumeric and numeric-format properties with seed 42; the agent-generated zero-boundary property survives. |
| H4 | R5 | In `packages/tui/src/util/transcript.ts`, reverse the selected messages before formatting; patch: `mutants/ttyang/H4.patch`. | R5 property | Killed by R5 with seed 42. |
| H5 | R1 | In `packages/tui/src/util/transcript.ts`, select one more message than requested; patch: `mutants/ttyang/H5.patch`. | R1 property | Killed by R1 with seed 42. |

Each handwritten patch was applied independently and was killed by its mapped property test using seed 42.

## Stryker Mutation Testing

Stryker was run from `packages/tui` with `bunx --no-install stryker run stryker.ttyang.config.json`. It generated 55 mutants: **53 killed (96.36%)**, 2 survived, and 0 timed out, errored, or lacked coverage. The two survivors are equivalent mutations: removing the no-revert-ID early return still returns the original list when no ID matches, and forcing the transcript limit conditional to the `slice(-limit)` branch still returns the full list when `limit` is undefined. Excluding those equivalent survivors, all non-equivalent mutants were killed.

The generated report is [mutation.html](../mutants/ttyang/mutation.html). The Stryker configuration is `packages/tui/stryker.ttyang.config.json`.

## Agent Failure Case

**Requirement:** R4 — invalid `/copy` counts must be rejected.

**Agent-generated property:** OpenCode added `R4: zero boundary validation accepts positive count n and rejects zero count` to `packages/tui/test/util/transcript.property.test.ts`. For generated positive integers, it checks that `/copy n` is accepted and a zero count is invalid.

**Surviving mutant:** H3 changes validation so non-digit arguments can pass while zero remains invalid. The agent-generated property passes under H3 because it exercises only positive integers and zero; it does not try a nonnumeric argument.

**Why the property was insufficient:** It checks the zero boundary but not the full invalid-input condition in R4. In particular, it does not distinguish correct validation from H3's acceptance of malformed counts.

**Strengthened property:** `R4: nonnumeric copy counts are invalid` in `packages/tui/test/util/transcript.property.test.ts` checks generated nonnumeric arguments. With H3 applied, that property fails (fast-check shrinks the failing argument to `" "`); with the original implementation, it passes.

**Evidence:** With H3 applied, the agent-generated zero-boundary property passed (1 pass), while the nonnumeric property failed (1 fail). After removing H3, `bun test --timeout 30000 test/util/transcript.property.test.ts` from `packages/tui` passed all 8 properties, and `bun typecheck` from `packages/tui` passed.

**Prompt given to OpenCode:**

> Read R4 in traceability/ttyang.md and the existing transcript property tests. Add one fast-check property focused on the zero boundary: for generated positive integer counts, verify /copy n is accepted with count n, and replacing n with zero makes the command invalid. Follow the existing test style and use seed 42.

**OpenCode response excerpt:**

```ts
test("R4: zero boundary validation accepts positive count n and rejects zero count", () => {
  assert(
    property(integer({ min: 1, max: Number.MAX_SAFE_INTEGER }), (n) => {
      expect(getCopyCommandState(`/copy ${n}`, 1)).toEqual({ kind: "copy", count: n })
      expect(getCopyCommandState(`/copy ${n.toString().replace(String(n), "0")}`, 1)).toEqual({
        kind: "invalid",
      })
    }),
    { numRuns: 100, seed: 42 },
  )
})
```

The supplied screenshots show OpenCode reporting 8 passing tests and a successful typecheck after adding this property.
