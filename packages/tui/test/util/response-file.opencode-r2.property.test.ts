import { test } from "bun:test"
import path from "path"
import fc from "fast-check"
import { tmpdir } from "../fixture/fixture"
import { writeResponseFile } from "../../src/util/response-file"

fc.configureGlobal({ seed: 42 })

const markdownContent = fc.oneof(
  fc.string(),
  fc.array(
    fc.oneof(
      fc.string().map((s) => `# ${s}\n`),
      fc.string().map((s) => `- ${s}\n`),
      fc.string().map((s) => `\`\`\`\n${s}\n\`\`\`\n`),
      fc.string().map((s) => `${s}\n`)
    )
  ).map((parts) => parts.join(""))
)

test("When saving as Markdown, the saved file preserves the response content exactly, so headings, lists, and code blocks are kept", async () => {
  await fc.assert(
    fc.asyncProperty(markdownContent, async (text) => {
      await using tmp = await tmpdir()
      const filename = "response.md"
      const written = await writeResponseFile({
        directory: tmp.path,
        filename,
        content: text,
        confirmOverwrite: async () => true,
      })
      const saved = await Bun.file(path.join(tmp.path, filename)).text()
      return written === true && saved === text
    }),
    { numRuns: 50 },
  )
})
