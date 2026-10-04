# User Guide

## Read the last assistant response aloud

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
