# Traceability: Willie Yang (williey)

**Target feature:** Text-to-Speech (TTS). Using the TUI, a user can run `/speech` to read the latest assistant response in the current chat out loud. Running `/speech` again stops playback.

Main source files:

- `packages/tui/src/speech.ts`
- `packages/tui/src/audio.ts`
- `packages/tui/src/routes/session/index.tsx`

## Requirements

| ID | Interview evidence | Requirement | Acceptance Criteria | Changed in P4? | Property (kind) | Test | Mutants it kills |
|---|---|---|---|---|---|---|---|
| R1 | O-5, O-3, O-4, C-3: “I expect it to follow the words in order and not skip any” | Read-aloud reads the whole response in order. The text is split into requests of at most 4,096 bytes, and joining them back together gives the original text. No words are skipped, repeated, added, or split, unless a single word is over 400 characters, like a long hash. Playback can stop early if the user stops it or the speech service fails. | Take a 2,000-word response of around 9–11 KB. The text is split into at least 3 requests in order, each at most 4,096 bytes. Joining the requests gives the original text. Words like `.env`, `Node.js`, and `3.14` are not split. | Yes | Round-trip | `packages/tui/test/tts/tts.property.test.ts`: R1 test | H1 |
| R2 | O-11, O-12, C-13, C-14, C-16: “check that each word is said and the punctuation is respected” (C-12 and C-15 wanted autocorrect, which conflicts with keeping each word unchanged, so autocorrect is left out.) | The text sent to the voice keeps the response’s words in order. Links and images become their labels, bare URLs become “link,” and code blocks become “Code block omitted.” Markdown formatting, HTML tags, and emoji are removed, and each line ends with punctuation. Inline code stays as written, with no autocorrect. | Run `speakable()` on `"See the [setup guide](https://example.com/setup) or https://example.com/faq first"`. The result is `"See the setup guide or link first."` Run it on ``Call `__init__` with `**kwargs` ``. The result is `"Call __init__ with **kwargs."` | Yes | Model/oracle | `packages/tui/test/tts/tts.property.test.ts`: R2 test | H2 (after strengthening) |
| R3 | O-8, O-10, C-9: “it would just be the same audio when compared to the unformatted version” | Adding bold, italics, extra spaces, or extra blank lines does not change what is spoken. Line breaks add at most one pause between lines. | Run `speakable()` on `"Fix the bug\nRun the tests"` and `"**Fix** the bug\n\n\nRun *the* tests."`. Both return `"Fix the bug. Run the tests."` | No | Metamorphic | `packages/tui/test/tts/tts.property.test.ts`: R3 test | H3 |
| R4 | C-4, C-11, O-9: “Shouldn't say 'comma' or 'periods' or punctuation” | The text sent to the voice contains no markdown symbols, such as heading markers, list bullets, asterisks, underscores, strikethrough markers, backticks, blockquote markers, or pipes, unless they are inside inline code. Normal punctuation stays so the voice can pause on it. | Run `speakable()` on `"## Summary\n- **Fixed** the parser, then ran the tests."`. The result is `"Summary. Fixed the parser, then ran the tests."` Run it on `"> ## Note\n> > Run ~~**old**~~ tests"`. The result is `"Note. Run old tests."` | Yes | Invariant | `packages/tui/test/tts/tts.property.test.ts`: R4 test | H3, H4 |
| R5 | C-8, O-7, C-5, O-6: “I would expect the audio to not save once we switch back” | Switching away from a chat and back does not resume its audio. `/speech` reads the latest response in the current chat, even if another chat has a newer response. | Chat A’s latest response is `"Hello how can I help you"` and chat B’s newer response is `"I am doing well."` Run `/speech` in A. It calls `speak("Hello how can I help you")`. After A’s audio ends, switch to B and back to A. Switching never calls `speak()`, and A’s audio does not restart. | No | Model/oracle | `packages/tui/test/tts/tts.property.test.ts`: R5 test | H5 |

Properties written or suggested by opencode or another AI tool: R1, R2, R3, R4, R5 (properties and generators written by Claude). Claude also suggested the requirement changes below and the fixes in `speech.ts`.

## Requirement changes

