import { describe, expect, test } from "bun:test"
import fc from 'fast-check';
import { Share } from "../../../enterprise/src/core/share";

process.env.OPENCODE_STORAGE_ADAPTER = "memory"

// Constructor for active viewers 
const viewers = fc.uniqueArray(fc.uuid(), {minLength: 1, maxLength: 15,}).map((ids) => ids.map((id) => ({id, name: "Viewer",})));

describe('shared conversation viewer tracking', () => {
    // (R1) Pattern: invariant. Each new unique viewer increases the count by one.
    test("increments active viewer count for each unique viewer", async () => {
        await fc.assert(
            fc.asyncProperty(viewers, async (generatedViewers: Share.Viewer[]) => {
                const shareID = crypto.randomUUID()
                try {
                    for (const viewer of generatedViewers) {
                        const before = (await Share.viewers(shareID)).length
                        await Share.addViewer(shareID, viewer)
                        const after = (await Share.viewers(shareID)).length
                        expect(after).toBe(before + 1)
                    }
                } finally {
                    for (const viewer of generatedViewers) {
                        await Share.removeViewer(shareID, viewer.id)
                    }
                }
            }),
        )
    });

    // (R2) Pattern: invariant. Removing an active viewer decreases the count by one.
    test("decrements active viewer count when a viewer leaves", async () => {
        await fc.assert(
            fc.asyncProperty(viewers, async (generatedViewers: Share.Viewer[]) => {
                const shareID = crypto.randomUUID()
                try {
                    for (const viewer of generatedViewers) {
                        await Share.addViewer(shareID, viewer)
                    }

                    for (const viewer of generatedViewers) {
                        const before = (await Share.viewers(shareID)).length
                        await Share.removeViewer(shareID, viewer.id)
                        const after = (await Share.viewers(shareID)).length

                        expect(after).toBe(before - 1)
                    }
                } finally {
                    for (const viewer of generatedViewers) {
                        await Share.removeViewer(shareID, viewer.id)
                    }
                }
            }),
        )
    });

    // (R3) Pattern: round-trip. Adding and then removing viewers should restore the original count.
    test("restores viewer count after opening and closing shared sessions", async () => {
        await fc.assert(
            fc.asyncProperty(viewers, async (generatedViewers: Share.Viewer[]) => {
                const shareID = crypto.randomUUID()

                try {
                    const before = (await Share.viewers(shareID)).length

                    // Open shared sessions
                    for (const viewer of generatedViewers) {
                        await Share.addViewer(shareID, viewer)
                    }

                    // Close shared sessions
                    for (const viewer of generatedViewers) {
                        await Share.removeViewer(shareID, viewer.id)
                    }

                    const after = (await Share.viewers(shareID)).length

                    expect(after).toBe(before)
                } finally {
                    for (const viewer of generatedViewers) {
                        await Share.removeViewer(shareID, viewer.id)
                    }
                }
            }),
        )
    });

    // (R4) Pattern: metamorphic. Adding viewers to one conversation should not affect another.
    test("tracks active viewers of different conversations independently", async () => {
        await fc.assert(
            fc.asyncProperty(viewers, async (generatedViewers: Share.Viewer[]) => {
                const shareID1 = crypto.randomUUID()
                const shareID2 = crypto.randomUUID()

                try {
                    // Add viewers to the first conversation
                    for (const viewer of generatedViewers) {
                        await Share.addViewer(shareID1, viewer)
                    }

                    const before = (await Share.viewers(shareID1)).length

                    // Add the same viewers to the second conversation
                    for (const viewer of generatedViewers) {
                        await Share.addViewer(shareID2, viewer)
                    }

                    const after = (await Share.viewers(shareID1)).length

                    // The first conversation's viewer count should remain unchanged
                    expect(after).toBe(before)

                    // Both conversations should track their own viewers
                    expect(await Share.viewers(shareID2)).toHaveLength(generatedViewers.length)

                } finally {
                    for (const viewer of generatedViewers) {
                        await Share.removeViewer(shareID1, viewer.id)
                        await Share.removeViewer(shareID2, viewer.id)
                    }
                }
            }),
        )
    });

});