import { playStream } from "./audio"

// Microsoft Edge's "Read Aloud" neural voices: free, no API key. The endpoint is undocumented, so these values mirror
// https://github.com/rany2/edge-tts. If Microsoft starts rejecting connections, compare against it and bump them.
const EDGE_URL = "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1"
const EDGE_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4"
const EDGE_CHROMIUM = "143.0.3650.75"
const EDGE_VOICE = "Microsoft Server Speech Text to Speech Voice (en-US, AvaMultilingualNeural)"
// Max escaped text per request, in bytes (the same limit edge-tts uses).
const EDGE_CHUNK_BYTES = 4096
// Seconds between the Windows epoch (1601) and the Unix epoch (1970).
const WINDOWS_EPOCH = 11_644_473_600

/** Reads markdown aloud with Microsoft Edge's neural voice. Resolves once the audio starts playing. */
export async function speak(markdown: string) {
  const text = speakable(markdown)
  if (!text) throw new Error("There is no text to read aloud")
  const stream = await playStream(edgeAudio(text), { format: "mp3" }).catch((error: Error) => {
    // OpenTUI wraps download failures; the cause says what actually went wrong.
    throw error.cause instanceof Error ? error.cause : error
  })
  if (!stream) throw new Error("No audio output device. Run opencode on your computer, not in Docker or over SSH.")
}

/** MP3 for the whole text. Every chunk downloads right away, back to back, so playback never waits between chunks. */
function edgeAudio(text: string) {
  let canceled = false
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const download = async () => {
        for (const chunk of edgeChunks(text)) {
          if (canceled) return
          await synthesize(chunk, (audio) => {
            if (!canceled) controller.enqueue(audio)
          })
        }
        if (!canceled) controller.close()
      }
      download().catch((error: unknown) => controller.error(error))
    },
    cancel() {
      canceled = true
    },
  })
}

// The DOM lib types hide Bun's WebSocket constructor overload that accepts headers.
const BunWebSocket = WebSocket as unknown as new (url: string, init: { headers: Record<string, string> }) => WebSocket

/** Speaks one chunk of text, passing the MP3 audio along as it arrives. */
function synthesize(text: string, onAudio: (audio: Uint8Array) => void) {
  return new Promise<void>((resolve, reject) => {
    const socket = new BunWebSocket(edgeUrl(), { headers: edgeHeaders() })
    socket.binaryType = "arraybuffer"
    socket.onopen = () => {
      socket.send(
        `X-Timestamp:${edgeTimestamp()}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n` +
          `{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}\r\n`,
      )
      socket.send(
        `X-RequestId:${crypto.randomUUID().replaceAll("-", "")}\r\nContent-Type:application/ssml+xml\r\n` +
          // The trailing "Z" is not a typo: Edge itself sends it.
          `X-Timestamp:${edgeTimestamp()}Z\r\nPath:ssml\r\n\r\n${edgeSsml(text)}`,
      )
    }
    socket.onmessage = (event) => {
      if (typeof event.data === "string") {
        // "turn.end" means all audio for this chunk has been sent.
        if (event.data.includes("Path:turn.end")) {
          resolve()
          socket.close()
        }
        return
      }
      // Binary frames: 2-byte big-endian header length, the headers, then the MP3 bytes.
      const data = new Uint8Array(event.data)
      const length = (data[0] << 8) | data[1]
      const audio = data.subarray(2 + length)
      const headers = new TextDecoder().decode(data.subarray(2, 2 + length))
      if (audio.length > 0 && headers.includes("Path:audio")) onAudio(audio)
    }
    // After resolve() these do nothing, so closing the socket ourselves is fine.
    socket.onerror = () => reject(new Error("Couldn't connect to speech.platform.bing.com"))
    socket.onclose = (event) => reject(new Error(`Speech connection closed early (${event.code})`))
  })
}

function edgeUrl() {
  // Sec-MS-GEC proves the client is Edge: SHA-256 of the current 5-minute window in Windows ticks plus the token.
  const seconds = Math.floor(Date.now() / 1000) + WINDOWS_EPOCH
  const ticks = BigInt(seconds - (seconds % 300)) * 10_000_000n
  const gec = new Bun.CryptoHasher("sha256").update(`${ticks}${EDGE_TOKEN}`).digest("hex").toUpperCase()
  const connection = crypto.randomUUID().replaceAll("-", "")
  return `${EDGE_URL}?TrustedClientToken=${EDGE_TOKEN}&ConnectionId=${connection}&Sec-MS-GEC=${gec}&Sec-MS-GEC-Version=1-${EDGE_CHROMIUM}`
}