| ID | Original requirement (P3) | Revised requirement | Why it changed |
|---|---|---|---|
| R1 | Read-aloud speaks the reply from its first word to its last, in order, without stopping early or skipping, repeating, or adding words from the TTS message which may be different from the display message. | Read-aloud reads the whole response in order using requests of at most 4,096 bytes. Joining the requests gives the original text, and words stay together unless a word is over 400 characters. Playback can stop if the user stops it or the service fails. | The original requirement promised that playback would never stop early, but the Edge service can fail and running `/speech` again stops playback on purpose. I changed it to describe what we can check. My P3 example also said “3 requests,” but sentence boundaries can require more: four 2.1 KB sentences need 4 requests if each sentence stays together. The requirement still keeps what O-5 and C-3 wanted: every word, in order. |
| R2 | The text sent to the voice should match the reply word for word, except for intentional rewrites, fixes, or substitutions. | Keep the response’s words in order, with specific changes for links, images, bare URLs, code blocks, markdown formatting, HTML tags, emoji, and line-ending punctuation. Inline code stays unchanged, with no autocorrect. | “Intentional rewrites, fixes, or substitutions” was too vague to test, so I listed the allowed changes. C-12 and C-15 wanted autocorrect, but O-11, O-12, and C-14 treated changed or skipped words as mistakes, so I left autocorrect out. I also corrected the P3 example: a space between `]` and `(` meant it was not a valid markdown link, and bare URLs become “link,” not “the example link.” |
| R4 | The voice should never say punctuation or markdown symbols as words and should just be a simple pause. | Remove markdown symbols from the text sent to the voice, except inside inline code. Keep normal punctuation so the voice can pause on it. | The tests check the text sent to the voice, not what the audio actually says, so I changed the requirement to match what we can test. Punctuation stays for pauses, as C-11 and O-9 wanted. Inline code is an exception because removing symbols from `**kwargs` would conflict with R2’s requirement to keep inline code as written. |

## Hand-written mutants

I wrote down each prediction before running the mutant. Results are from my P4 properties, before any strengthening. The patches are in `mutants/williey/`.

| ID | Requirement targeted | Change | Predicted killer | Actual result |
|---|---|---|---|---|
| H1 | R1 | `speech.ts`, `edgeChunks`: `Buffer.byteLength(x)` changed to `Buffer.byteLength(x, "ascii")`, so every character counts as one byte when checking the 4,096-byte limit | R1 "splitting a reply into requests and joining them back gives the original text". Its replies have multi-byte words like `你好` and `naïve`, so a request would go over 4,096 real bytes | Killed by R1, as predicted. The counterexample was a long reply with `日本語`, `naïve` and `你好` in it |
| H2 | R2 | `speech.ts`, `speakable`: the HTML tag regex lost its `i` flag, so upper-case tags like `<BR>` are not removed | None. R2 says HTML tags are dropped, but the R2 generator only makes words, links, images, URLs and inline code, so no reply ever has a tag in it | Survived, as predicted. All 5 properties passed |
| H3 | R3 | `speech.ts`, `speakable`: the bold markers `(\*\*\|__\|~~)` changed to `(\*\*\|~~)`, so `__bold__` is forgotten | R3 "re-formatting a reply leaves the spoken text unchanged". Its generator wraps words as `__word__`, so the formatted reply would not match the plain one | Killed by R3, as predicted. R4 also killed it, because the leftover `_` is not an allowed character |
| H4 | R4 | `speech.ts`, `speakable`: the bullet markers `[-*+]` changed to `[-*]`, so `+ item` keeps its plus | R4 "speakable output is only words, spaces and sentence punctuation". Its generator writes `+` bullets and `+` is not an allowed character | Killed by R4, as predicted. The counterexample started with `+ https://example.com` |
| H5 | R5 | `routes/session/index.tsx`, `/speech`: `findLast` changed to `find`, so it picks the first response in the chat and not the latest | R5 "across any sequence of chat switches, /speech passes the current chat's latest reply". Any chat with two or more turns would read the wrong one | Killed by R5, as predicted. The counterexample was a chat with a first response "A" and a second turn with no response yet |

## Stryker comparison

fast-check seed: 42 (`fc.configureGlobal({ seed: 42 })` at the top of the test file).

**Mutation score with my P4 properties: 72.73%.** Stryker made 220 mutants: 155 were killed, 5 timed out, and 60 survived.

