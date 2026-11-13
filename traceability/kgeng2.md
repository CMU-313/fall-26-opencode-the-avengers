# Traceability: Katherine Geng(kgeng2)

**Target feature:** Save an assistant response to a file (/save). Using the TUI, a user can save the latest assistant response with the /save command or click any assistant message and select Save. The response is saved as a Markdown (.md) or Text (.txt) file. 

Main source files: 
packages/tui/src/util/transcript.ts
packages/tui/src/util/response-file.ts
packages/tui/src/routes/session/index.tsx
packages/tui/src/routes/session/dialog-message.tsx: 
packages/tui/src/ui/dialog-export-options.tsx
packages/tui/src/config/keybind.ts

## Requirements

| ID | Interview evidence | Requirement | Acceptance Criteria | Changed in P4? | Property (kind) | Test | Mutants it kills |
|---|---|---|---|---|---|---|---|
| R1 | C-2, O-2: "I just want my answer and nothing else." S-2: metadata "might help me later on." | A .md save includes thinking, tool details and assistant metadata only when the toggle for each type of information is on. When the toggle is off, that content is left out of the file. | Take an assistant message ("Hello"), a reasoning part and a tool call. With all three toggles off, the saved file contains "Hello". With only the metadata toggle on, the file contains `## Assistant (Build · Claude Sonnet 4 5.4s)` and "Hello". With only the thinking toggle on, the file contains a `_Thinking:_` block and "Hello". With only the tool details toggle on, the file contains the tool input/output JSON and "Hello". | No | Invariant | `packages/tui/test/save-response/save-response.property.test.ts`: "R1: thinking, tool details and metadata appear exactly when toggled on" | H1; H2 (after P5 strengthening) |
| R2 | C-4: "Save feature should behave the same way in both cases." S-4: "Should still work the same." O-4: "Would expect both to be the same." | Saving a message through /save and through "Save to file" in the message menu produces the same files. The menu option saves the message that was clicked, even if it is not the latest. | The conversation has two responses: M1 ("Apple") and a newer M2 ("Banana"). /save to a.md, then click M2 → Save to file → b.md with the same toggles: the two files are identical. Click M1 → Save to file → c.md: the file contains "Apple" and not "Banana". | No | Metamorphic | `packages/tui/test/save-response/save-response.property.test.ts`: "R2: the saved file does not depend on message ids or absolute timestamps"; "R2: saving an older message contains that message and none of the newer one"; `packages/tui/test/save-response/save-response-dialog.property.test.tsx`: "R2: confirming /save writes formatResponse of the latest message with the chosen toggles"; "R2: Save to file on a response writes that response, not the latest one" (P5) | H3 (after P5 strengthening) |
| R3 | S-5: "Should save the whole message… Save as soon as it's done." O-5: "Send me the full file when it's done answering… don't want the agent to stop working." (C-5 wanted a partial save with a cut-off marker; this conflicts with S-5 and O-5, so the full-message behavior is kept.) | If /save is ran while the assistant response is still outputting, the generation continues without interruption. The file is written once the response finishes and contains the complete response. | Message M has text "Part 1" when /save to notes.md is run. M then completes with the text "Part 1 Part 2". Before M completes, notes.md does not exist. After M completes, notes.md exists and its content equals what saving the completed M produces, including "Part 2". | No | None | None | N/A: no property |
| R4 | S-3: "Wouldn't want metadata without saved content." | When a response has no visible text, no file is created, even when the metadata, thinking or tool details toggles are turned on. | Take a message with no text content, turn all toggles on, and run /save. An error message reads "No text content found in assistant response" and no file is created in the working directory. | No | Invariant | `packages/tui/test/save-response/save-response.property.test.ts`: "R4: hasResponseText is true exactly when some part is visible answer text"; "R4: a plain-text save is empty exactly when there is no visible text"; `packages/tui/test/save-response/save-response-dialog.property.test.tsx`: "R4: /save shows the no-text error and never opens the save dialog" (P5) | H4 |
| R5 | O-3: "It should be where it left off when you cancelled… I don't want it to reset." S-3: "Should go back to what it looked like before you started saving." (S-3 and O-3 pull in opposite directions about the dialog's contents; this requirement follows O-3 and reads S-3 as "cancel has no side effects".) | If the user cancels the save and then opens it again for the same message, the interface restores the filename and toggle settings they had entered before cancelling. Cancelling still writes no file. | Open the save interface for a message. Change the file name to notes.txt, turn the metadata toggle on, then press Cancel. No file is created. When you save the same message again: the filename field shows notes.txt and the metadata toggle is on, instead of the default filename and settings for toggles. | No | Round-trip | `packages/tui/test/save-response/save-response-dialog.property.test.tsx`: "R5: reopening the dialog for the same message restores the cancelled filename and toggles" | H5 |

Properties written or suggested by opencode or another AI tool: R1, R2, R4, R5 (written by Claude Code)

## Hand-written mutants

| ID | Requirement targeted | Change | Predicted killer | Actual result |
|---|---|---|---|---|
| H1 | R1 | `formatPart` in `src/util/transcript.ts`: the tool-input guard `options.toolDetails && part.state.input` becomes `part.state.input`, so tool input JSON is written even when "Include tool details" is off. | "R1: thinking, tool details and metadata appear exactly when toggled on": it checks that the input JSON appears exactly when `toolDetails` is true, and about half of the generated runs have it off. | Killed by the predicted R1 property. |
| H2 | R1 | `formatAssistantHeader` in `src/util/transcript.ts`: the duration uses `toFixed(0)` instead of `toFixed(1)`, so the metadata header says `5s` instead of the `5.4s` required by R1's acceptance criteria. | None. The R1 property only checks that the header starts with `## Assistant (Build · `, so the duration text is never checked. Predicted to survive. | Survived (prediction correct). After P5 strengthening, killed by the R1 property, which now checks the exact header `## Assistant (Build · Claude Sonnet 4 · 5.4s)`. |
| H3 | R2 | `DialogMessage` "Save to file" in `src/routes/session/dialog-message.tsx`: the clicked message `message()` is replaced with the latest assistant message (`findLast(role === "assistant")`), copied from how /save picks its target. Clicking an older message saves the newest one. | None. Both R2 properties call `formatResponse` directly with the message they were given, so they never exercise which message the menu passes in. Predicted to survive. | Survived (prediction correct). After P5 strengthening, killed by the new "R2: Save to file on a response writes that response, not the latest one", which clicks the older response in the TUI and checks the saved file. |
| H4 | R4 | `hasResponseText` in `src/util/transcript.ts` drops the `!part.synthetic` check, so a response with only synthetic text counts as having visible text and would be saved. | "R4: hasResponseText is true exactly when some part is visible answer text": its generator includes synthetic text parts labelled invisible. Also possibly "R4: a plain-text save is empty…", because `formatResponse` still filters synthentic text, so the two would disagree. | Killed by both R4 properties. |
| H5 | R5 | `saveResponse` in `src/routes/session/index.tsx`: the reopened dialog uses `showDetails()` instead of `draft?.toolDetails ?? showDetails()`. Cancel-then-reopen restores the filename, thinking and metadata, but resets "Include tool details" to its default. | "R5: reopening the dialog for the same message restores the cancelled filename and toggles": each run draws the tool-details toggle at random, so some run will set it to the non-default value. | Killed by the R5 property. |

## Stryker comparison

**Report.** `mutants/kgeng2/mutation.html` is the final run. `mutants/kgeng2/mutation-initial.html` is the first run, before strengthening which gave 174 mutants and a score of 67.24%. After strengthing, there were 166 mutants and a score of 87.35%. 

### Hand-written mutants vs. Stryker

None of the five hand-written mutants were generated exactly.

- **H2** (`toFixed(1)` → `toFixed(0)`): Stryker has no mutator for number literals, so it never changes a precision or an index constant.
- **H3** (the menu saves the latest message): this is a semantic substitution, one plausible lookup replaced by another. Stryker only applies fixed syntactic operators. The file (`dialog-message.tsx`) is also outside the mutate scope.
- **H5** (`draft?.toolDetails ?? showDetails()` → `showDetails()`): Stryker's nearest mutant is `??` → `&&`. Because all the session defaults are `true`, that variant only differs on the very first open, and it survived.
- **H1 and H4** each drop one operand of an `&&` chain. Stryker replaces whole sub-conditions instead: `options.toolDetails && part.state.input` → `true`, and `part.type === "text" && !part.synthetic` → `true`. It also negates the operand (`!part.synthetic` → `part.synthetic`). It never removes just the middle operand. Its nearby mutants were all killed.

Stryker survivors would I never have thought of: 

- `index.tsx:381` `draft?.openWithoutSaving ?? true`. "Open without saving" would be on by default, so the first /save opens an editor and writes no file. It's a one-character default slip that a reviewer could easily miss.
- The in-progress-message mutants on `transcript.ts:142` (`completed || created`, `* 1000`, `true ? …`). They showed that the properties never generated a message without a completion time.
- Yes, some of them are bugs a real developer might write. 

**Each approach finds that the other doesn't**

- **Hand-written mutants** model realistic, cross-file mistakes. For example, H3 picks the wrong *message*: it isn't a single operator mistake, and it lives in code I didn't think to put in Stryker's scope. Both H2 and H3 were mutants Stryker could not create.
- **Stryker** is exhaustive over the code I scoped, including paths I never thought about:
  - failed (`error`-state) tool calls
  - messages still streaming
  - the dialog's confirm path 
  - the /save no-text guard in the UI 
- In other words, hand-written mutants do a great job of testing whether the properties actually capture the requirements. But Stryker does great in terms of testing whether they cover every branch. 

### Strengthening (properties only, no example-based tests)

| Property | Change | Kills |
|---|---|---|
| R1 (`save-response.property.test.ts`) | Generators now include failed tool calls (`error` state), unfinished messages (no `completed`, so no duration) and a `step-start` part. A provider list maps model ID `claude` to the display name `Claude Sonnet 4`. Assertions now check: the exact metadata header `## Assistant (Build · Claude Sonnet 4 · 5.4s)` (duration omitted when unfinished); `**Error:**`/`**Output:**` blocks appear only with tool details on and match the tool's state; the answer starts its own paragraph; the file ends in exactly one newline; and the file is unchanged when the step-start part, or (with thinking off) the reasoning part, is removed. | H2; `transcript.ts` 85 (`trimStart`), 122 (`providers && …`), 142 (×6), 146 (×2), 158, 161, 169 (×8), 170, 172, 176 |
| R4 plain text (`save-response.property.test.ts`) | Every visible answer must appear as its own paragraph, in order (`a\n\nb`). | `transcript.ts` 90 (`join("")`) |
| R5 (`save-response-dialog.property.test.tsx`) | The "Open without saving" toggle is now drawn and checked too (4 toggles, 16 combinations). | `index.tsx` 381 (`&&`) |
| R2, new: "confirming /save writes formatResponse of the latest message with the chosen toggles" | Drives /save through the dialog, confirms it, and compares the written file with `formatResponse` for that message and toggles, for both `.md` and `.txt`. | `index.tsx` 385 (`if (true) return`); `dialog-export-options.tsx` 217, 219 |
| R2, new: "Save to file on a response writes that response, not the latest one" | Two exchanges on screen. It clicks the older or the newer response, chooses Save to file, confirms, and checks the file is that response's. | H3 |
| R4, new: "/save shows the no-text error and never opens the save dialog" | Responses made only of invisible parts (reasoning, a tool call, synthetic text, whitespace-only text, in any non-empty combination). /save must show "No text content found in assistant response" and never open "Save Response". | `index.tsx` 367 (×2), 368 (×2) |

### Equivalent mutants (5)

- **`index.tsx:366` `?? []` → `?? ["Stryker was here"]`.** The fallback is only used when the message has no parts loaded. `hasResponseText` returns false for a string element (it has no `type`), just as it does for an empty array. So both versions show the no-text error and return before `parts` is used anywhere else.
- **`dialog-export-options.tsx:49` `props.bindValues?.(values)` → `props.bindValues(values)`.** `DialogExportOptions` is only ever rendered by `DialogExportOptions.show`, which always passes `bindValues`; both /save and /export go through `show`. The optional call can never see `undefined`, so removing the `?.` changes nothing.
- **`dialog-export-options.tsx:221` `onCancel={() => resolve(null)}` → `onCancel={() => undefined}`.** The component declares `onCancel` but never calls it; cancelling is handled by the dialog's `onClose` callback. Since the function is never invoked, its body cannot affect behaviour.
- **`transcript.ts:166` `part.state.status === "completed"` → `true`, in `toolDetails && … && part.state.output`.** In the SDK types, only `ToolStateCompleted` has an `output` field; pending, running and error states have none. Whenever `part.state.output` is truthy, the status is already `"completed"`.
- **`transcript.ts:169` `part.state.status === "error"` → `true`, in `toolDetails && … && part.state.error`.** By the same reasoning, only `ToolStateError` has an `error` field, so a truthy `part.state.error` already implies the status is `"error"`.

## Agent failure case

I asked opencode to write a new property for R1 and ran the mutants against it. The full session export is in `mutants/kgeng2/agent-failure-opencode-session.json`. 

**Transcript excerpt.**

> **Prompt:** I need a property-based test for this requirement of the "save response to file" feature in packages/tui.
> Requirement R1: A .md save includes thinking, tool details and assistant metadata only when the toggle for each type of information is on. When the toggle is off, that content is left out of the file.
> Acceptance criteria: *(R1's acceptance criteria from the table above)*
> The file content is produced by formatResponse in packages/tui/src/util/transcript.ts. Write one fast-check property (bun:test, `import fc from "fast-check"`) that tests R1 against formatResponse. Put the whole test file in your reply as a single code block; do not edit or create any files.

opencode first read `transcript.ts`, `locale.ts`, `model.ts`, `test/util/transcript.test.ts` and my existing `save-response.property.test.ts`. It then wrote and ran two temporary test files, one of them inside `packages/tui/test/save-response/`, despite "do not edit or create any files", deleted them, and replied with this property (the full version is in the session export):

```ts
fc.property(
  fc.record({ thinking: fc.boolean(), toolDetails: fc.boolean(), assistantMetadata: fc.boolean() }),
  (toggles) => {
    const msg: AssistantMessage = { /* … */ time: { created: 1000000, completed: 1005400 } }
    const parts: Part[] = [
      { type: "reasoning", text: "Reasoning part content", /* … */ },
      { type: "tool", tool: "bash", state: { status: "completed", input: { command: "ls" }, output: "file.txt", /* … */ } },
      { type: "text", text: "Hello", /* … */ },
    ]
    const result = formatResponse(msg, parts, "md", { ...toggles, providers })
    expect(result).toContain("Hello")
    expect(result.includes("## Assistant (Build · Claude Sonnet 4 · 5.4s)")).toBe(toggles.assistantMetadata)
    expect(result.includes("_Thinking:_")).toBe(toggles.thinking)
    expect(result.includes("Reasoning part content")).toBe(toggles.thinking)
    expect(result.includes(JSON.stringify({ command: "ls" }, null, 2))).toBe(toggles.toolDetails)
    expect(result.includes("file.txt")).toBe(toggles.toolDetails)
    expect(result.includes("**Input:**")).toBe(toggles.toolDetails)
    expect(result.includes("**Output:**")).toBe(toggles.toolDetails)
  },
)
```

**The surviving mutant** (Stryker `LogicalOperator`, `transcript.ts:169`; saved as `mutants/kgeng2/agent-failure.patch`):

```diff
-    if (options.toolDetails && part.state.status === "error" && part.state.error) {
+    if (options.toolDetails && part.state.status === "error" || part.state.error) {
```

This is a plausible operator-precedence slip. Because `&&` binds tighter than `||`, any failed tool call now writes its `**Error:**` block (the raw error text) into the file even when "Include tool details" is off. That violates R1's "when the toggle is off, that content is left out of the file." With the patch applied, opencode's property still passes (`1 pass, 0 fail`). It does kill H1 and H2.

**Why the property was too weak.** The *generator never reaches the bug*. It looks like a property, but the only random input is the three booleans, so it is really the 8 toggle combinations run over one fixed example:

- the message, the part contents and the part order are constants
- the duration is always 5.4s
- the tool call is always `completed`, so the error branch of `formatPart` never runs and nothing ever checks for `**Error:**`

This happened even though opencode had just read my P4 property file, which generates its own content. A scoped Stryker run of `transcript.ts` (the same ranges as the main config) with only this property as the test scores **50.43%** (59 killed, 58 survived). Every mutant in the error branch (`transcript.ts:169-170`, 10 mutants) survives, as do the "unfinished message" mutants on line 142 and the "content left behind when toggled off" mutants on lines 158 and 176.

**Strengthened version:** `packages/tui/test/save-response/agent-r1.property.test.ts`. It keeps opencode's structure and oracle style and makes these changes:

- the answer, reasoning, tool command and tool result are generated strings with unique markers
- the tool call is either `completed` or `error`
- the part order is shuffled
- the message may be unfinished (no duration)
- `**Output:**` must appear exactly when tool details are on and the call completed, and `**Error:**` exactly when tool details are on and the call failed
- the metadata header is checked exactly, with the duration omitted for an unfinished message
- with thinking off, the file must equal the file for the same parts minus the reasoning part

**Evidence it kills the mutant.** With `agent-failure.patch` applied, the strengthened property fails (`0 pass, 1 fail`) and fast-check shrinks to the counterexample:

```
Counterexample: [{"thinking":false,"toolDetails":false,"assistantMetadata":false},"ANSWER:","REASONING:","CMD:","RESULT:","error",[2,0,1],undefined]
```

That is all toggles off and a failed tool call: the error text leaks into the file. Without the patch it passes. Rerunning the same scoped Stryker run with the strengthened property raises the score from **50.43% to 62.39%** (73 killed). Of the 10 error-branch mutants, only the equivalent `status === "error"` → `true` (argued above) survives. The other remaining survivors are mostly in the `.txt` path and `hasResponseText`, which R1 doesn't cover and which the R4 properties kill.

## Requirement changes

| ID | Original requirement (P3) | Revised requirement | Why it changed |
|---|---|---|---|
| None | N/A | N/A | N/A |

All five requirements are kept as written because each one is feasible and checkable by a test. Two interview conflicts were already resolved in P3: C-5 (partial save) versus S-5 and O-5 (full message) for R3, and S-3 versus O-3 for R5, where R5 follows O-3. R3's acceptance criteria were rewritten to describe message state instead of elapsed time, but the requirement itself is unchanged.