function edgeHeaders() {
  const major = EDGE_CHROMIUM.split(".")[0]
  const muid = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0"))
  return {
    Pragma: "no-cache",
    "Cache-Control": "no-cache",
    Origin: "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold",
    "User-Agent": `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36 Edg/${major}.0.0.0`,
    "Accept-Encoding": "gzip, deflate, br, zstd",
    "Accept-Language": "en-US,en;q=0.9",
    Cookie: `muid=${muid.join("").toUpperCase()};`,
  }
}

function edgeTimestamp() {
  // e.g. "Mon Sep 21 2026 14:13:20 GMT+0000 (Coordinated Universal Time)", the format Edge sends
  const [weekday, day, month, year, time] = new Date().toUTCString().split(" ")
  return `${weekday.slice(0, 3)} ${month} ${day} ${year} ${time} GMT+0000 (Coordinated Universal Time)`
}

function edgeSsml(text: string) {
  return (
    "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>" +
    `<voice name='${EDGE_VOICE}'><prosody pitch='+0Hz' rate='+0%' volume='+0%'>${escapeXml(text)}</prosody></voice>` +
    "</speak>"
  )
}

/** Splits text into requests at sentence boundaries, keeping each request's escaped text under the byte limit. */
export function edgeChunks(text: string, limit = EDGE_CHUNK_BYTES) {
  const size = (value: string) => Buffer.byteLength(escapeXml(value))
  return (text.match(/[^.!?]+(?:[.!?]+|$)\s*/g) ?? [])
    .flatMap((sentence) => (size(sentence) <= limit ? [sentence] : (sentence.match(/\S{1,400}\s*/g) ?? [])))
    .reduce<string[]>((chunks, piece) => {
      const last = chunks.at(-1)
      if (last === undefined || size(last + piece) > limit) return [...chunks, piece]
      chunks[chunks.length - 1] = last + piece
      return chunks
    }, [])
    .map((chunk) => chunk.trim())
    .filter(Boolean)
}

function escapeXml(text: string) {
  return text.replace(/[&<>"']/g, (char) => `&${XML_ENTITIES[char]};`)
}

const XML_ENTITIES: Record<string, string> = { "&": "amp", "<": "lt", ">": "gt", '"': "quot", "'": "apos" }

/** Turns markdown into text that sounds natural when read aloud. */
export function speakable(markdown: string) {
  return (
    markdown
      // Control characters (other than tab and newlines) that the speech service rejects.
      .replace(/[^\P{Cc}\t\n\r]/gu, " ")
      // Code is unintelligible when read aloud. Also matches a fence that is still streaming.
      .replace(/^[ \t]*(```|~~~)[^\n]*(?:\n[\s\S]*?(?:^[ \t]*\1[ \t]*$|(?![\s\S]))|$)/gm, "\nCode block omitted.\n")
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/<https?:\/\/[^>\s]+>|https?:\/\/[^\s)>\]]+/g, "link")
      .replace(/<\/?[a-z][^>]*>/gi, "")
      .replace(/`+([^`]+)`+/g, "$1")
      .replace(/^[ \t]*(?:[-*_][ \t]*){3,}$/gm, "")
      .replace(/^[ \t]*\|?(?:[ \t]*:?-+:?[ \t]*\|)+[ \t]*(?::?-+:?)?[ \t]*$/gm, "")
      .replace(/^[ \t]*#{1,6}[ \t]+/gm, "")
      .replace(/^[ \t]*>[ \t]?/gm, "")
      .replace(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/gm, "")
      .replace(/(\*\*|__|~~)(.+?)\1/g, "$2")
      .replace(/(^|[^\w*])[*_]([^*_\s](?:[^*_\n]*[^*_\s])?)[*_](?![\w*])/g, "$1$2")
      .replace(/\p{Extended_Pictographic}\uFE0F?/gu, "")
      .split("\n")
      // Table rows become comma separated cells.
      .map((line) =>
        line.trim().startsWith("|")
          ? line
              .split("|")
              .map((cell) => cell.trim())
              .filter(Boolean)
              .join(", ")
          : line.trim(),
      )
      .filter(Boolean)
      // End every line with punctuation so list items and headings get a pause instead of running together.
      .map((line) => (/[.!?:;,]$/.test(line) ? line : `${line}.`))
      .join(" ")
  )
}