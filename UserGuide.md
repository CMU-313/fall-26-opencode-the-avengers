# User Guide

## Read the last assistant response aloud

The terminal has a **Speak last response** command, which can also be used by typing `/speech`.

This command reads out the most recent response from the assistant. If the assistant response has multiple parts, it will read all of them in order. It will not read the user's messages, reasoning, tool output, or messages that were removed with undo/revert.

### How to use it

1. Run OpenCode on a computer that has working speakers or headphones.
2. Make sure you have an Internet connection because the speech uses Microsoft's Edge Read Aloud service.
3. Send a prompt and wait for the assistant to respond.
4. Type `/speech`, or open the command palette and choose **Speak last response**.
5. The assistant response should start playing as audio.
6. If you use `/speech` again while it is playing, it will stop. If you use it one more time, it starts the response again from the beginning.

This works more like stop and restart instead of pause and resume.

The command also cleans up Markdown before reading it. For example, headings and lists will have pauses, links will read their names instead of the full URL, tables are read as normal text, and code blocks are skipped by saying "Code block omitted." The current voice is the English-US Ava voice and there is no option to change it right now.

## Manual testing

There are a few things that should be manually tested.

For basic playback, ask the assistant for a short sentence and then run `/speech`. You should hear the same sentence.

You should also test the command palette and make sure **Speak last response** does the same thing as `/speech`.

For Markdown, ask the assistant to create something with a heading, list, link, table, and code block. The speech should make all of these understandable instead of reading the raw Markdown.

You should also ask two different questions and then use `/speech`. It should only read the newest assistant response.

For a long response, make sure the whole response plays even if it has to be split into multiple audio chunks.

You should also test stopping and restarting the speech and test what happens when there is no Internet or working audio device.

## Automated testing

From the repository root, run:

```sh
cd packages/tui
bun test ./test/tts.ts
bun typecheck
```

You can also run the normal TUI test suite with:

```sh
bun run test
```

One important thing is that `tts.ts` is not automatically found by Bun because the file name does not end in `.test` or `.spec`. Because of this, `bun test ./test/tts.ts` has to be run directly.

The tests check things such as cleaning up Markdown, breaking large responses into chunks, sending requests to the speech service, playing the audio, stopping and restarting the audio, and making sure the correct assistant response is selected.

The tests fake things such as the Internet connection and audio device so that the automated tests do not depend on Microsoft's real server or actual speakers. Because of this, automated tests can show that our code is working, but they cannot prove that the actual voice sounds correct or that Microsoft's service is currently working.

## Sprint 1 acceptance criteria

This feature is assigned to **Willie** and was estimated to take around **8–12 hours** with **High** complexity.

The main requirements are:

- Convert the assistant response into audio.
- Make sure the user hears the correct response.
- Allow the user to stop and start the playback.
- Make sure OpenCode still works normally when TTS is not being used.

Most of these behaviors are already covered by automated tests. However, actual audio still needs to be manually tested on a real computer because a fake audio device cannot prove that the user can actually hear the sound.

The user should also manually make sure that OpenCode works normally without ever using `/speech`.

## Known limitations

There are still a few limitations with the feature.

If the speech service is unavailable, the response is empty, or the computer does not have an audio device, the command can cause an error instead of showing a nice error message.

Stopping playback will stop the audio, but it may not immediately close the current connection to the speech service.

When the speech is stopped and started again, it starts from the beginning instead of continuing from where it stopped.

The feature also still needs to be manually tested with real speakers before submission.

Finally, the GitHub CI checks should be checked before merging because the local tests do not guarantee that the hosted CI tests will also pass.

## Local testing results

The feature was tested on macOS with Bun 1.4.2 on October 1, 2026.

The feature and control tests had **52 passed and 0 failed**, with another **14 transport and toggle tests passing** in a separate process.

The full TUI test suite previously had **234 passed, 1 skipped, and 0 failed**.

`bun typecheck` also passed, and the Prettier checks passed.

Only `speech.ts` was changed for the actual production code. The other audio and UI files were not changed.

The main thing that still needs to be tested is the real audio output, Microsoft's actual speech service, and using the command through the real command palette and `/speech` input.
