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

// R2: When saving as Markdown, the saved file preserves the response content exactly, so headings, lists, and code blocks are kept.
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

// R3: Canceling a save (declining the overwrite prompt) must not modify an existing file.
// Kind: invariant
// A dismissed dialog resolves undefined rather than false, so both count as declining.
test("R3: declining overwrite leaves the existing file unchanged", async () => {
  await fc.assert(
    fc.asyncProperty(content, content, fc.constantFrom(false, undefined), async (original, replacement, answer) => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "answer.md")
      await Bun.write(filepath, original)
      const written = await writeResponseFile({
        directory: tmp.path,
        filename: "answer.md",
        content: replacement,
        confirmOverwrite: async () => answer,
      })
      return written === false && (await Bun.file(filepath).text()) === original
    }),
    { numRuns: 50 },
  )
})

// R5: Saving writes exactly the response content it was given, with nothing injected (no thinking, tool output, or metadata the user did not ask for).
// Kind: invariant (checked on file size in bytes, independent of the R2 text comparison)
test("R5: a successful save adds no bytes beyond the given content", async () => {
  await fc.assert(
    fc.asyncProperty(content, async (text) => {
      await using tmp = await tmpdir()
      const written = await writeResponseFile({
        directory: tmp.path,
        filename: "answer.md",
        content: text,
        confirmOverwrite: async () => true,
      })
      return written === true && Bun.file(path.join(tmp.path, "answer.md")).size === Buffer.byteLength(text, "utf8")
    }),
    { numRuns: 50 },
  )
})

// R1: Saving never silently replaces an existing file: the user is asked to confirm first, and only when the file already exists.
// Kind: model/oracle (expected number of prompts = 1 if the file exists, else 0)
test("R1: the overwrite prompt appears exactly when the file already exists", async () => {
  await fc.assert(
    fc.asyncProperty(content, content, fc.boolean(), async (original, replacement, exists) => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "answer.md")
      if (exists) await Bun.write(filepath, original)
      let prompts = 0
      await writeResponseFile({
        directory: tmp.path,
        filename: "answer.md",
        content: replacement,
        confirmOverwrite: async () => {
          prompts++
          return true
        },
      })
      return prompts === (exists ? 1 : 0)
    }),
    { numRuns: 50 },
  )
})

// R6: When a timestamp is supplied, the saved file is a timestamp header followed by exactly the response content.
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
