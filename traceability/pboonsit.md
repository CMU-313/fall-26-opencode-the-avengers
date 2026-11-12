# Traceability: pboonsit

Feature: Save an assistant response to a file (`/save`)
Implementation: `packages/tui/src/util/response-file.ts` (`writeResponseFile`)
Property tests: `packages/tui/test/util/response-file.property.test.ts`

## Requirements

Every Project 3 requirement is listed here, either kept or revised. R4 is revised and has no property (see below).

| ID  | Interview evidence | Requirement (as it stands in P4)                                                                                                                 | Acceptance Criteria                                                                                                   | Changed in P4?                  | Property (kind)                                                                              | Test                                                    | Mutants it kills |
| --- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- | ------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ---------------- |
| R1  | S-4                | Saving never silently replaces an existing file: the user is asked to confirm first, and only when the file already exists.                      | Saving to an existing filename asks for confirmation exactly once; saving to a new filename asks zero times.          | Yes (revised)                   | R1: the overwrite prompt appears exactly when the file already exists (model/oracle)         | `packages/tui/test/util/response-file.property.test.ts` | H2 |
| R2  | S-1, C-5           | When saving as Markdown, the saved file preserves the response content exactly, so headings, lists, and code blocks are kept.                    | Saving a response with a heading, a list, and a fenced code block writes those bytes unchanged.                       | No                              | R2: a new file reads back exactly what was written (round-trip)                              | `packages/tui/test/util/response-file.property.test.ts` | H3, H4 |
| R3  | S-3, O-3           | Canceling a save (declining the overwrite prompt) must not modify an existing file.                                                              | With an existing file, declining the overwrite prompt leaves the file unchanged and reports that nothing was written. | Yes (narrowed to existing file) | R3: declining overwrite leaves the existing file unchanged (invariant)                       | `packages/tui/test/util/response-file.property.test.ts` | H1, H2 |
| R4  | C-5, S-5, O-5      | The save command operates on the completed assistant response and never a partially generated one.                                               | Not checked by a property (see Requirement changes).                                                                  | Yes (revised)                   | none                                                                                         | none                                                    | none (no property) |
| R5  | C-2, O-2           | Saving writes exactly the response content it was given, with nothing injected (no thinking, tool output, or metadata the user did not ask for). | For any response content, the saved file's size in bytes equals the byte length of that content.                      | Yes (replaced)                  | R5: a successful save adds no bytes beyond the given content (invariant)                     | `packages/tui/test/util/response-file.property.test.ts` | H3, H4 |
| R6  | S-2                | When a timestamp is supplied, the saved file is a timestamp header followed by exactly the response content.                                     | Saving with a timestamp produces a file equal to the header line plus the original content, unchanged.                | Yes (new)                       | R6: timestamped save prepends a header and preserves the content (round-trip / metamorphic)  | `packages/tui/test/util/response-file.property.test.ts` | H3, H5 |

Kinds used: round-trip (R2, R6), invariant (R3, R5), model/oracle (R1).

## Requirement changes

| ID  | Original (P3)                                                                                                                                     | Revised (P4)                                                                                                                | Reason                                                                                                                                                                                                                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R1  | The save command should allow appending a response to an existing file without overwriting it.                                                    | Saving never silently replaces an existing file: the user is asked to confirm first, and only when the file already exists. | Feasibility. Appending needs a new choice in the save dialog and a different write path. `writeResponseFile` only overwrites or declines, so append cannot be built and checked in this project. The revision keeps the interview concern (do not lose an existing file) in a form the current code supports.     |
| R3  | Canceling a save must not create a new file or modify an existing one.                                                                            | Canceling a save (declining the overwrite prompt) must not modify an existing file.                                         | Checkability. The overwrite prompt only appears when the file already exists, so there is no "decline" case for a new file to test. The "create a new file" half cannot be checked through `writeResponseFile`.                                                                                                |
| R4  | If `/save` is triggered while the agent is still generating, it must wait until generation completes before saving, never saving partial content. | The save command operates on the completed assistant response and never a partially generated one.                          | Conflict and checkability. The interviews disagree: C-5 wanted partial content with a cut-off marker, while S-5 and O-5 wanted the whole response. The original is also not checkable against the save function, which has no notion of generation state. The revision keeps the majority view (save the whole response). |
| R5  | The save command should allow appending a response to an existing file without overwriting it. (P3 R5 repeated R1.)                               | Saving writes exactly the response content it was given, with nothing injected.                                             | Duplicate requirement. R5 said the same thing as R1, so it was replaced with a different expectation from the interviews (C-2, O-2): no extra content in the saved file.                                                                                                                                      |
| R6  | None. Not in P3.                                                                                                                                  | When a timestamp is supplied, the saved file is a timestamp header followed by exactly the response content.                | New requirement from interview S-2 (users wanted to know when a response was saved). It needed a small code change: an optional `timestamp` argument on `writeResponseFile`, passed in so the output is deterministic and testable.                                                                          |

## Generators

