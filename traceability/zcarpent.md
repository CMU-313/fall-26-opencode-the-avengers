# Traceability: Zoe Carpenter (zcarpent)

**Target feature:** Shared Conversation Viewer Tracking

## Requirements

| ID | Interview evidence | Requirement | Acceptance criteria | Changed in P4? | Property (kind) | Test |
|---|---|---|---|---|---|---|
| R1 | O-3 | Each new unique viewer increases the viewer count by one. | Registering five viewers with unique IDs results in a viewer count of five. Each registration increases the count by exactly one. | Yes | Invariant: Registering a new unique viewer increases the active viewer count by one. | `increments active viewer count for each unique viewer` |
| R2 | O-5 | Removing an active viewer decreases the count by one. | Registering five viewers and removing one results in a viewer count of four. Each removal decreases the count by exactly one. | Yes | Invariant: Removing an active viewer decreases the active viewer count by one. | `decrements active viewer count when a viewer leaves` |
| R3 | O-5 | Adding and then removing viewers should restore the original count. | Registering five viewers and then removing all five restores the viewer count to its original value. | New | Round-trip: Adding and then removing the same set of viewers restores the original active viewer count. | `restores viewer count after opening and closing shared sessions` |
| R4 | O-4 | Adding viewers to one conversation should not affect the viewer count of another conversation. | Registering three viewers to one conversation and five viewers to another results in independent counts of three and five. | New | Metamorphic: Adding viewers to one conversation does not change the active viewer count of another conversation. | `tracks active viewers of different conversations independently` |
| R5 | O-4 | Removing a viewer from one conversation should not affect the viewer count of any other conversation.  | Registering the same five viewers to two different conversations and removing one from the first conversation results in independent counts of four and five. | New | Not selected | Not selected |


## Requirement Changes

| ID | Original requirement (P3) | Revised requirement | Why it changed |
|---|---|---|---|
| R1 | Each time someone successfully opens a shared conversation, a new access event should be recorded. | Each new unique viewer increases the viewer count by one. | The implementation tracks currently active viewers rather than cumulative access events. The revised requirement focuses on correctly incrementing the active viewer count for new accesses. |
| R2 | The displayed access count should match the number of recorded access events. | Removing an active viewer decreases the count by one. | Because the count represents currently active viewers, it must decrease when a viewer leaves rather than continually increasing. |
| R3 | Accesses should be recorded regardless of which browser or device is used. | Adding and then removing viewers should restore the original count. | The revised requirement verifies that viewer registration and removal work together correctly and do not leave stale viewer records. |
| R4 | New requirement. | Adding viewers to one conversation should not affect the viewer count of another conversation. | Added to ensure that viewer records are associated with the correct shared conversation and do not interfere with other conversations. |

## Property-Based Testing

**R1 — Invariant: Incrementing active viewer count**

Generate a list of viewers with unique IDs. Register each viewer to a shared conversation and verify that the active viewer count increases by exactly one after each registration.

**R2 — Invariant: Decrementing active viewer count**

Generate a list of viewers with unique IDs and register them to a shared conversation. Remove each viewer one at a time and verify that the active viewer count decreases by exactly one after each removal.

**R3 — Round-trip: Restoring the original viewer count**

Generate a list of viewers with unique IDs and record the initial active viewer count. Register all generated viewers to simulate opening shared sessions, then remove all of them to simulate closing the sessions. Verify that the final active viewer count equals the initial count.

**R4 — Metamorphic: Independent viewer tracking across conversations**

Generate two lists of viewers and two different shared conversation IDs. Register viewers to the first conversation and record its active viewer count. Register viewers to the second conversation and verify that the first conversation's count remains unchanged. Also verify that the second conversation has the expected number of active viewers.

## Generators

- **Viewer IDs:** `fc.uuid()` generates random viewer identifiers.
- **Viewer lists:** `fc.uniqueArray(fc.uuid(), { minLength: 1, maxLength: 15 })` generates lists of 1–15 unique viewer IDs.
- **Viewer objects:** Generated IDs are mapped to objects containing an `id` and the name `"Viewer"`.
- **Independent viewer lists:** Two viewer-list generators produce collections of viewers for testing separate shared conversations.
- **Shared conversation IDs:** `crypto.randomUUID()` generates identifiers for test conversations.

## Test Implementation

The four property-based tests are implemented in:

`packages/opencode/test/share/share.property.test.ts`

The tests use **Bun and fast-check**. Each property is evaluated using randomly generated viewer lists to test the behavior across different viewer counts and identifiers.

To run the tests from `packages/opencode`:

```bash
bun test test/share/share.property.test.ts
```

These tests verify the backend's active viewer registration, removal, count restoration, and isolation between conversations.

## Properties Written or Suggested by AI Tools

ChatGPT assisted with identifying appropriate property-based testing patterns and developing the four tests. The tests use two invariant properties, one round-trip property, and one metamorphic property. ChatGPT also assisted with refining the requirements and identifying potential issues with duplicate viewer IDs and cleanup in the independent-conversations test.

## Hand-Written Mutants with Predictions

| ID | Requirement targeted | Change | Predicted killer | Actual result |
|---|---|---|---|---|
| H1 | R1 | share.ts: Changed the storage key in addViewer() from ["share_viewer", shareID, viewer.id] to ["share_viewer", shareID, viewer.name]. Since viewer names are not guaranteed to be unique, registering multiple viewers with the same name causes their records to overwrite one another, resulting in an incorrect active viewer count. 
| (R1) Each new unique viewer increases the count by one | -- |
| H2 | R2 | share.ts: Changed the storage key in removeViewer() from ["share_viewer", shareID, viewerID] to ["share_viewer", viewerID]. Since viewer records are stored using both the shared conversation ID and viewer ID, the modified key does not match the existing records. As a result, removing a viewer has no effect, and the active viewer count does not decrease. 
| (R2) Removing an active viewer decreases the count by one. (R3) Adding and then removing viewers should restore the original count | -- |
| H3 | R4 | share.ts: Changed the prefix used in Storage.list() within viewers() from ["share_viewer", shareID] to ["share_viewer"]. This causes the function to retrieve viewer records from all shared conversations instead of only the specified conversation. As a result, viewers registered to one conversation are incorrectly included in the active viewer counts of other conversations. 
| (R4) Adding viewers to one conversation should not affect another. | -- |
| H4 | R5 | share.ts: Modified removeViewer() to retrieve all stored viewer records and iterate through them, removing any record whose viewer ID matches the specified viewerID. Since the implementation does not check shareID, removing a viewer from one conversation also removes that viewer from any other conversations where the same ID is registered. 
| (None) A property was not written for this requirement | -- | 

| H5 | R3 | share.ts: Modified removeViewer() to remove a viewer only when more than one viewer remains registered to the conversation. This prevents the last viewer from being removed, leaving a stale viewer record and preventing the active viewer count from returning to its original value.
| (R3) Adding and then removing viewers restores the original count. (R2) Removing an active viewer decreases the count by one.| -- |