**Which hand-written mutants did Stryker never generate? Why not?** All five (H1-H5). Stryker only makes small fixed kinds of edits, and mine were not on its list. H1 adds an argument (`"ascii"`) to a function call, and Stryker never adds arguments; the only mutant it made on that line replaced the whole function with `() => undefined`. H2 removes a regex flag (`i`), but Stryker changes what is inside a regex and not its flags, so it made 4 other regex mutants on that line. H3 removes one option from a group (`**`, `__`, `~~`), and Stryker's only mutant on that line removed the `+?`. H4 removes one character from a set (`[-*+]` to `[-*]`), while Stryker flips the whole set to `[^-*+]` but never drops a single character. H5 is in `routes/session/index.tsx`, which is outside the lines I told Stryker to mutate.

**Which Stryker survivors would I never have thought of? Are any realistic?** I would not have thought of dropping the `^` at the start of a regex or the `$` at the end (7 survivors), and a developer could easily forget an anchor, so those are realistic. Replacing `""` with `"Stryker was here!"` (6 survivors) is something nobody would write, but it showed me something real: R4 only checked which characters are in the output, so extra words passed. Changing `<=` to `<` and `>` to `>=` at the 4,096-byte limit are normal off-by-one bugs, and they survived because R1 never checked that requests are as full as they can be. Changing `.join(", ")` to `.join("")` for table cells, and `line.trim().startsWith("|")` to `line.startsWith("|")`, are also things a developer could write; they survived because R4 never checked that the words are still there and separated. The 3 `escapeXml` survivors were a surprise too: the test measures the bytes itself and never looks at the escaping in the code.

**What does each approach find that the other does not?** Hand-written mutants are aimed at a requirement. Each one is a bug I can explain in one sentence, like "it reads the first response and not the latest", and they can be anywhere, including `index.tsx`. But I only wrote five, and I only thought of the bugs I already expected. Stryker is not aimed at anything, but it tries every line. It found weak spots I did not look at, mostly in the table and code block lines, and it showed that whole lines of `speakable` could be broken with all 5 properties still passing. It cannot make bigger edits like adding an argument or removing a flag, and it only looks at the lines I give it.

### Strengthening

I did not add any example tests. I only changed generators and assertions, and added one property.

For R1 I added a new property: "requests are whole sentences, packed as full as the limit allows". The limit is set from the generated text so that sentences land exactly on it. It checks that every request ends at a sentence end and that two neighbour requests would not fit in one. This kills the `<` and `>=` boundary mutants, the "always start a new request" mutant, and the `escapeXml` mutants.

For R2 I changed the generator so replies also have HTML tags, emoji, code blocks, and inline code with 2 or 3 backticks. This kills H2 and the HTML, emoji, and backtick survivors.

For R3 I changed the generator so a control character between two words counts as extra space. This kills the control character survivor.

For R4 I changed both the assertion and the generator. Every generated piece now carries the words it should leave behind, and the words in the output must equal them in order. Punctuation must sit on a word. Markers are also written the loose ways markdown allows: indents, extra spaces, tables without outer pipes, and a table cell that is just `-`. This kills the "Stryker was here!" survivors and the code block, table, heading, and list survivors.

**Final mutation score: 97.74% as Stryker reports it.** Stryker made 221 mutants: 211 were killed, 5 timed out, and 5 survived. **With equivalent mutants excluded: 100%** (216 of 216).

The 5 survivors are all equivalent.

On line 148, the last `.filter(Boolean)` in `edgeChunks` is removed. Every piece starts with a non-space character, so no request is ever empty after trimming. There is nothing for the filter to remove.

Also on line 148, `(?=\s|$)` is changed to `(?=\s)`. The regex has `|$` right after this group, which already matches at the end of the text. A sentence at the end of the text is matched the same way either way.

On line 149, `?? []` is changed to `?? ["Stryker was here"]`. The fallback is only used if the word regex finds nothing in a sentence. A sentence always starts with a non-space character, so the regex always finds something.

On line 176, `code = []` is changed to `code = ["Stryker was here"]`. Inline code is saved by position and read back by the same position. Starting the list with one extra item shifts both by one, so each code span still gets its own text back.

On line 196, the heading regex `[ \t]+` is changed to `[ \t]`. With more than one space after the `#`, the extra spaces are left at the start of the line, and the line is trimmed later anyway. The output is the same.

