// Property-based tests for the text-to-speech feature: /speech reads the latest assistant reply aloud.
//   Code under test: packages/tui/src/speech.ts (speakable, edgeChunks) and the /speech command in
//   packages/tui/src/routes/session/index.tsx.
//   Requirements and traceability: traceability/williey.md (R1–R5).
// Run from packages/tui:  bun test test/tts/tts.property.test.ts
import { describe, expect, mock, test } from "bun:test"
import fc from "fast-check"
import ts from "typescript"
import { edgeChunks, speakable } from "../../src/speech"

// ---------------------------------------------------------------------------------------------------------------
// Shared generators
// ---------------------------------------------------------------------------------------------------------------

// Prose words. Some come from a pool of words a coding assistant really writes (so counterexamples shrink to readable
// replies), the rest are random letters/digits so the tests aren't tied to that pool. Plain numbers are included on
// purpose: "42." or "3)" at the start of a line looks like a numbered-list marker to a markdown cleaner.
const proseWord = fc.oneof(
  fc.constantFrom("the", "fix", "parser", "tests", "run", "file", "error", "build", "config", "server", "then", "and"),
  fc.stringMatching(/^[A-Za-z][a-z0-9]{0,9}$/),
  fc.integer({ min: 0, max: 2048 }).map(String),
)
const label = fc.array(proseWord, { minLength: 1, maxLength: 3 }).map((words) => words.join(" "))
const url = fc
  .tuple(
    fc.constantFrom("https", "http"),
    fc.constantFrom("example.com", "opencode.ai", "github.com/sst/opencode", "localhost:3000"),
    fc.array(fc.stringMatching(/^[a-z0-9_-]{1,8}$/), { maxLength: 3 }),
    fc.constantFrom("", "?q=1", "#install"),
  )
  .map(([scheme, host, path, rest]) => `${scheme}://${host}${path.map((part) => `/${part}`).join("")}${rest}`)

// ---------------------------------------------------------------------------------------------------------------
// R1
// ---------------------------------------------------------------------------------------------------------------