All properties share one content generator. It mixes three sources: arbitrary strings from `fc.string()`, fixed markdown fragments (a heading, a list item, a fenced code block, the empty string, a blank line), and random concatenations of those fragments. Arbitrary strings catch general byte-handling problems. The fragments and their concatenations cover the cases the interviews cared about: markdown structure (S-1, C-5), empty content, and content that ends without a newline. R3 draws two contents so the original and replacement can differ, and R1 also draws a boolean for whether the file already exists. After the mutation testing in Project 5, the fragments also include `\r\n` and bare `\r`, because `fc.string()` only produces printable ASCII and a save that rewrote line endings went unnoticed (H4). R6 draws its timestamp from `fc.date()` instead of one fixed date, because a header that dropped milliseconds went unnoticed (H5). The fast-check seed is fixed at 42 (`fc.configureGlobal`) so results are repeatable.

## Hand-written mutants

Patches are in `mutants/pboonsit/`. Each is applied with `git apply`, tested against `response-file.property.test.ts`, then reverted. Predictions are written before any mutant is run.

| ID  | Requirement targeted | Change                                                                                                                                                  | Predicted killer | Actual result |
| --- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | ------------- |
| H1  | R3                   | `response-file.ts`: decline check changed from `!(await confirmOverwrite())` to `(await confirmOverwrite()) === false`, so a dismissed dialog (`undefined`) overwrites | R3 should kill it. R3 draws the dialog answer from `false` and `undefined`, and with `undefined` the mutant overwrites the file. | Killed by R3 (counterexample had `undefined` as the dialog answer). |
| H2  | R1                   | `response-file.ts`: "file exists" check changed from `Bun.file(p).exists()` to `Bun.file(p).size > 0`, so an existing empty file is overwritten without a prompt | R1 should kill it, with R3 as a backup. The mutant only differs when the existing file is empty, which the generator produces often (`""`) but only by chance, so this one is not certain. | Killed by R1 and R3 (counterexamples had an empty existing file). Caught on this unseeded run. |
| H3  | R2                   | `response-file.ts`: a trailing newline is appended to non-empty content that lacks one                                                                  | R2, R5 and R6 should all kill it. `fc.string()` often produces text with no trailing newline, so the saved file gets an extra byte. | Killed by R2, R5 and R6 (counterexample: `" "`). |
| H4  | R5                   | `response-file.ts`: `\r\n` in the content is normalized to `\n` before writing                                                                          | None. I expect it to survive: the generator never produces `\r` (checked by sampling 20,000 values). | Survived. All 5 properties passed: the generator never produces `\r`. Killed after strengthening (see Strengthening). |
| H5  | R6                   | `response-file.ts`: the header timestamp is truncated to whole seconds (milliseconds dropped)                                                           | None. I expect it to survive: R6 uses one fixed date whose milliseconds are already `.000`, so truncating them changes nothing. | Survived. All 5 properties passed: R6 uses one fixed date with `.000` milliseconds. Killed after strengthening (see Strengthening). |

## Stryker comparison

Config: `packages/tui/stryker.pboonsit.config.json`. It runs only `response-file.property.test.ts` and mutates only `src/util/response-file.ts:13-20`. Seed: 42. Report: `mutants/pboonsit/mutation.html`.

Mutation score: **10 of 10 mutants killed = 100%** (before and after strengthening). Stryker generated 10 mutants, on lines 14, 16, 18 and 20: conditions forced to `true`/`false`, `&&` changed to `||`, `===` changed to `!==`, boolean literals, `return true` changed to `return false`, and the header string emptied. Nothing survived, so there are no equivalent mutants (score with equivalents excluded: also 100%).

**Which hand-written mutants did Stryker never generate? Why not?** All five (H1-H5). Stryker rewrites the code that is already there with fixed operators (swap `&&`/`||`, flip a boolean, empty a string). It does not add new logic or replace one API call with another. H3 and H4 add a new line (`endsWith`, `replace`), H2 swaps `.exists()` for `.size > 0`, H5 wraps the date in new rounding arithmetic, and H1 turns `!x` into `x === false`. Stryker's closest relative of H1 removes the `!` (mutant 3), which is a different bug. Each of my mutants needed knowing what the code is for (empty files, dismissed dialogs, line endings, timestamp precision).

**Which Stryker mutants would I never have thought of? Are any realistic?** None survived, so none exposed a weak property. The ones I would not have written by hand are the crude ones: `&&` changed to `||` on the overwrite check, the whole condition forced to `true`/`false`, and `===` changed to `!==` on the timestamp check (mutant 7). A developer could plausibly slip on `&&`/`||` or a flipped comparison, but a test would catch them at once, and here the properties did. They are less like review-surviving bugs than H1-H5.

**What does each approach find that the other does not?** Stryker checks every branch and operator systematically in about 4 seconds, and it confirmed the properties cover the control flow of `writeResponseFile`. It missed what depends on the shape of the data: line endings (H4) and timestamp precision (H5). My hand-written mutants found those two real gaps in the generators. Stryker would not have shown them, since it reported 100%. Stryker cannot judge whether the generator is realistic; a person has to ask what inputs a real bug would need.

## Strengthening

Results with the seed fixed at 42. H1-H3 were killed from the start. H4 and H5 survived, and both were generator gaps, not assertion gaps. Fixed by changing the generators only, with no example tests:

