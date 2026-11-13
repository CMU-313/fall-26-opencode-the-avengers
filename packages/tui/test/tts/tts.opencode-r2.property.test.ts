import { describe, expect, test } from "bun:test"
import fc from "fast-check"
import { speakable } from "../../src/speech"

describe("speakable() property tests", () => {
  test("keeps the response's words in order", () => {
    const wordArb = fc.stringMatching(/^[a-zA-Z0-9]{3,10}$/)

    fc.assert(
      fc.property(
        fc.array(wordArb, { minLength: 2, maxLength: 6 }).map((words) => Array.from(new Set(words))),
        (uniqueWords) => {
          if (uniqueWords.length < 2) return

          const markdownParts = uniqueWords.map((word, index) => {
            switch (index % 4) {
              case 0:
                return word
              case 1:
                return `[${word}](https://example.com/link)`
              case 2:
                return `![${word}](https://example.com/img.png)`
              case 3:
                return `\`${word}\``
            }
          })

          const markdown = markdownParts.join(" ")
          const output = speakable(markdown)

          let lastIndex = -1
          for (const word of uniqueWords) {
            const currentIndex = output.indexOf(word, lastIndex + 1)
            expect(currentIndex).toBeGreaterThan(lastIndex)
            lastIndex = currentIndex
          }
        },
      ),
    )
  })

  test("replaces links and images with their labels", () => {
    const labelArb = fc.stringMatching(/^[a-zA-Z0-9]{2,15}$/)
    const urlArb = fc.webUrl().filter((url) => !url.includes(")") && !url.includes(">"))

    fc.assert(
      fc.property(labelArb, urlArb, (label, url) => {
        const markdownImage = `![${label}](${url})`
        const outputImage = speakable(markdownImage)
        expect(outputImage).toBe(`${label}.`)
        expect(outputImage).not.toContain("![")
        expect(outputImage).not.toContain(url)

        const markdownLink = `[${label}](${url})`
        const outputLink = speakable(markdownLink)
        expect(outputLink).toBe(`${label}.`)
        expect(outputLink).not.toContain("[")
        expect(outputLink).not.toContain(url)
      }),
    )
  })

  test("replaces bare URLs with 'link'", () => {
    const urlArb = fc.webUrl().filter((url) => !url.includes(">"))

    fc.assert(
      fc.property(urlArb, (url) => {
        const markdown = `Check ${url} for info`
        const output = speakable(markdown)
        expect(output).toContain("link")
        expect(output).not.toContain(url)

        const markdownAngle = `<${url}>`
        const outputAngle = speakable(markdownAngle)
        expect(outputAngle).toBe("link.")
        expect(outputAngle).not.toContain(url)
      }),
    )
  })

  test("replaces code blocks with 'Code block omitted'", () => {
    const codeContentArb = fc.string().filter((s) => !s.includes("```") && !s.includes("~~~"))
    const langArb = fc.stringMatching(/^[a-z]{0,8}$/)
    const fenceArb = fc.constantFrom("```", "~~~")

    fc.assert(
      fc.property(fenceArb, langArb, codeContentArb, (fence, lang, code) => {
        const markdown = `${fence}${lang}\n${code}\n${fence}`
        const output = speakable(markdown)
        expect(output).toBe("Code block omitted.")
      }),
    )

    fc.assert(
      fc.property(langArb, codeContentArb, (lang, code) => {
        const markdown = `\`\`\`${lang}\n${code}`
        const output = speakable(markdown)
        expect(output).toBe("Code block omitted.")
      }),
    )
  })

  test("removes markdown formatting, HTML tags, and emoji", () => {
    const wordArb = fc.stringMatching(/^[a-zA-Z0-9]{2,10}$/)
    const emojiArb = fc.constantFrom("😀", "🚀", "✨", "🔥", "❤️", "🤖", "🎉", "👍")

    fc.assert(
      fc.property(wordArb, emojiArb, (word, emoji) => {
        const formatted = `# Header ${word} ${emoji}\n> **bold** *italic* ~~strike~~ <div><span class="test">${word}</span></div>`
        const output = speakable(formatted)

        expect(output).not.toContain("**")
        expect(output).not.toContain("~~")
        expect(output).not.toContain("<div>")
        expect(output).not.toContain("</span>")
        expect(output).not.toContain("# Header")
        expect(output).not.toContain(">")

        expect(output).not.toContain(emoji)
        expect(/\p{Extended_Pictographic}/u.test(output)).toBe(false)

        expect(output).toContain(word)
      }),
    )
  })

  test("ensures each line ends with punctuation", () => {
    const lineContentArb = fc.stringMatching(/^[a-zA-Z0-9 ]{1,20}$/)

    fc.assert(
      fc.property(fc.array(lineContentArb, { minLength: 1, maxLength: 5 }), (lines) => {
        const markdown = lines.join("\n")
        const output = speakable(markdown)

        if (output) {
          expect(/[.!?:;,]$/.test(output)).toBe(true)

          for (const line of lines) {
            if (line.trim()) {
              const lineOutput = speakable(line)
              expect(/[.!?:;,]$/.test(lineOutput)).toBe(true)
            }
          }
        }
      }),
    )
  })

  test("preserves inline code as written", () => {
    const inlineCodeArb = fc.stringMatching(/^[a-zA-Z0-9_*~#-]{1,20}$/)

    fc.assert(
      fc.property(inlineCodeArb, (codeStr) => {
        const markdown = `Call \`${codeStr}\` function`
        const output = speakable(markdown)
        expect(output).toContain(codeStr)
      }),
    )
  })
})
