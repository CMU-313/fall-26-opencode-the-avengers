# Traceability: Toby Yang (ttyang)

**Target feature:** /copy x command to copy a specific number of recent messages instead of the full chat history.

**Relevant Files:**
packages/http-recorder/dist/effect.d.ts
packages/http-recorder/dist/index.d.ts
packages/http-recorder/dist/socket.d.ts
packages/http-recorder/dist/types.d.ts
packages/tui/src/component/prompt/index.tsx
packages/tui/src/routes/session/index.tsx
packages/tui/src/util/transcript.ts
packages/tui/test/cli/tui/prompt-submit.test.tsx
packages/tui/test/util/transcript.test.ts

## Requirements

| ID | Interview evidence | Requirement | Acceptance Criteria | Changed in P4? | Property (kind) | Test |
|---|---|---|---|---|---|---|
| R1 | C-1, S-1, O-1: Users copy past messages to move them to new containers, remind the AI of the current topic, or run a prompt without previous context. | The /copy x command should copy the text of the x most recent messages from the current conversation. | Running /copy 2 successfully captures the exact text of the 2 most recent messages. | No | Invariant | N/A |
| R2 | C-2, S-2, O-2: If a user requests more messages than exist, it should only copy what is available and provide a warning. | If the requested number x is greater than the available messages, the system must copy all available messages and display a warning indicating the actual number copied. | If the user runs the command /copy 6 but only 4 messages exist, it should copy the 4 messages and display a warning such as "Only 4 messages copied." | No | Invariant | `test/util/transcript.property.test.ts` — R2 |
| R3 | S-3, O-3: Previously deleted messages should not be included in the copied output. | The command must automatically exclude any deleted messages from the copied output without requiring explicit confirmation. | If a chat contains a deleted message, running a /copy command that contains it should ignore the deleted message and copy the previous messages instead. | No | Round-trip | `test/util/transcript.property.test.ts` — R3 |
| R4 | C-4, S-4, O-4: Invalid inputs like 0 should trigger an error or warning message and block the command from executing. | If the user inputs an invalid amount (such as 0), the system must block the action and return an error message. | Running /copy 0 results in no messages being copied and an error displaying that at least one message must be copied. | No | Metamorphic | `test/util/transcript.property.test.ts` — R4 |
| R5 | C-5, S-5, O-5: Changing message order decreases chat quality and is strictly wrong because context matters. | The copied messages must be formatted and preserved in their exact chronological order (oldest to newest). | When copying multiple messages, the older message appears above the newer message in the output. | No | Oracle | `test/util/transcript.property.test.ts` — R5 |

Properties written or suggested by opencode or another AI tool: R2, R3, R4, and R5

## Requirement changes

All five requirements are feasible and testable as written, so none were revised.
