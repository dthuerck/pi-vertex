/**
 * Transcript helpers (system prompt + tool declarations).
 *
 * As of pi 0.87 a provider's `streamSimple` receives a `TranscriptContext` that carries
 * only `messages`: the system prompt and the tool declarations are folded into
 * `role: "system"` messages inside the transcript (with `toolsAdded` / `toolsRemoved` /
 * `sections` deltas). Earlier versions passed `context.systemPrompt` and `context.tools`.
 *
 * These helpers replay the transcript with the same semantics as pi-ai's
 * `getCurrentTools()` / `getCurrentSystemPrompt()`. They are reimplemented locally so the
 * extension still loads against older pi-ai builds that don't export them.
 */

import type { Message, TextContent, Tool } from "./types.js";

interface SystemMessageLike {
  role: "system";
  content: string | TextContent[];
  sections?: Record<string, string | null>;
  toolsAdded?: Tool[];
  toolsRemoved?: { name: string }[];
}

/** Input accepted by the streaming handlers: pi >= 0.87 transcript or legacy Context. */
export interface ProviderContext {
  messages: readonly unknown[];
  systemPrompt?: string;
  tools?: Tool[];
}

function asSystemMessage(msg: unknown): SystemMessageLike | undefined {
  return (msg as { role?: string } | undefined)?.role === "system"
    ? (msg as SystemMessageLike)
    : undefined;
}

function contentText(content: string | TextContent[]): string {
  if (typeof content === "string") return content;
  return content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

/** Resolve the tools available after applying every transcript delta in order. */
export function getCurrentTools(messages: readonly unknown[]): Tool[] {
  const tools = new Map<string, Tool>();
  for (const msg of messages) {
    const system = asSystemMessage(msg);
    if (!system) continue;
    for (const tool of system.toolsRemoved ?? []) tools.delete(tool.name);
    for (const tool of system.toolsAdded ?? []) tools.set(tool.name, tool);
  }
  return [...tools.values()];
}

/**
 * Render the current system prompt: later `content` is appended to the base prompt,
 * `sections` are patched by name and rendered after the content.
 */
export function getCurrentSystemPrompt(messages: readonly unknown[]): string {
  const content: string[] = [];
  const sections = new Map<string, string>();
  for (const msg of messages) {
    const system = asSystemMessage(msg);
    if (!system) continue;
    const text = contentText(system.content);
    if (text.length > 0) content.push(text);
    for (const [name, value] of Object.entries(system.sections ?? {})) {
      if (value === null) sections.delete(name);
      else sections.set(name, value);
    }
  }
  return [content.join("\n\n"), ...sections.values()].filter((p) => p.length > 0).join("\n\n");
}

export interface ResolvedContext {
  systemPrompt?: string;
  tools: Tool[];
  /** Conversation messages with all system messages removed. */
  messages: Message[];
}

/**
 * Normalize either context shape into prompt, tools and conversation messages.
 * Explicit legacy fields win; otherwise they are derived from the transcript.
 */
export function resolveContext(context: ProviderContext): ResolvedContext {
  const all = context.messages ?? [];
  const systemPrompt = context.systemPrompt ?? getCurrentSystemPrompt(all);
  const tools = context.tools ?? getCurrentTools(all);
  const messages = all.filter((m) => !asSystemMessage(m)) as Message[];
  return { systemPrompt: systemPrompt || undefined, tools, messages };
}
