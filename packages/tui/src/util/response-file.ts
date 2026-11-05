import path from "path"

// Returns false when the user declines to overwrite an existing file; nothing is written in that case.
export async function writeResponseFile(input: {
  directory: string
  filename: string
  content: string
  confirmOverwrite: () => Promise<boolean | undefined>
  // When provided, a timestamp header is prepended to the saved content.
  // Passed in (not generated here) so the output is deterministic and testable.
  timestamp?: Date
}) {
  const filepath = path.resolve(input.directory, input.filename)
  if ((await Bun.file(filepath).exists()) && !(await input.confirmOverwrite())) return false
  const body =
    input.timestamp === undefined
      ? input.content
      : `<!-- Saved ${input.timestamp.toISOString()} -->\n\n${input.content}`
  await Bun.write(filepath, body)
  return true
}