| Mutant | Before | Change that killed it                                                                                               | After  |
| ------ | ------ | ------------------------------------------------------------------------------------------------------------------- | ------ |
| H4     | Survived | Added `\r\n` and bare `\r` fragments to the shared content generator. R2, R5 and R6 now fail on a CRLF string.      | Killed |
| H5     | Survived | R6 now draws the timestamp from `fc.date({ noInvalidDate: true })`. It fails on a date such as `1970-01-01T00:00:00.001Z`. | Killed |

Final hand-written result: 5 of 5 killed. Final Stryker score: 10 of 10 (100%).

## Equivalent mutants

None. No Stryker mutant survived, and every hand-written mutant changes observable output (the saved bytes, the prompt count, or the header text), so none is equivalent.

## Agent failure case

**Property:** `packages/tui/test/util/response-file.opencode-r2.property.test.ts`, written by opencode (model: Gemini 3.5 Flash Lite) for R2. It is committed unchanged as evidence. Share link: not available (the `/share` command is not offered in my opencode build, so the transcript is quoted below and an exported excerpt is in `mutants/pboonsit/transcript/opencode-r2-session.md`).

**Transcript excerpt.** Prompt I gave opencode, in a new session:

```
Write a fast-check property test for this requirement of writeResponseFile
in packages/tui/src/util/response-file.ts:

"When saving as Markdown, the saved file preserves the response content
exactly, so headings, lists, and code blocks are kept."

Do not read anything in the traceability/ or mutants/ folders.
Put it in packages/tui/test/util/response-file.opencode-r2.property.test.ts.
```

opencode read `response-file.ts`, `package.json`, the existing `response-file.property.test.ts` and `response-file.test.ts`, wrote the file, ran it (1 pass, 0 fail), and replied: "The fast-check property test for R2 has been successfully created at packages/tui/test/util/response-file.opencode-r2.property.test.ts and passes all runs." Its generator:

```ts
const markdownContent = fc.oneof(
  fc.string(),
  fc.array(
    fc.oneof(
      fc.string().map((s) => `# ${s}\n`),
      fc.string().map((s) => `- ${s}\n`),
      fc.string().map((s) => `\`\`\`\n${s}\n\`\`\`\n`),
      fc.string().map((s) => `${s}\n`)
    )
  ).map((parts) => parts.join(""))
)
```

**Mutant it let survive:** H4 (`\r\n` in the content is rewritten to `\n` before writing). Run against only opencode's file with seed 42: 1 pass, 0 fail, so H4 survives. The same file does kill H3 (counterexample `" "`).

**Why the property was too weak.** The assertion is fine (`saved === text`). The generator is the problem: `fc.string()` only produces printable ASCII, and every other piece is a heading, list item or code fence built from `fc.string()` plus `\n`. It never produces `\r`, so the bug (a save that rewrites Windows line endings) can never show up. The property reads as thorough because it covers headings, lists and code blocks, but those are the cases the requirement names, not the ones that break.

**Strengthened version:** `packages/tui/test/util/response-file.opencode-r2-strengthened.property.test.ts`. Same assertion; one added source in the generator, `fc.string({ unit: fc.constantFrom("a", " ", "#", "-", "`", "\n", "\r") })`, so line endings are common.

**Evidence it kills the mutant.** On the real code: 1 pass, 0 fail. With H4 applied: fails with a counterexample containing `\r`. With H3 applied: fails with counterexample `"a"`.

**Context and caveats.**
- This was the third attempt. My first two (R6, then R3) were written in a repo where my own strengthened property tests were already present, and opencode copied that generator, so they were not independent. Their results: against the R6 file H1 and H2 survived, and against the R3 file H3-H5 survived, but only because those mutants are outside what each requirement covers. I did not count them.
- For this attempt I moved the other opencode test files out of the folder and temporarily restored the original (pre-strengthening) property test so no strengthened generator was nearby. opencode still read that original file, which has the same `fc.string()`-based weakness, and wrote its own generator.
- The prompt told opencode not to read `traceability/` or `mutants/`; the transcript shows it did not.
- After writing the file, opencode ran `git diff` and `git restore` on my temporarily edited `response-file.property.test.ts` without being asked. That only undid my own temporary change, but it is an example of the agent touching a file outside the task.

## Notes

- R6 holds for `writeResponseFile`, but the `/save` caller in `routes/session/index.tsx` does not pass `timestamp` yet, so users cannot get a timestamped file from the UI. Passing it unconditionally would put a header into every save, which contradicts R5 and the existing save tests, so it needs an opt-in choice in the save dialog. That is left as follow-up work.
- R3 covers both `false` and `undefined` from the prompt, because dismissing the dialog resolves `undefined`.
- R4 has no property because it cannot be checked at the `writeResponseFile` level. It is revised, not tested.
- Mutant predictions were drafted with AI assistance, then checked by me against the generator and the code. The generator claim (no `\r`, empty strings are common) was verified by sampling 20,000 values.
- The properties were drafted with AI assistance and reviewed by me for correctness and traceability to the requirements above.