// Size of one request the way Microsoft counts it: UTF-8 bytes after XML-escaping & < > " '. Written separately from
// speech.ts so the test doesn't rely on the code's own escaping.
const XML: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }
const requestBytes = (text: string) => Buffer.byteLength(text.replace(/[&<>"']/g, (char) => XML[char]))

// edgeChunks() receives speakable() output: plain sentences. Its tokens mix ordinary words with what stresses the
// splitter: XML-special characters (& and " grow to 5–6 bytes after escaping, and the 4,096-byte limit is counted
// after escaping), multi-byte UTF-8 (2–4 bytes a character), and tokens that contain or start with sentence
// punctuation (".env", "3.14", "Node.js", "..."), since . ! and ? are where the splitter cuts.
const chunkToken = fc.oneof(
  { weight: 6, arbitrary: proseWord },
  { weight: 1, arbitrary: fc.stringMatching(/^[a-z&<>"']{1,6}$/) },
  { weight: 1, arbitrary: fc.constantFrom("café", "naïve", "你好", "日本語", "Ελληνικά", "𝑥²", "Ünïcödé") },
  {
    weight: 1,
    arbitrary: fc.constantFrom(".env", "3.14", "e.g.", "Node.js", "v1.2.3", "...", "?!", "U.S.", ".gitignore"),
  },
)
const sentence = fc
  .tuple(fc.array(chunkToken, { minLength: 1, maxLength: 30 }), fc.constantFrom(".", "!", "?", "...", "?!", ":", ""))
  .map(([words, end]) => words.join(" ") + end)
// A sentence that stops just short of the 4,096-byte limit, so the next request boundary lands right beside the
// tokens that follow — sometimes inside one with a dot ("Node.js", "3.14"), which a splitter that cuts at every "."
// would break in two.
const nearLimit = fc
  .integer({ min: 3900, max: 4096 })
  .map((bytes) => `${"word ".repeat(Math.floor(bytes / 5) - 1)}word.`)
// A run-on sentence with no . ! or ? that is bigger than one request by itself (4–6 KB), so the splitter has to fall
// back to cutting between words.
const runOn = fc
  .array(fc.constantFrom("the", "parser", "reads", "&", '"quoted"', "naïve", "日本語", "configuration"), {
    minLength: 650,
    maxLength: 900,
  })
  .map((words) => words.join(" "))
// One unbroken token over 400 characters (a hash or base64 blob). The splitter may cut it, but must not lose any of it.
const blob = fc.stringMatching(/^[A-Za-z0-9+/=]{401,900}$/)
// Replies from empty up to ~20 KB: mostly normal sentences, sometimes a near-limit sentence, a run-on sentence or a
// blob, so the text regularly crosses the 4,096-byte boundary (the P3 example was a 2,000-word, ~10.9 KB reply).
const replyText = fc
  .array(
    fc.oneof(
      { weight: 16, arbitrary: sentence },
      { weight: 2, arbitrary: nearLimit },
      { weight: 1, arbitrary: runOn },
      { weight: 1, arbitrary: blob },
    ),
    { maxLength: 40 },
  )
  .map((parts) => parts.join(" "))

describe("R1: the whole reply is sent, in order, in requests the speech service accepts", () => {
  // R1 (revised in P4): Read-aloud should read the whole reply in order. The text is split into requests that are each
  // 4,096 bytes or less, and joining them back together should give the same text, so no words get skipped, repeated,
  // added, or cut in half (unless one "word" is over 400 characters, like a long hash). It only stops early if the user
  // stops it or the speech service fails.
  // Kind: round-trip (split the text into requests, join them back, get the original text) + invariant (request size).
  test("R1: splitting a reply into requests and joining them back gives the original text", () => {
    fc.assert(
      fc.property(replyText, (text) => {
        const requests = edgeChunks(text)
        for (const request of requests) {
          expect(requestBytes(request)).toBeLessThanOrEqual(4096)
          expect(request.length).toBeGreaterThan(0)
          expect(request).toBe(request.trim())
        }
        // Character level: nothing dropped, repeated or reordered (only whitespace may change at the cuts).
        expect(requests.join("").replace(/\s+/g, "")).toBe(text.replace(/\s+/g, ""))
        // Word level: requests only break between words, unless one token is longer than 400 characters.
        const words = text.split(/\s+/).filter(Boolean)
        if (words.every((word) => word.length <= 400))
          expect(requests.join(" ").split(/\s+/).filter(Boolean)).toEqual(words)
      }),
      { numRuns: 100 },
    )
  })
})

// ---------------------------------------------------------------------------------------------------------------
// R2
// ---------------------------------------------------------------------------------------------------------------

// Each generated token is a piece of markdown together with what the voice should get for it.
type Token = { markdown: string; spoken: string }
const word: fc.Arbitrary<Token> = proseWord.map((text) => ({ markdown: text, spoken: text }))
const link: fc.Arbitrary<Token> = fc
  .tuple(label, url)
  .map(([text, href]) => ({ markdown: `[${text}](${href})`, spoken: text }))
const image: fc.Arbitrary<Token> = fc
  .tuple(label, url)
  .map(([text, href]) => ({ markdown: `![${text}](${href})`, spoken: text }))
const bareUrl: fc.Arbitrary<Token> = url.map((href) => ({ markdown: href, spoken: "link" }))
const autolink: fc.Arbitrary<Token> = url.map((href) => ({ markdown: `<${href}>`, spoken: "link" }))
// Inline code the way a coding assistant writes it. Underscores and asterisks are normal inside code (Python's
// __init__ and **kwargs, snake_case, C's *ptr), which is exactly where a markdown cleaner can mistake them for bold or
// italics.
const identifier = fc.oneof(
  fc.constantFrom("__init__", "__name__", "__dirname", "*args", "**kwargs", "_private", "snake_case", "MAX_RETRIES"),
  fc.constantFrom("--force", "a.b()", "x*y", "*ptr", "use_state"),
  fc.stringMatching(/^[a-z_][a-z0-9_]{0,10}$/),
)
const inlineCode: fc.Arbitrary<Token> = identifier.map((code) => ({ markdown: `\`${code}\``, spoken: code }))
const token = fc.oneof(
  { weight: 6, arbitrary: word },
  { weight: 1, arbitrary: link },
  { weight: 1, arbitrary: image },
  { weight: 1, arbitrary: bareUrl },
  { weight: 1, arbitrary: autolink },
  { weight: 2, arbitrary: inlineCode },
)
// 1–4 lines of 1–10 tokens: prose words mixed with the substitutions that change words (links, images, bare URLs,
// <autolinks>) and inline code, which must not change. Code blocks, emoji and markup symbols are covered by R4.
const replyLines = fc.array(fc.array(token, { minLength: 1, maxLength: 10 }), { minLength: 1, maxLength: 4 })

describe("R2: every word is read, with only the listed substitutions", () => {
  // R2 (revised in P4): The text sent to the voice should keep every word of the reply in the same order. The only
  // changes allowed are: links and images are read as their label, bare URLs are read as "link", code blocks become
  // "Code block omitted.", markdown, HTML tags and emoji get removed, and each line ends with punctuation. Inline code
  // is read as it is, and there is no autocorrect.
  // Kind: model / oracle. Every generated token carries the words it should produce, so the oracle is just
  // "join the expected words of each line and end the line with a period", which is obviously right.
  test("R2: the voice gets every word in order, with only the listed substitutions", () => {
    fc.assert(
      fc.property(replyLines, (lines) => {
        const markdown = lines.map((line) => line.map((piece) => piece.markdown).join(" ")).join("\n")
        const expected = lines.map((line) => `${line.map((piece) => piece.spoken).join(" ")}.`).join(" ")
        expect(speakable(markdown)).toBe(expected)
      }),
      { numRuns: 300 },
    )
  })
})

// ---------------------------------------------------------------------------------------------------------------
// R3
// ---------------------------------------------------------------------------------------------------------------

// A reply is generated once, with a formatting choice attached to every word, gap and line break, so the same reply
// can be printed plain and formatted. Formatting covers what R3 lists: bold and italics (both markers, nested one level
// as assistants do), 2–3 spaces or tabs between words, trailing spaces, and 1–3 extra blank lines between lines.
const wrappers: ((text: string) => string)[] = [
  (text) => `**${text}**`,
  (text) => `__${text}__`,
  (text) => `*${text}*`,
  (text) => `_${text}_`,
  (text) => `***${text}***`,
  (text) => `**_${text}_**`,
  (text) => `_**${text}**_`,
  (text) => `*__${text}__*`,
]
const styledWord = fc.record({
  text: proseWord,
  wrap: fc.option(fc.integer({ min: 0, max: wrappers.length - 1 }), { nil: undefined }),
  gap: fc.constantFrom(" ", " ", "  ", "   ", "\t", " \t "),
})
const styledLine = fc.record({
  words: fc.array(styledWord, { minLength: 1, maxLength: 8 }),
  end: fc.constantFrom("", ".", "!", "?", ":"),
  trailing: fc.constantFrom("", "", " ", "  ", "\t"),
  blankLines: fc.integer({ min: 0, max: 3 }),
})
const styledReply = fc.array(styledLine, { minLength: 1, maxLength: 5 })
type StyledLine = typeof styledLine extends fc.Arbitrary<infer T> ? T : never

const plain = (reply: StyledLine[]) =>
  reply.map((line) => line.words.map((piece) => piece.text).join(" ") + line.end).join("\n")
const formatted = (reply: StyledLine[]) =>
  reply
    .map((line, index) => {
      const words = line.words
        .map(
          (piece, at) =>
            (at ? piece.gap : "") + (piece.wrap === undefined ? piece.text : wrappers[piece.wrap](piece.text)),
        )
        .join("")
      return (index ? "\n".repeat(line.blankLines + 1) : "") + words + line.end + line.trailing
    })
    .join("")

describe("R3: formatting never changes what is spoken", () => {
  // R3: Changing only formatting (bold, italics, extra spaces, or extra blank lines) never changes what is spoken.
  // Each line break is at most one pause.
  // Kind: metamorphic. Re-formatting a reply (the known change to the input) must leave speakable() exactly the same,
  // and a line break must never produce two pauses in a row.
  test("R3: re-formatting a reply leaves the spoken text unchanged", () => {
    fc.assert(
      fc.property(styledReply, (reply) => {
        const spoken = speakable(plain(reply))
        expect(speakable(formatted(reply))).toBe(spoken)
        expect(spoken).not.toMatch(/[.!?:;,] *[.!?:;,]/)
      }),
      { numRuns: 300 },
    )
  })
})

// ---------------------------------------------------------------------------------------------------------------
// R4
// ---------------------------------------------------------------------------------------------------------------

// Whole replies built from the markdown an assistant emits. Words are letters and digits only, so any other symbol in
// speakable() output (besides sentence punctuation) can only have come from markup the cleaner missed.
const punctuatedWord = fc
  .tuple(proseWord, fc.constantFrom("", "", "", ".", ",", "!", "?", ":", ";"))
  .map(([w, p]) => w + p)
const wrap = (marker: string, text: string) => `${marker}${text}${marker}`
// Things emphasis can wrap. Bare URLs are left out of emphasis on purpose: whether "*https://x.y*" ends in "*" is
// ambiguous markdown, and assistants put URLs in links instead.
const leaf = fc.oneof(
  { weight: 5, arbitrary: punctuatedWord },
  { weight: 1, arbitrary: proseWord.map((w) => `\`${w}\``) },
  { weight: 1, arbitrary: fc.tuple(label, url).map(([text, href]) => `[${text}](${href})`) },
  { weight: 1, arbitrary: fc.tuple(label, url).map(([text, href]) => `![${text}](${href})`) },
  { weight: 1, arbitrary: url.map((href) => `<${href}>`) },
)
const run = <T extends string>(arbitrary: fc.Arbitrary<T>, max: number) =>
  fc.array(arbitrary, { minLength: 1, maxLength: max }).map((items) => items.join(" "))
const strong = fc.constantFrom("**", "__", "~~")
const soft = fc.constantFrom("*", "_")
// Emphasis nests one level with a different marker inside, e.g. **a *b* c**, _a **b** c_, ~~a **b** c~~.
const emphasis = fc.oneof(
  fc.tuple(strong, run(leaf, 3)).map(([m, text]) => wrap(m, text)),
  fc.tuple(soft, run(leaf, 3)).map(([m, text]) => wrap(m, text)),
  fc
    .tuple(
      strong,
      run(
        fc.oneof(
          leaf,
          fc.tuple(soft, run(leaf, 2)).map(([m, t]) => wrap(m, t)),
        ),
        4,
      ),
    )
    .map(([m, text]) => wrap(m, text)),
  fc
    .tuple(
      soft,
      run(
        fc.oneof(
          leaf,
          fc.tuple(strong, run(leaf, 2)).map(([m, t]) => wrap(m, t)),
        ),
        4,
      ),
    )
    .map(([m, text]) => wrap(m, text)),
  fc
    .tuple(
      fc.constantFrom("**", "__"),
      run(
        fc.oneof(
          leaf,
          run(leaf, 2).map((t) => wrap("~~", t)),
        ),
        4,
      ),
    )
    .map(([m, text]) => wrap(m, text)),
)
const inline = run(
  fc.oneof({ weight: 4, arbitrary: leaf }, { weight: 1, arbitrary: url }, { weight: 2, arbitrary: emphasis }),
  8,
)
const tableCell = run(fc.oneof({ weight: 3, arbitrary: punctuatedWord }, { weight: 1, arbitrary: emphasis }), 3)

const heading = fc.tuple(fc.integer({ min: 1, max: 6 }), inline).map(([level, text]) => `${"#".repeat(level)} ${text}`)
const bullet = fc
  .tuple(
    fc.constantFrom("", "  ", "    "),
    fc.constantFrom("-", "*", "+"),
    fc.constantFrom("", "", "[ ] ", "[x] ", "[X] "),
    inline,
  )
  .map(([indent, marker, box, text]) => `${indent}${marker} ${box}${text}`)
const numbered = fc
  .tuple(fc.constantFrom("", "   "), fc.integer({ min: 1, max: 99 }), fc.constantFrom(".", ")"), inline)
  .map(([indent, n, dot, text]) => `${indent}${n}${dot} ${text}`)
const list = fc.array(fc.oneof(bullet, numbered), { minLength: 1, maxLength: 4 }).map((items) => items.join("\n"))
const rule = fc.constantFrom("---", "***", "___", "- - -", "* * *")
// Code blocks are full of markdown symbols; all of it must disappear. (Body lines have no ` or ~, so they can't
// accidentally close the fence.)
const fence = fc
  .tuple(
    fc.constantFrom("```", "~~~"),
    fc.constantFrom("", "ts", "bash", "md"),
    fc.array(fc.stringMatching(/^[ -_a-}]{0,30}$/), { maxLength: 4 }),
  )
  .map(([marker, lang, body]) => [marker + lang, ...body, marker].join("\n"))
const table = fc
  .integer({ min: 1, max: 4 })
  .chain((columns) =>
    fc.tuple(
      fc.array(tableCell, { minLength: columns, maxLength: columns }),
      fc.array(fc.constantFrom("---", ":---", "---:", ":---:"), { minLength: columns, maxLength: columns }),
      fc.array(fc.array(tableCell, { minLength: columns, maxLength: columns }), { minLength: 1, maxLength: 3 }),
    ),
  )
  .map(([head, align, rows]) => [head, align, ...rows].map((cells) => `| ${cells.join(" | ")} |`).join("\n"))
const baseBlock = fc.oneof({ weight: 3, arbitrary: inline }, heading, list, rule, fence, table)
// Blockquotes can hold any block, including another blockquote.
const quote = (block: string) =>
  block
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n")
const block = fc.oneof(
  { weight: 6, arbitrary: baseBlock },
  { weight: 2, arbitrary: baseBlock.map(quote) },
  { weight: 1, arbitrary: baseBlock.map((b) => quote(quote(b))) },
)
const markdownReply = fc.array(block, { minLength: 1, maxLength: 8 }).map((blocks) => blocks.join("\n\n"))

describe("R4: no markdown symbol reaches the voice", () => {
  // R4 (revised in P4): The text sent to the voice should never have markdown symbols in it (#, list bullets, *, _,
  // ~~, backticks, > or |) unless they're inside inline code. Normal punctuation like . , ! ? : ; stays so the voice
  // pauses on it instead of saying it.
  // Kind: invariant. For any markdown reply, speakable() is only words, spaces and sentence punctuation.
  test("R4: speakable output is only words, spaces and sentence punctuation", () => {
    fc.assert(
      fc.property(markdownReply, (markdown) => {
        expect(speakable(markdown)).toMatch(/^[A-Za-z0-9 .,!?:;]*$/)
      }),
      { numRuns: 300 },
    )
  })
})

// ---------------------------------------------------------------------------------------------------------------
// R5
// ---------------------------------------------------------------------------------------------------------------

// Run the real /speech command without mounting the TUI: pull the command and the selectors it uses (session, the
// route-bound message list, and the revert filter) out of the Session component's source, the same technique
// test/tts.ts uses, and evaluate them against an in-memory store.
const sessionFile = ts.createSourceFile(
  "index.tsx",
  await Bun.file(new URL("../../src/routes/session/index.tsx", import.meta.url)).text(),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
)
const sessionComponent = sessionFile.statements.find(
  (statement): statement is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(statement) && statement.name?.text === "Session",
)
const declarations = new Map<string, string>()
for (const statement of sessionComponent?.body?.statements ?? []) {
  if (!ts.isVariableStatement(statement)) continue
  for (const declaration of statement.declarationList.declarations)
    if (declaration.initializer)
      declarations.set(declaration.name.getText(sessionFile), declaration.initializer.getText(sessionFile))
}
let speechCommandSource = ""
const findSpeechCommand = (node: ts.Node) => {
  if (
    ts.isObjectLiteralExpression(node) &&
    node.properties.some(
      (property) =>
        ts.isPropertyAssignment(property) &&
        property.name.getText(sessionFile) === "value" &&
        ts.isStringLiteral(property.initializer) &&
        property.initializer.text === "session.speech",
    )
  )
    speechCommandSource = node.getText(sessionFile)
  ts.forEachChild(node, findSpeechCommand)
}
if (sessionComponent) findSpeechCommand(sessionComponent)

type Message = { id: string; role: "user" | "assistant"; parentID?: string }
type Part = { type: string; text: string }
type Chat = { id: string; revert?: string; turns: { user: Message; replies: Message[] }[] }
type Store = {
  messages: Record<string, Message[]>
  parts: Record<string, Part[]>
  sessions: Record<string, { id: string; revert?: { messageID: string } }>
}

function mountSpeechCommand(store: Store, route: { sessionID: string }) {
  const speak = mock((_text: string) => Promise.resolve())
  const dialog = { clear: mock(() => {}) }
  const sync = {
    session: { get: (id: string) => store.sessions[id] },
    data: { message: store.messages, part: store.parts },
  }
  const createMemo = <T>(read: () => T) => read
  const build = new Function(
    "createMemo",
    "route",
    "sync",
    "dialog",
    "speak",
    `const session = ${declarations.get("session")}
     const messages = ${declarations.get("messages")}
     const messagesBeforeRevert = ${declarations.get("messagesBeforeRevert")}
     return (${speechCommandSource})`,
  )
  const command = build(createMemo, route, sync, dialog, speak) as { run: () => void }
  return { command, speak }
}

// Chats are built from one shared timeline of turns (a prompt plus 0–3 assistant messages); each turn belongs to one
// of 2–4 chats and IDs grow along the timeline, so a chat's latest reply is usually older than some other chat's
// latest reply — the case interviewees asked about (C-5, O-6). Messages carry text, reasoning and tool parts (only
// text should be read), parts can still be loading (missing), and each chat may be reverted at any of its messages
// or at an unknown ID.
const part = fc.record({ type: fc.constantFrom("text", "text", "reasoning", "tool"), text: label })
const timeline = fc.array(
  fc.record({
    chat: fc.nat({ max: 3 }),
    prompt: fc.array(part, { maxLength: 2 }),
    replies: fc.array(fc.option(fc.array(part, { maxLength: 3 }), { nil: null, freq: 8 }), { maxLength: 3 }),
  }),
  { maxLength: 12 },
)
const reverts = fc.array(fc.option(fc.oneof(fc.nat(), fc.constant("unknown" as const)), { nil: undefined }), {
  minLength: 4,
  maxLength: 4,
})
const actions = fc.array(
  fc.oneof(
    fc.record({ type: fc.constant("switch" as const), chat: fc.nat({ max: 3 }) }),
    fc.constant({ type: "speech" as const }),
  ),
  { minLength: 1, maxLength: 12 },
)

function buildChats(count: number, turns: Timeline, revertAt: Reverts) {
  let next = 0
  const id = () => `msg_${String(next++).padStart(4, "0")}`
  const chats: Chat[] = Array.from({ length: count }, (_, index) => ({ id: `ses_${index}`, turns: [] }))
  const parts: Record<string, Part[]> = {}
  for (const turn of turns) {
    const user: Message = { id: id(), role: "user" }
    parts[user.id] = turn.prompt
    const replies = turn.replies.map((replyParts) => {
      const reply: Message = { id: id(), role: "assistant", parentID: user.id }
      if (replyParts) parts[reply.id] = replyParts
      return reply
    })
    chats[turn.chat % count].turns.push({ user, replies })
  }
  chats.forEach((chat, index) => {
    const ids = chat.turns.flatMap((turn) => [turn.user, ...turn.replies]).map((message) => message.id)
    const at = revertAt[index]
    chat.revert =
      at === undefined ? undefined : at === "unknown" ? "msg_unknown" : ids.length ? ids[at % ids.length] : undefined
  })
  const store: Store = {
    messages: Object.fromEntries(
      chats.map((chat) => [chat.id, chat.turns.flatMap((turn) => [turn.user, ...turn.replies])]),
    ),
    parts,
    sessions: Object.fromEntries(
      chats.map((chat) => [chat.id, { id: chat.id, revert: chat.revert ? { messageID: chat.revert } : undefined }]),
    ),
  }
  return { chats, store }
}
type Timeline = typeof timeline extends fc.Arbitrary<infer T> ? T : never
type Reverts = typeof reverts extends fc.Arbitrary<infer T> ? T : never

// The oracle, built from the generated turns rather than from the code's message list: the reply a person expects in
// this chat is the newest turn that still has a visible reply (messages from the revert point on are hidden), read as
// that turn's text parts in order.
function expectedSpeech(chat: Chat, parts: Record<string, Part[]>) {
  const order = chat.turns.flatMap((turn) => [turn.user, ...turn.replies]).map((message) => message.id)
  const cut = chat.revert === undefined ? -1 : order.indexOf(chat.revert)
  const visible = (message: Message) => cut === -1 || order.indexOf(message.id) < cut
  for (const turn of chat.turns.toReversed()) {
    const replies = turn.replies.filter(visible)
    if (replies.length === 0) continue
    return replies
      .flatMap((reply) => parts[reply.id] ?? [])
      .filter((item) => item.type === "text")
      .map((item) => item.text)
      .join("\n\n")
  }
  return ""
}

describe("R5: /speech reads the latest reply of the chat it's run in", () => {
  // R5: Switching away from a chat and back should never resume the TTS audio, and read-aloud always reads the latest
  // reply of the chat that it is in, even if another chat has a newer one.
  // Kind: model / oracle. For any set of chats and any sequence of chat switches and /speech commands, speak() is
  // called exactly once per /speech (never by a switch) and always with the oracle's reply for the current chat.
  test("R5: across any sequence of chat switches, /speech passes the current chat's latest reply", () => {
    // If the Session component is refactored, fail here with a clear message instead of inside the harness.
    expect(speechCommandSource).toContain("session.speech")
    for (const name of ["session", "messages", "messagesBeforeRevert"]) expect(declarations.has(name)).toBe(true)
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 4 }), timeline, reverts, actions, (count, turns, revertAt, steps) => {
        const { chats, store } = buildChats(count, turns, revertAt)
        const route = { sessionID: chats[0].id }
        const { command, speak } = mountSpeechCommand(store, route)
        const expected: string[] = []
        for (const step of steps) {
          if (step.type === "switch") {
            route.sessionID = chats[step.chat % count].id
            continue
          }
          command.run()
          expected.push(expectedSpeech(chats.find((chat) => chat.id === route.sessionID)!, store.parts))
        }
        expect(speak.mock.calls.map(([text]) => text)).toEqual(expected)
      }),
      { numRuns: 300 },
    )
  })
})
