import { test } from "bun:test"
import path from "path"
import fc from "fast-check"
import { tmpdir } from "../fixture/fixture"
import { writeResponseFile } from "../../src/util/response-file"

// Generator for response content. We mix plain strings with markdown-shaped
// fragments (headings, list items, fenced code blocks, empty strings, blank
// lines) so the properties actually exercise the structure the interviews
// cared about: markdown must survive (C-5, S-1) and nothing extra is added
// (C-2, O-2).
const content = fc.oneof(
  fc.string(),
  fc.constantFrom("# Heading\n", "- item\n", "```\ncode\n```\n", "", "\n\n"),
  fc.array(fc.constantFrom("# H\n", "- a\n", "text\n", "```\nx\n```\n")).map((xs) => xs.join("")),
)

// R2: Saving preserves the response content exactly, so markdown structure survives.
// Kind: round-trip
test("R2: a new file reads back exactly what was written", async () => {
  await fc.assert(
    fc.asyncProperty(content, async (text) => {
      await using tmp = await tmpdir()
      const written = await writeResponseFile({
        directory: tmp.path,
        filename: "answer.md",
        content: text,
        confirmOverwrite: async () => true,
      })
      return written === true && (await Bun.file(path.join(tmp.path, "answer.md")).text()) === text
    }),
    { numRuns: 50 },
  )
})

// R3: Canceling a save (declining overwrite) must not modify an existing file.
// Kind: invariant
test("R3: declining overwrite leaves the existing file unchanged", async () => {
  await fc.assert(
    fc.asyncProperty(content, content, async (original, replacement) => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "answer.md")
      await Bun.write(filepath, original)
      const written = await writeResponseFile({
        directory: tmp.path,
        filename: "answer.md",
        content: replacement,
        confirmOverwrite: async () => false,
      })
      return written === false && (await Bun.file(filepath).text()) === original
    }),
    { numRuns: 50 },
  )
})

// R5: A successful save writes exactly the given content, nothing injected.
// Kind: invariant
test("R5: a successful save writes exactly the given content", async () => {
  await fc.assert(
    fc.asyncProperty(content, async (text) => {
      await using tmp = await tmpdir()
      const written = await writeResponseFile({
        directory: tmp.path,
        filename: "answer.md",
        content: text,
        confirmOverwrite: async () => true,
      })
      const saved = await Bun.file(path.join(tmp.path, "answer.md")).text()
      return written === true && saved === text
    }),
    { numRuns: 50 },
  )
})

// R6: With a timestamp, the file is a header followed by exactly the content.
// Kind: round-trip / metamorphic
test("R6: timestamped save prepends a header and preserves the content", async () => {
  await fc.assert(
    fc.asyncProperty(content, async (text) => {
      await using tmp = await tmpdir()
      const when = new Date("2026-11-05T12:00:00.000Z")
      const written = await writeResponseFile({
        directory: tmp.path,
        filename: "answer.md",
        content: text,
        confirmOverwrite: async () => true,
        timestamp: when,
      })
      const saved = await Bun.file(path.join(tmp.path, "answer.md")).text()
      return written === true && saved === `<!-- Saved ${when.toISOString()} -->\n\n${text}`
    }),
    { numRuns: 50 },
  )
})
