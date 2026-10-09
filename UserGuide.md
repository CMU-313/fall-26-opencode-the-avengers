## User Guide 

## Table of Contents

1. [Shared Conversation Tracking — Zoe Carpenter](#1-shared-conversation-tracking-implemented-by-zoe-carpenter)
2. [Saving Assistant Responses as .md or .txt — Katherine Geng](#2-saving-assistant-responses-as-md-or-txt-implemented-by-katherine-geng)
3. [Read the Last Assistant Response Aloud — Willie Yang](#3-read-the-last-assistant-response-aloud-implemented-by-willie-yang)
4. [Session History Recap — Wunwan Boonsitanara](#4-session-history-recap-implemented-by-wunwan-boonsitanara)
5. [/copy [x] — Toby Yang](#5-copy-x-implemented-by-toby-yang)

---

## 1. Shared Conversation Tracking (implemented by Zoe Carpenter)

The Shared Access Tracking feature allows the owner of a shared OpenCode conversation to see how many additional users are currently viewing the conversation.

## How to Use It

**Here are the steps:**

1. In OpenCode, type `/share` to create a public link to the current conversation.
2. The public shareable link will automatically be copied to your clipboard.
3. An **Additional Viewers** counter will appear in the OpenCode sidebar.
4. Send the shared link to collaborators.
5. As collaborators open or leave the shared conversation, the **Additional Viewers** counter will update to reflect the number of additional users currently accessing it.

## How to User Test It

The `/share` command sends the local session to opncd.ai, where the deployed version of `packages/enterprise` is running. Since the deployed version does not contain these changes, you need to run the modified `packages/enterprise` locally.

Using this feature locally requires an in-memory implementation of the existing Storage interface, a Cloudflare tunnel to generate a temporary public URL that forwards to the local Enterprise server, and an `opencode.json` file that overrides the normal Enterprise URL with the temporary tunnel URL.

**Here are the steps:**

1. Run `OPENCODE_STORAGE_ADAPTER=memory bun run dev` from `packages/enterprise`.

2. Copy the local address shown in your terminal (usually `http://localhost:3002`).

3. In another terminal window, run `cloudflared tunnel --url <paste local address from step 2>`.

4. Copy the Quick Tunnel URL shown in your terminal (usually ending with `.trycloudflare.com`).

5. In the `opencode.json` file, paste the URL from step 4 into the `"url"` field.

6. In a third terminal window, run `bun run dev` from the repository root to launch OpenCode.

7. Once OpenCode has launched, type `/share` and press Enter.

8. The public shareable link will automatically be copied to your clipboard, and the **Additional Viewers** counter will appear in the OpenCode sidebar.

9. Open the shareable link in a browser.

## Manual Test Cases

Verify the following behavior:

- With no additional users viewing the conversation, verify that the counter shows 0.
- Open the shared link in another browser and verify that the counter changes to 1.
- Open the link as another separate viewer and verify that the counter changes to 2.
- Open the shared conversation as 10 separate viewers and verify that the counter correctly reflects 10 additional viewers.
- Close one of the shared conversation tabs/windows and verify that the counter decreases when that viewer leaves.
- Reopen the shared conversation after leaving and verify that the counter increases again.
- Verify that the **Additional Viewers** counter shown on the shared conversation page and in the OpenCode sidebar reflects the correct number of viewers.

## Automated Tests

The automated tests for Shared Access Tracking can be found in `packages/enterprise/test/core/share.test.ts`.

Eight tests were added to cover the Shared Access Tracking functionality. These tests verify that:

- A single viewer can be added to a share.
- Multiple viewers can be added to a share.
- A viewer can be removed from a share.
- The same viewer is not counted more than once.
- A share with no viewers returns an empty viewer list.
- Viewer information is removed when its associated share is deleted.
- 10 simultaneous viewers can be correctly tracked.
- A viewer can leave a shared conversation and then join it again.

**Why these tests are sufficient:**

These tests cover the main backend functionality added for Shared Access Tracking, including adding, retrieving, removing, and cleaning up viewer information. They also cover the expected viewer counts and important edge cases such as duplicate viewers and users leaving and rejoining. Combined with the manual user testing described above, these tests verify both the underlying viewer-management functionality and the user-facing behavior of the **Additional Viewers** counter.

**To run the automated tests locally, navigate to `packages/enterprise` and run:**

`OPENCODE_STORAGE_ADAPTER=memory bun test ./test/core/share.test.ts`

---

## 2. Saving Assistant Responses as .md or .txt (implemented by Katherine Geng) 

This feature lets you save a single AI response from Opencode interface to a file, either as Markdown (`.md`) or plain text (`.txt`). 

### How to use it

There are two ways to save a response:

1. **Save the latest response:** type `/save` in the prompt and press Enter. 
2. **Save any response:** click on the text of an assistant response to open **Message Actions**, then choose **Save to file**.

Then a **Save Response** dialog will open:

- **Filename:** defaults to `response-<id>.md`. Change it to whatever you want.
  - Ending in `.md` saves Markdown, with a header showing the agent, model, and response time.
  - Ending in `.txt` saves only the response text.
  - No extension defaults to `.md`.
  - Any other extension (like `.pdf`) is rejected with an error.
  - Folders are allowed (e.g. `notes/answer.md`); missing folders are created.
  - If the file already exists, you're asked to confirm before it's overwritten.
- **Options** (press `Tab` to move between them, `Space` to toggle): include thinking, include tool details, include assistant metadata, or open in your editor without saving. The first three only affect `.md` files.

### How to user test it

**Setup**

```bash
bun install
mkdir -p ~/save-test
bun dev ~/save-test
```

Then connect to a model (I use Gemini 3.5 flash because it gives free tokens). You can connect to a model via /connect and choose the corresponding model. 
Send a prompt that gets a reply (for example: Explain what a hash map is).
Check your respective local directory whenever you save a response to see that the file is saved there.

**Test cases**

| # | Steps | Expected result |
|---|---|---|
| 1 | `/save`, press Enter to keep the default name | The dialog is titled "Save Response". A `.md` file is created starting with `## Assistant (...)`, and a "Response saved to …" message appears. |
| 2 | `/save`, name it `answer.txt` | The file contains only the response text, with no header. |
| 3 | `/save`, name it `plain` | `plain.md` is created. |
| 4 | `/save`, name it `answer.pdf` | Error "Filename must end in .md or .txt". No file is created. |
| 5 | `/save` as `answer.txt` again | An "Overwrite file?" prompt appears. Cancel keeps the old file; Confirm replaces it. |
| 6 | `/save`, name it `notes/answer.md` | The `notes` folder is created with the file inside. |
| 7 | `/save`, then press Esc | Nothing is saved. |
| 8 | Click the text of an assistant response | Message Actions shows only **Copy** and **Save to file**. |
| 9 | Click one of your own messages | It shows Revert, Copy, and Fork, with no Save option. |
| 10 | Start a new session with `/new`, then `/save` | Error "No assistant messages found". |
| 11 | Run `/export` | Still works as before, with the dialog titled "Export Options". |

### Automated tests

All automated tests are in `packages/tui/test/`. 
- test/save-response.test.tsx
- test/cli/tui/dialog-message.test.tsx
- test/util/response-file.test.ts
- test/util/transcript.test.
- test/cli/tui/dialog-export-options.test.tsx

Run them with:

```bash
cd packages/tui
bun test
```

**What is being tested** 
Tests the /save command and tries saving the response as .txt and .md
Tests that /save picks the most recent response when there are several
Tests that a filename like .pdf is rejected and no file is saved
Tests that saving over an existing file asks first, and the file is only replaced if you confirm
Tests that /save shows an error when there's no response to save
Tests that clicking a response shows only Copy and Save to file
Tests that Save to file saves the response you clicked, and Copy copies its text
Tests that saving creates any missing folders (like notes/answer.md)
Tests what goes in the file: .md gets a header, while .txt is just the response text

**Why these tests are sufficient**

These tests are sufficient, because they test every part of the feature (both saving options – the /save command and save option when clicking an assistant message). It also tests different filenames and file extensions, as well as overwriting files or saving files in folders that don’t exist. Essentially, the tests test every behavior & edge case for this feature. 

**What is checked manually instead**

There are a few tests I couldn’t automate so I tested them manually in the interface myself. These include the following: 
- **Clicking on response text** to open the menu is checked by hand. The menu itself is tested automatically.
- **Typing `/save` letter by letter into the prompt**. The prompt box doesn't render in the test app, so the automated test instead runs `/save` from the same command list the prompt uses.
- **"Open without saving"** depends on your system's text editor, so it's checked by hand.


---

## 3. Read the last assistant response aloud (implemented by Willie Yang)

The terminal interface provides **Speak last response**, also available as `/speech`.
It reads the text of the latest assistant turn, including multiple assistant messages
belonging to the same user prompt. It skips user messages, reasoning, and tool output.
Messages hidden by an undo/revert are excluded.

### Requirements and use

1. Run OpenCode locally on a computer with working audio output and turn up the volume.
   A headless Docker container or SSH host may have no usable audio device.
2. Keep an Internet connection available. Speech synthesis uses Microsoft's Edge
   Read Aloud service and sends the cleaned response text to that service. No API key
   is required by this implementation. The endpoint is undocumented and may change.
3. Open a session, send a prompt, and wait for an assistant response.
4. Enter `/speech` and select/submit the command, or open the command palette and
   choose **Speak last response**.
5. Listen for the latest response. Playback begins as MP3 audio becomes available;
   longer responses are downloaded in successive chunks.
6. Run `/speech` again (or choose **Speak last response** again) to stop the current
   reading, including while it is loading. Invoke it once more to read the latest
   response from the beginning. This is stop/restart, not pause/resume. No new UI
   controls or labels are added.

Markdown is converted to spoken text: headings and list items get pauses, links use
labels (bare URLs become “link”), tables become comma-separated cells, and fenced
code becomes “Code block omitted.” Inline code retains its text. Speech uses the
English-US Ava multilingual neural voice; this command has no voice selector.

### Manual user verification

| Check                       | Steps                                                                                                    | Expected result                                                                                     |
| --------------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Basic playback              | Ask for a short plain-text greeting, then run `/speech`.                                                 | Hear that greeting; the command dialog closes.                                                      |
| Command palette             | Choose **Speak last response** from the palette.                                                         | Hear the same response as with `/speech`.                                                           |
| Markdown                    | Ask for a heading, checklist, link, table, and fenced code sample.                                       | Hear readable text, pauses between lines, table cells, and “Code block omitted”; no raw code block. |
| Latest turn                 | Ask two different questions, then run `/speech`.                                                         | Hear the second answer, not the first answer or either user prompt.                                 |
| Multiple assistant segments | Use a response with intermediate tool calls and multiple text segments.                                  | Hear all text segments for that turn in order, excluding tool results and reasoning.                |
| Undo/revert                 | Undo the newest turn, then run `/speech`.                                                                | Hear the latest assistant response still visible before the revert point.                           |
| Long response               | Request a response longer than 4,096 bytes, then run `/speech`.                                          | Hear the complete response across chunk boundaries; confirm actual audio continuity by listening.   |
| Service/device failure      | In a disposable session, disconnect the network or run without an audio device, then invoke the command. | Speech cannot start; see the limitations below. Restore the connection/device afterward.            |

### Automated tests

Run from the repository root:

```sh
cd packages/tui
bun test ./test/tts.ts
bun typecheck
```

Run the broader TUI regression suite from `packages/tui`:

```sh
bun run test
```

All feature tests and their transport fixture are in [tts.ts](packages/tui/test/tts.ts).

| Test group                   | Coverage and rationale                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `speakable` and `edgeChunks` | Markdown cleanup, closed and unfinished code fences, empty input, sentence packing, XML expansion, UTF-8 byte counting, exact boundaries, and large inputs. Exercises the actual exported functions.                                                                                                                                                                                       |
| Speech transport             | Re-runs this same file in a separate Bun process. Exercises the real `speak` implementation, configuration/SSML frames, XML escaping, authentication/header shapes, binary payload parsing, ordered multi-chunk delivery, cancellation, early close, connection errors, unavailable audio, wrapped playback errors, stop/restart, cancellation during startup, and stale completion races. |
| `playStream`                 | Lazy device creation, startup, reuse, exact source/options forwarding, unavailable hardware, playback errors, startup resolution timing, and disposal/reinitialization.                                                                                                                                                                                                                    |
| `session.speech`             | Executes the actual command expression and revert selector extracted with TypeScript's parser. Checks command metadata, latest-turn selection, multi-part ordering, filtering, trailing user messages, missing parts, and revert boundaries. No selection logic is copied into the tests.                                                                                                  |

**Test discovery:** Bun does not automatically discover `tts.ts` because its name
has no `.test` or `.spec` suffix. Always run `bun test ./test/tts.ts` explicitly.
The existing `bun run test` command and CI workflow do not include this file
automatically. To include it in CI, add that explicit command with
`packages/tui` as the working directory. No package or workflow files were changed,
all tests remain in this single `tts.ts` file. Playback toggling is implemented
in `speech.ts`; the audio wrapper and UI files are unchanged.

Only external boundaries are replaced: the speech WebSocket and audio engine, plus
command dependencies in the focused command harness. This keeps automated runs
independent of Internet access and sound hardware. The unavoidable WebSocket global
replacement and module mock are isolated in a child process to avoid contaminating
other tests. Audio spies are restored and the singleton is disposed after each test.

These tests cover the feature's transformations, service framing, playback wrapper,
and command selection behavior. They do **not** certify Microsoft's live endpoint,
actual sound quality, or renderer-level slash-command/palette interaction; use the
manual checks above for those. The command harness runs production expressions but
does not mount the full Session component.

### Sprint 1 acceptance criteria

Assigned to **Willie**; estimated effort **8–12 hours**; complexity **High**.
Dependencies: completed assistant response text, a text-to-speech service, and UI
controls to start and stop playback.

| Acceptance criterion                         | Verification                                                                                                                                                                                                                                                                                                                                                                         | Current status                                                                                                                                                                       |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Convert the requested AI response into audio | Command tests check the exact latest-turn text; transport and playback tests check SSML, audio payloads, and playback startup.                                                                                                                                                                                                                                                       | Automated boundary checks pass; live synthesis still needs manual verification.                                                                                                      |
| User hears the correct words                 | On a local machine, ask for “The blue bicycle has two wheels.” Wait for completion, run `/speech`, and compare what you hear with the visible answer. Then request a different answer and repeat to confirm the latest response is read.                                                                                                                                             | Manual listening test not yet performed. Mock audio cannot prove audibility or pronunciation.                                                                                        |
| User can stop and start playback             | Start a long response with `/speech`; invoke `/speech` again and verify silence. Invoke it once more and verify reading starts from the beginning. Repeat the stop while audio is still loading.                                                                                                                                                                                     | Implemented through the existing command. Automated toggle, startup-cancellation, natural-completion, and stale-completion tests pass; audible manual verification remains required. |
| OpenCode remains functional without TTS      | The new inactive-command test verifies no speech call, dialog clearing, or audio-device creation when the command is unused. Existing lifecycle-export, runtime/rendering, keymap, and clipboard tests serve as broader controls. Manually send two ordinary prompts, read both answers, and navigate the session without invoking `/speech`; confirm normal behavior and no speech. | Automated controls are separate from an end-to-end live prompt test; manual control check not yet performed.                                                                         |

Run the existing control tests alongside the feature tests from `packages/tui`:

```sh
bun test ./test/tts.ts test/index.test.tsx test/runtime.test.tsx test/keymap.test.tsx test/clipboard.test.ts
```

The stop/start TODO has been replaced with executable tests. The existing command
still calls `speak`; that function now toggles its own playback state using the audio
library’s cancellation signal. No UI code or layout changes were needed.

### Known limitations and follow-up

- The command calls `void speak(text)` without catching rejection. An empty response,
  unreachable service, or unavailable device can produce an unhandled rejection
  rather than a friendly error toast. Empty-content delegation is characterized by
  the command test; friendly error handling is not claimed as passing behavior.
- Cancellation prevents later chunks from downloading; it does not immediately
  close the current synthesis socket. The existing `/speech` command now toggles
  playback off immediately through the audio library’s abort signal.
- Playback starts over after stopping; it does not resume from the previous position.
  Confirm audible stop/restart on a machine with working sound before submission.
- Local test results are separate from hosted CI. Confirm the feature branch's
  GitHub checks are green before merging, and ensure CI explicitly runs
  `bun test ./test/tts.ts` as described above.

### Local verification record

Verified on macOS with Bun 1.4.2 on October 1, 2026:

- Feature suite plus existing control tests after acceptance-criteria alignment:
  **52 passed, 0 failed**, plus 14 passing transport/toggle cases in the subprocess. This includes the
  subprocess wrapper; transport/toggle cases run inside that subprocess.
- Isolated transport/toggle fixture: **14 passed, 0 failed** (also run by that wrapper).
- Before consolidation, full TUI suite: **234 passed, 1 skipped, 0 failed**, including 8 snapshots.
  The renamed `tts.ts` requires its separate explicit run; see test discovery above.
- `bun typecheck`: passed.
- Prettier checks for the new tests and this guide: passed.
- Only `speech.ts` changed in production code. `audio.ts`, `src/index.tsx`, and the
  session screen’s `index.tsx` remain unchanged.

The full suite needed filesystem access for existing state/snapshot tests. It emitted
missing fixture KV-state warnings but completed successfully. Hosted CI and audible
manual checks were not performed.

Suggested PR verification explanation: automated tests execute the existing speech
transformations, transport framing, playback wrapper, and session command selection.
Boundary fakes make the checks deterministic without network or audio hardware. The
full TUI suite and package typecheck pass locally. Manual checks remain necessary for
real sound output, Microsoft's endpoint, and command-palette/slash-input interaction.
The command's uncaught speech rejection remains a documented implementation limitation.


---

## 4. Session History Recap (implemented by Wunwan Boonsitanara)

When you reopen a conversation, a recap appears above the prompt so you can pick
up where you left off:

- **Completed** — what got done, summarized by a small model.
- **Unfinished from your plan** — open plan items, computed in code from your
  actual plan rather than asked of the model, so it is always accurate.
- **Next steps** — from the unfinished items, or model suggestions if there was
  no plan (heading then reads **Suggested next steps**).

### How to use it

Open a conversation that has history and the recap appears automatically. It
disappears when you send a message, or click it to dismiss.

The plan comes from the session's todo list if it has one (`completed` and
`cancelled` count as done), otherwise from markdown checklists (`- [x]` /
`- [ ]`, most recent checkbox wins). Recaps are cached until the conversation
changes, so reopening twice does not call the model twice.

### How to user test it

**Setup**

```bash
bun install
bun dev
```

The installed `opencode` runs the published release and lacks this feature, so
use `bun dev` — the version should read `local`. It has its own database, so
create the test conversation inside it, and connect a model with `/connect`.

**Test cases**

| # | Steps | Expected result |
|---|---|---|
| 1 | Ask for something small, leave with `/sessions`, reopen | Recap appears with the work under **Completed** |
| 2 | Post `- [x] create hello.txt` and `- [ ] add a second line`, leave, reopen | Only `add a second line` under **Unfinished from your plan** |
| 3 | Send any message | Recap disappears |
| 4 | Reopen and click the recap | It dismisses |
| 5 | New conversation with no messages, leave, reopen | No recap at all |
| 6 | Reopen the same conversation twice | Second time is instant, because it is cached |
| 7 | Send a message, then reopen | Recap regenerated with the newer work |
| 8 | Reopen a conversation with no plan | Heading reads **Suggested next steps** |

### Automated tests

All automated tests are in `packages/opencode/test/`:

- `test/session/recap.test.ts` — 36 tests
- `test/session/recap-service.test.ts` — 19 tests
- `test/server/httpapi-exercise/index.ts` — the `session.recap` scenario

Run them with:

```bash
cd packages/opencode
bun test test/session/recap.test.ts test/session/recap-service.test.ts
bun run script/httpapi-exercise.ts --mode effect
```

**What is being tested**

- Checklist parsing: bullet styles, indentation, capital `X`, later mentions
  overriding earlier ones, and lines that merely resemble checklists
- Transcript truncation, keeping the most recent work
- Both prompt branches, with a plan and without
- Model output read from plain JSON, fenced blocks and prose-wrapped responses
- Malformed or wrongly typed output falling back to empty lists, not throwing
- Stored recaps returned, schema-invalid ones ignored
- Cache reused until the conversation changes, then regenerated
- Todo list taking precedence over checklists, with completed and cancelled
  counting as done
- Unfinished items becoming next steps when the model returns none
- Empty conversations skipping the model call entirely
- Unparseable output or an outright model failure still producing a recap
- The HTTP route on a real server, including when no recap exists yet

**Why these tests are sufficient**

Each level of testing covers a different set of risks in the code. Unit tests focus on parsing and formatting, especially cases where users provide unexpected inputs or the model returns plain text instead of JSON. Service tests use a real database and replace only the model with a fake one to check that caching and plan-precedence rules work as expected. The HTTP test makes sure the route works on a running server.

The fake model also tracks how many times it's called, so we can verify that a cached recap doesn't trigger another model request. I also tested failure cases, since resuming a conversation should still work even if the model returns something unexpected.

Line coverage for src/session/recap.ts is 100%.

**What is checked manually instead**

- **Panel rendering and click-to-dismiss** in the terminal. The service and
  route beneath are tested automatically.
- **The recap clearing when you send a message**, which depends on live session
  status in the TUI.
- **Summary quality** — whether the **Completed** list reads sensibly — since it
  varies by model. The tests only assert that whatever comes back is handled
  safely.

---

## 5. /copy [x] (implemented by Toby Yang)

The `/copy` command lets you copy a transcript to your clipboard from the prompt bar.

### How to use it

- `/copy` copies the full conversation transcript.
- `/copy 5` copies only the last 5 messages.
- `/copy x` accepts only a positive integer value for `x`.

Examples:

- `/copy` → copies the entire transcript
- `/copy 3` → copies the most recent 3 messages
- `/copy 10` → copies the most recent 10 messages, or the full transcript if there are fewer than 10

### How to user test it

**Setup**

1. Open a session with at least one message.
2. Enter a slash command in the prompt bar.
3. Use a model or local session history to generate multiple assistant and user messages.

**Test cases**

| # | Steps | Expected result |
|---|---|---|
| 1 | Type `/copy` and submit | The entire transcript is copied to the clipboard |
| 2 | Type `/copy 3` with more than 3 messages | Only the last 3 messages are copied |
| 3 | Type `/copy 10` with fewer than 10 messages | Whatever messages exist are copied, without failure |
| 4 | Type `/copy 0` in a non-empty session | Error message shown: "Message count must be a positive integer." |
| 5 | Type `/copy -1` or `/copy abc` | Error message shown: "Message count must be a positive integer." |
| 6 | Type `/copy 1` in an empty session | No prompt is submitted and no copy action runs |
| 7 | Type `/copy 0` in an empty session | No prompt is submitted and no copy action runs |
| 8 | Type the same `/copy x` command multiple times | It behaves the same each time and does not leave stale prompt text behind |

### Automated tests

The copy command behavior is covered in `packages/tui/test/` by transcript and prompt-interception tests.

Run them with:

```bash
cd packages/tui
bun test
```

**What is being tested**

- `/copy` still copies the full transcript
- `/copy x` copies only the last `x` messages
- `/copy` with fewer than `x` messages copies only the available history
- invalid values like `/copy 0`, `/copy -1`, or `/copy abc` are rejected
- empty-session cases are treated as a no-op rather than submitting the command as prompt text
- valid commands clear the prompt correctly after dispatching the copy action
- repeated `/copy x` calls remain stable and do not change the behavior

**Why these tests are sufficient**

These tests cover the main behaviors of the feature at both the logic layer and the real prompt-submission layer. The transcript tests cover parsing and formatting, while the prompt tests verify the actual user-facing behavior: the command is intercepted before normal prompt submission, and valid commands clear the prompt bar cleanly. This combination checks both the underlying copy logic and the UI interaction that users actually see.

### Known behavior and edge cases

- If the session is empty, `/copy` and `/copy x` are treated as silent no-ops.
- If the session is not empty but the count is invalid, the user sees an error and the command is not sent as normal prompt text.
- Valid copy commands are handled before prompt submission and are removed from the prompt bar automatically.
- The feature is intentionally designed to prevent the command from being sent into the conversation as a visible message.
