import { describe, expect, test } from "bun:test"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { writeResponseFile } from "../../src/util/response-file"

describe("writeResponseFile", () => {
  test("writes a new file without asking to overwrite", async () => {
    await using tmp = await tmpdir()
    const asked: string[] = []
    const written = await writeResponseFile({
      directory: tmp.path,
      filename: "answer.md",
      content: "## Assistant\n\nHello\n",
      confirmOverwrite: async () => {
        asked.push("answer.md")
        return true
      },
    })
    expect(written).toBe(true)
    expect(asked).toEqual([])
    expect(await Bun.file(path.join(tmp.path, "answer.md")).text()).toBe("## Assistant\n\nHello\n")
  })

  test("creates missing parent directories for nested paths", async () => {
    await using tmp = await tmpdir()
    const written = await writeResponseFile({
      directory: tmp.path,
      filename: "notes/today/answer.txt",
      content: "Hello\n",
      confirmOverwrite: async () => true,
    })
    expect(written).toBe(true)
    expect(await Bun.file(path.join(tmp.path, "notes", "today", "answer.txt")).text()).toBe("Hello\n")
  })

  test("keeps an existing file when overwrite is declined", async () => {
    await using tmp = await tmpdir()
    const filepath = path.join(tmp.path, "answer.md")
    await Bun.write(filepath, "original\n")
    let asked = 0
    const written = await writeResponseFile({
      directory: tmp.path,
      filename: "answer.md",
      content: "replacement\n",
      confirmOverwrite: async () => {
        asked++
        return false
      },
    })
    expect(written).toBe(false)
    expect(asked).toBe(1)
    expect(await Bun.file(filepath).text()).toBe("original\n")
  })

  test("keeps an existing file when the overwrite prompt is dismissed", async () => {
    await using tmp = await tmpdir()
    const filepath = path.join(tmp.path, "answer.md")
    await Bun.write(filepath, "original\n")
    const written = await writeResponseFile({
      directory: tmp.path,
      filename: "answer.md",
      content: "replacement\n",
      confirmOverwrite: async () => undefined,
    })
    expect(written).toBe(false)
    expect(await Bun.file(filepath).text()).toBe("original\n")
  })

  test("replaces an existing file when overwrite is confirmed", async () => {
    await using tmp = await tmpdir()
    const filepath = path.join(tmp.path, "answer.txt")
    await Bun.write(filepath, "original\n")
    const written = await writeResponseFile({
      directory: tmp.path,
      filename: "answer.txt",
      content: "replacement\n",
      confirmOverwrite: async () => true,
    })
    expect(written).toBe(true)
    expect(await Bun.file(filepath).text()).toBe("replacement\n")
  })

  test("writes absolute paths as given instead of joining them to the directory", async () => {
    await using tmp = await tmpdir()
    await using other = await tmpdir()
    const filepath = path.join(other.path, "answer.md")
    const written = await writeResponseFile({
      directory: tmp.path,
      filename: filepath,
      content: "Hello\n",
      confirmOverwrite: async () => true,
    })
    expect(written).toBe(true)
    expect(await Bun.file(filepath).text()).toBe("Hello\n")
  })
})
