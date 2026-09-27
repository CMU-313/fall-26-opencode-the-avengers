import type { AssistantMessage, Part, Provider, TextPart, UserMessage } from "@opencode-ai/sdk/v2"
import path from "path"
import { Locale } from "./locale"
import * as Model from "./model"

export type TranscriptOptions = {
  thinking: boolean
  toolDetails: boolean
  assistantMetadata: boolean
  providers?: Provider[]
}

export type SessionInfo = {
  id: string
  title: string
  time: {
    created: number
    updated: number
  }
}

export type MessageWithParts = {
  info: UserMessage | AssistantMessage
  parts: Part[]
}

export function formatTranscript(
  session: SessionInfo,
  messages: MessageWithParts[],
  options: TranscriptOptions,
): string {
  const providers = Model.index(options.providers)
  let transcript = `# ${session.title}\n\n`
  transcript += `**Session ID:** ${session.id}\n`
  transcript += `**Created:** ${new Date(session.time.created).toLocaleString()}\n`
  transcript += `**Updated:** ${new Date(session.time.updated).toLocaleString()}\n\n`
  transcript += `---\n\n`

  for (const msg of messages.toSorted(
    (a, b) => a.info.time.created - b.info.time.created || a.info.id.localeCompare(b.info.id),
  )) {
    transcript += formatMessage(msg.info, msg.parts, options, providers)
    transcript += `---\n\n`
  }

  return transcript
}

export type ResponseFormat = "md" | "txt"

// Plain text keeps only the visible answer; thinking, tool details, and metadata are Markdown-only options.
export function formatResponse(
  msg: AssistantMessage,
  parts: Part[],
  format: ResponseFormat,
  options: TranscriptOptions,
): string {
  if (format === "md") return `${formatMessage(msg, parts, options).trimEnd()}\n`
  const text = parts
    .filter((part): part is TextPart => part.type === "text" && !part.synthetic)
    .map((part) => part.text.trim())
    .filter((text) => text.length > 0)
    .join("\n\n")
  return text ? `${text}\n` : ""
}

// Resolves the save format from the extension, defaulting to Markdown when none is given.
export function parseResponseFilename(input: string): { filename: string; format: ResponseFormat } | undefined {
  const filename = input.trim()
  const base = path.basename(filename)
  if (!base || /[\\/]$/.test(filename) || /^\.(md|txt)$/i.test(base)) return undefined
  const extension = path.extname(base).toLowerCase()
  if (extension === "") return { filename: `${filename}.md`, format: "md" }
  if (extension === ".md") return { filename, format: "md" }
  if (extension === ".txt") return { filename, format: "txt" }
  return undefined
}

export function formatMessage(
  msg: UserMessage | AssistantMessage,
  parts: Part[],
  options: TranscriptOptions,
  providers?: Provider[] | ReadonlyMap<string, Provider>,
): string {
  let result = ""

  if (msg.role === "user") {
    result += `## User\n\n`
  } else {
    result += formatAssistantHeader(msg, options.assistantMetadata, providers ?? options.providers)
  }

  for (const part of parts) {
    result += formatPart(part, options)
  }

  return result
}

export function formatAssistantHeader(
  msg: AssistantMessage,
  includeMetadata: boolean,
  providers?: Provider[] | ReadonlyMap<string, Provider>,
): string {
  if (!includeMetadata) {
    return `## Assistant\n\n`
  }

  const duration =
    msg.time.completed && msg.time.created ? ((msg.time.completed - msg.time.created) / 1000).toFixed(1) + "s" : ""

  const modelName = Model.name(providers, msg.providerID, msg.modelID)

  return `## Assistant (${Locale.titlecase(msg.agent)} · ${modelName}${duration ? ` · ${duration}` : ""})\n\n`
}

export function formatPart(part: Part, options: TranscriptOptions): string {
  if (part.type === "text" && !part.synthetic) {
    return `${part.text}\n\n`
  }

  if (part.type === "reasoning") {
    if (options.thinking) {
      return `_Thinking:_\n\n${part.text}\n\n`
    }
    return ""
  }

  if (part.type === "tool") {
    let result = `**Tool: ${part.tool}**\n`
    if (options.toolDetails && part.state.input) {
      result += `\n**Input:**\n\`\`\`json\n${JSON.stringify(part.state.input, null, 2)}\n\`\`\`\n`
    }
    if (options.toolDetails && part.state.status === "completed" && part.state.output) {
      result += `\n**Output:**\n\`\`\`\n${part.state.output}\n\`\`\`\n`
    }
    if (options.toolDetails && part.state.status === "error" && part.state.error) {
      result += `\n**Error:**\n\`\`\`\n${part.state.error}\n\`\`\`\n`
    }
    result += `\n`
    return result
  }

  return ""
}
