import { describe, expect, test } from "bun:test"
import fc from 'fast-check';
import { Share } from "../../../enterprise/src/core/share";

process.env.OPENCODE_STORAGE_ADAPTER = "memory"

// Constructor for views from multiple tabs in a singular browser (same viewerID for each viewer)
const open_tabs = fc.integer({ min: 2, max: 10 }).map((tabCount: number) => {
  const data = new Map<string, string>();
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {data.set(key, value);},
  };

  const viewers = [];
  for (let i = 0; i < tabCount; i++) {
    const viewerID = storage.getItem("viewer-id") ?? crypto.randomUUID()
    storage.setItem("viewer-id", viewerID)

    viewers.push({
      id: viewerID,
      name: 'Viewer',
    });
  }
  return viewers;
});

// Constructor for views from different devices/browsers (unique viewerIDs for each viewer)
const unique_viewers = fc.uniqueArray(fc.uuid(), {minLength: 1, maxLength: 10,}).map((ids) => ids.map((id) => ({id, name: "Viewer",})));

describe('shared conversation viewer tracking', () => {
    // Pattern: invariant. Each open tab should count as one active viewer.
    test('counts each open tab as a separate viewer', async () => {
        await fc.assert(
            fc.asyncProperty(open_tabs, async (generatedViewers: Share.Viewer[]) => {
            const shareID = crypto.randomUUID();
            for (const viewer of generatedViewers) {
                await Share.addViewer(shareID, viewer);
            }
            const activeViewers = await Share.viewers(shareID);
            expect(activeViewers).toHaveLength(generatedViewers.length);
            }),
        );
    });

    // Pattern: invariant. Each new unique viewer increases the count by one.
    test("increments active viewer count for each unique viewer", async () => {
        await fc.assert(
            fc.asyncProperty(unique_viewers, async (generatedViewers: Share.Viewer[]) => {
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

    // Pattern: 

});