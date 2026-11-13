import { describe, expect, test } from "bun:test"
import fc from "fast-check"
import { speakable } from "../../src/speech"

// Strengthened version of the property opencode wrote in tts.opencode-r2.property.test.ts
// ("removes markdown formatting, HTML tags, and emoji"). The assertions are opencode's, unchanged. Only the HTML part
// of the input changed. opencode hard-coded one lower-case snippet (<div><span class="test">…</span></div>), so the
// tags were never generated and never upper-case, and a cleaner that only removes lower-case tags (mutant H2) passed.
// Here the tag names are generated and each letter is randomly upper- or lower-case, the way HTML allows.
const tagName = fc.mixedCase(fc.constantFrom("div", "span", "b", "em", "p", "details"))

describe("speakable() property tests (strengthened)", () => {
  test("R2 (strengthened): removes markdown formatting, HTML tags in any letter case, and emoji", () => {
    const wordArb = fc.stringMatching(/^[a-zA-Z0-9]{2,10}$/)
    const emojiArb = fc.constantFrom("😀", "🚀", "✨", "🔥", "❤️", "🤖", "🎉", "👍")

    fc.assert(
      fc.property(wordArb, emojiArb, tagName, tagName, (word, emoji, outer, inner) => {
        const formatted = `# Header ${word} ${emoji}\n> **bold** *italic* ~~strike~~ <${outer}><${inner} class="test">${word}</${inner}></${outer}>`
        const output = speakable(formatted)

        expect(output).not.toContain("**")
        expect(output).not.toContain("~~")
        expect(output).not.toContain(`<${outer}>`)
        expect(output).not.toContain(`</${inner}>`)
        expect(output).not.toContain("# Header")
        expect(output).not.toContain(">")

        expect(output).not.toContain(emoji)
        expect(/\p{Extended_Pictographic}/u.test(output)).toBe(false)

        expect(output).toContain(word)
      }),
      { seed: 42 },
    )
  })
})
