import { expect, test } from "bun:test"
import { array, assert, integer, property, string } from "fast-check"
import {
  formatTranscript,
  getCopyCommandState,
  getCopyWarning,
  getMessagesBeforeRevert,
  type MessageWithParts,
} from "../../src/util/transcript"

const session = {
  id: "ses_property",
  title: "Property test",
  time: { created: 1, updated: 2 },
}

const options = { thinking: false, toolDetails: false, assistantMetadata: false }

function makeMessages(texts: string[]): MessageWithParts[] {
  return texts.map((text, index) => ({
    info: {
      id: `msg_${index}`,
      sessionID: session.id,
      role: "user",
      agent: "build",
      model: { providerID: "anthropic", modelID: "claude" },
      time: { created: index },
    },
    parts: [
      {
        id: `part_${index}`,
        sessionID: session.id,
        messageID: `msg_${index}`,
        type: "text",
        text,
      },
    ],
  }))
}

test("R2: over-limit copy includes every available message and warns with the copied count", () => {
  // R2: If x exceeds available messages, copy all available messages and warn with the actual count. 
  // Kind: Invariant
  const histories = array(string({ maxLength: 30 }), { minLength: 1, maxLength: 12 })
  const overages = integer({ min: 1, max: 12 })

  assert(
    property(histories, overages, (texts, overage) => {
      const contents = texts.map((text, index) => `message_${index}:${text}`)
      const messages = makeMessages(contents)
      const requestedCount = messages.length + overage
      const transcript = formatTranscript(session, messages, options, requestedCount)

      expect(getCopyWarning(requestedCount, messages.length)).toBe(
        `Only ${messages.length} message${messages.length === 1 ? "" : "s"} copied.`,
      )
      contents.forEach((text) => expect(transcript).toContain(text))
    }),
    { numRuns: 100 },
  )
})

test("R3: adding then reverting a message restores the original copied transcript", () => {
  // R3: Previously deleted messages are excluded from copied output. 
  // Kind: Round-trip
  const histories = array(string({ maxLength: 30 }), { minLength: 1, maxLength: 20 })

  assert(
    property(histories, string({ maxLength: 30 }), (texts, deletedText) => {
      const history = makeMessages(texts.map((text, index) => `message_${index}:${text}`))
      const beforeDelete = formatTranscript(session, history, options)
      const withDeletedMessage = makeMessages([
        ...texts.map((text, index) => `message_${index}:${text}`),
        `deleted:${deletedText}`,
      ])
      const withoutRevertedMessages = getMessagesBeforeRevert(
        withDeletedMessage.map((message) => message.info),
        `msg_${texts.length}`,
      )
      const afterRevert = formatTranscript(
        session,
        withDeletedMessage.filter((message) =>
          withoutRevertedMessages.some((info) => info.id === message.info.id),
        ),
        options,
      )

      expect(formatTranscript(session, withDeletedMessage, options)).not.toBe(beforeDelete)
      expect(afterRevert).toBe(beforeDelete)
    }),
    { numRuns: 100 },
  )
})

test("R4: changing any positive count to zero makes /copy invalid", () => {
  // R4: An invalid count such as zero blocks copying. 
  // Kind: Metamorphic
  assert(
    property(integer({ min: 1, max: Number.MAX_SAFE_INTEGER }), (count) => {
      expect(getCopyCommandState(`/copy ${count}`, 1)).toEqual({ kind: "copy", count })
      expect(getCopyCommandState(`/copy ${count - count}`, 1)).toEqual({ kind: "invalid" })
    }),
    { numRuns: 100 },
  )
})

test("R5: formatted transcripts agree with chronological message order", () => {
  // R5: Multiple messages remain in oldest-to-newest order. 
  // Kind: Oracle
  assert(
    property(array(integer({ min: 0, max: 100 }), { minLength: 1, maxLength: 20 }), (timestamps) => {
      const messages = timestamps.map((created, index) => ({
        info: {
          id: `msg_${String(index).padStart(2, "0")}`,
          sessionID: session.id,
          role: "user" as const,
          agent: "build",
          model: { providerID: "anthropic", modelID: "claude" },
          time: { created },
        },
        parts: [
          {
            id: `part_${index}`,
            sessionID: session.id,
            messageID: `msg_${index}`,
            type: "text" as const,
            text: `|message_${index}|`,
          },
        ],
      }))
      const expected = messages
        .toSorted((a, b) => a.info.time.created - b.info.time.created || a.info.id.localeCompare(b.info.id))
        .map((message) => message.parts[0].text)
      const transcript = formatTranscript(session, messages, options)
      const positions = expected.map((text) => transcript.indexOf(text))

      expect(positions.every((position) => position >= 0)).toBe(true)
      expect(positions).toEqual(positions.toSorted((a, b) => a - b))
    }),
    { numRuns: 100 },
  )
})