## Agent failure case

**Property:** `packages/tui/test/tts/tts.opencode-r2.property.test.ts`, written by opencode (model: Gemini 3.6 Flash, medium) for R2. It is committed unchanged as evidence. Session: `ses_e2d265124ffezM9HeX6pnklHS1`. Share link: not available (the `/share` command fails in my opencode build with "undefined is not an object (evaluating 'res.data.share')"). Screenshots of the session are in `mutants/williey/transcript/`: `opencode-r2-1-prompt.png` (prompt and tool calls), `opencode-r2-2-html-test.png` (the HTML property it wrote), `opencode-r2-3-run.png` (its test run).

**Transcript excerpt.** Prompt I gave opencode, in a new session:

```
Write a fast-check property test for this requirement of speakable()
in packages/tui/src/speech.ts:

"The text sent to the voice keeps the response's words in order. Links and
images become their labels, bare URLs become 'link', and code blocks become
'Code block omitted'. Markdown formatting, HTML tags, and emoji are removed,
and each line ends with punctuation. Inline code stays as written."

Do not read anything in the traceability/ or mutants/ folders, or
packages/tui/test/tts/tts.property.test.ts.
Put it in packages/tui/test/tts/tts.opencode-r2.property.test.ts.
```

opencode read `packages/tui/src/speech.ts`, `packages/tui/test/util/format.test.ts`, and the two `package.json` files, searched for existing fast-check usage, and ran `bun test test/util/format.test.ts` to check the test setup. It wrote the file and ran it, and the first run failed. It then rewrote its own generators (it added filters to the `fc.webUrl()` URLs and changed the code block content from `fc.fullUnicodeString()` to `fc.string()`) and ran the file again: 7 pass, 0 fail. There is no final reply to quote: the session stalled on provider rate limits during its last step, `bun typecheck`, and I interrupted it. The file it had already written has 7 properties. The one for HTML tags:

```ts
test("removes markdown formatting, HTML tags, and emoji", () => {
  const wordArb = fc.stringMatching(/^[a-zA-Z0-9]{2,10}$/)
  const emojiArb = fc.constantFrom("😀", "🚀", "✨", "🔥", "❤️", "🤖", "🎉", "👍")

  fc.assert(
    fc.property(wordArb, emojiArb, (word, emoji) => {
      const formatted = `# Header ${word} ${emoji}\n> **bold** *italic* ~~strike~~ <div><span class="test">${word}</span></div>`
      const output = speakable(formatted)

      expect(output).not.toContain("**")
      expect(output).not.toContain("~~")
      expect(output).not.toContain("<div>")
      expect(output).not.toContain("</span>")
      expect(output).not.toContain("# Header")
      expect(output).not.toContain(">")
      ...
```

**Mutant it let survive:** H2 (the HTML tag regex loses its `i` flag, so upper-case tags like `<BR>` are not removed). Run against only opencode's file: 7 pass, 0 fail on the real code, and 7 pass, 0 fail with H2 applied, so H2 survives. H1, H3 and H4 also passed all 7 tests, but H1 is in `edgeChunks`, which R2 does not cover, so I count H2, the mutant written for R2.

**Why the property was too weak.** The generator never reaches the bug. The test is called a property and uses fast-check, but the only things that vary are one word and one emoji. The HTML is a single hard-coded, lower-case snippet (`<div><span class="test">…</span></div>`), so no run ever has an upper-case tag, and a cleaner that only removes lower-case tags passes every time. The assertions are fine: `not.toContain(">")` would catch a leftover tag if one were ever produced. It reads as thorough because it lists headings, bold, italics, strikethrough, HTML and emoji in one input, but that input is one example with a random word in it.

**Strengthened version:** `packages/tui/test/tts/tts.opencode-r2-strengthened.property.test.ts`. Same assertions; only the HTML part of the input changed. The two tag names are now generated with `fc.mixedCase(fc.constantFrom("div", "span", "b", "em", "p", "details"))`, so each letter is randomly upper- or lower-case. Seed fixed at 42.

**Evidence it kills the mutant.** On the real code: 1 pass, 0 fail. With H2 applied: fails after 2 runs with counterexample `["A0","😀","B","div"]`, which is the input `<B><div class="test">A0</div></B>`; the upper-case `<B>` tags are left in the output.
