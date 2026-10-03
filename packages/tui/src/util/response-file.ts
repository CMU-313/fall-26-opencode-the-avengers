import path from "path"

// Returns false when the user declines to overwrite an existing file; nothing is written in that case.
export async function writeResponseFile(input: {
  directory: string
  filename: string
  content: string
  confirmOverwrite: () => Promise<boolean | undefined>
}) {
  const filepath = path.resolve(input.directory, input.filename)
  if ((await Bun.file(filepath).exists()) && !(await input.confirmOverwrite())) return false
  await Bun.write(filepath, input.content)
  return true
}
