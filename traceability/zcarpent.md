# Traceability: Zoe Carpenter (zcarpent)

**Target feature:** Shared Conversation Viewer Tracking

## Requirements

| ID | Interview evidence | Requirement | Acceptance criteria | Changed in P4? | Property (kind) | Test |
|---|---|---|---|---|---|---|
| R1 | O-3 | Opening a shared conversation should register a new active viewer. | Opening the same shared link in three separate tabs results in three registered viewers. | Yes | Model/oracle: Registering N viewers with distinct IDs results in N viewer records. | `R1: registers active viewers` |
| R3 | O-4 | Active viewers should be tracked regardless of which browser, device, or tab is used. | Opening the same shared link in two different browsers or devices results in two registered viewers. Opening it in three tabs results in three viewers. | Yes | Invariant: Every distinct viewer ID registered for a conversation appears in its viewer list. | `R3: tracks independent viewers` |
| R4 | O-5 | The displayed viewer count should match the number of currently active viewers. | Opening five tabs results in a viewer count of five. Closing one tab reduces the count to four. | Yes | Model/oracle: The active viewer count equals the number of distinct registered viewer IDs. | `R4: maintains accurate viewer count` |
| R5 | New (related to O-5) | Closing a shared conversation tab should remove its viewer record without affecting other active viewers. | Opening three tabs and closing one leaves two registered viewers. | New | Round-trip: Adding and then removing a viewer restores the original viewer list; other viewers remain unchanged. | `R5: removes closed viewers` |
| R6 | New (related to O-5) | Registering the same viewer ID multiple times should not create duplicate entries. | Registering the same viewer ID three times results in one viewer record. | New | Invariant: A viewer ID appears at most once in a conversation's viewer list. | `R6: prevents duplicate viewers` |

## Requirement Changes

| ID | Original requirement (P3) | Revised requirement | Why it changed |
|---|---|---|---|
| R1 | Each time someone successfully opens a shared conversation, a new access event should be recorded. | Opening a shared conversation should register a new active viewer. | The implementation tracks currently active viewers instead of maintaining a cumulative history of access events. Each open tab is counted separately. |
| R2 | Access history should not expose visitors' personal information, such as email addresses or IP addresses. | Removed. | The feature does not collect or store email addresses or IP addresses and does not maintain a historical access log. This requirement was removed from the active requirements because it does not describe functionality being implemented. |
| R3 | Accesses should be recorded regardless of which browser or device is used. | Active viewers should be tracked regardless of which browser, device, or tab is used. | The requirement was revised to focus on active viewers and expanded to cover multiple tabs in the same browser. |
| R4 | The displayed access count should match the number of recorded access events. | The displayed viewer count should match the number of currently active viewers. | The displayed count represents active viewers rather than cumulative accesses. Closing a tab should decrease the count. |
| R5 | New requirement. | Closing a shared conversation tab should remove its viewer record without affecting other active viewers. | Added to ensure the active viewer count remains accurate when viewers leave a conversation. |
| R6 | New requirement. | Registering the same viewer ID multiple times should not create duplicate entries. | Added to prevent repeated registration requests from inflating the active viewer count. |

## Property-Based Testing

**R1 — Model/oracle**

Generate a list of viewers with distinct IDs, register each viewer to a shared conversation, and verify that the resulting viewer list contains exactly those viewers.

**R3 — Invariant**

Generate distinct viewer IDs representing different browsers, devices, or tabs. Register them to the same shared conversation and verify that every viewer ID appears in the resulting viewer list.

**R4 — Model/oracle**

Generate a list of viewers with distinct IDs, register them, and verify that the active viewer count equals the number of registered viewers. Remove a subset of viewers and verify that the count decreases by the number removed.

**R5 — Round-trip**

Generate a viewer, register them to a shared conversation, and then remove them. Verify that the viewer list returns to its original state. When multiple viewers are registered, verify that removing one does not remove the others.

**R6 — Invariant**

Generate a viewer and a repetition count. Register the same viewer multiple times and verify that the viewer appears exactly once in the active viewer list.

### Generators

- **Viewer IDs:** `fc.uuid()` generates random viewer identifiers.
- **Viewer names:** `fc.string()` generates viewer names with different lengths and characters.
- **Viewer lists:** `fc.uniqueArray()` generates collections of viewers with distinct IDs.
- **Tab counts:** `fc.integer({ min: 1, max: 10 })` generates the number of simulated open tabs.
- **Registration counts:** `fc.integer({ min: 2, max: 10 })` generates the number of times a viewer is registered.

### Properties written or suggested by AI tools

ChatGPT assisted with revising the requirements and suggesting property-based testing strategies. The properties will be reviewed and implemented using Vitest and fast-check.