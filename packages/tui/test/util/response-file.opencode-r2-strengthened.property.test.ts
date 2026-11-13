import { test } from "bun:test"
import path from "path"
import fc from "fast-check"
import { tmpdir } from "../fixture/fixture"
import { writeResponseFile } from "../../src/util/response-file"

fc.configureGlobal({ seed: 42 })

// Strengthened version of the property opencode wrote in response-file.opencode-r2.property.test.ts.
// Same assertion; only the generator changed. opencode's generator used fc.string(), which only
// produces printable ASCII, so it never produced \r and could not notice a save that rewrites line
// endings (mutant H4). Here the strings are drawn from an alphabet that includes \r and \n.
const lineEndingText = fc.string({ unit: fc.constantFrom("a", " ", "#", "-", "`", "\n", "\r") })

const markdownContent = fc.oneof(
  fc.string(),
  lineEndingText,
  fc
    .array(
      fc.oneof(
        fc.string().map((s) => `# ${s}\n`),
        fc.string().map((s) => `- ${s}\n`),
        fc.string().map((s) => `\`\`\`\n${s}\n\`\`\`\n`),
        fc.string().map((s) => `${s}\n`),
      ),
    )
    .map((parts) => parts.join("")),
)

test("R2 (strengthened): the saved file preserves the response content exactly, including line endings", async () => {
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
