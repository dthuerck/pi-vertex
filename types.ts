/**
 * Type definitions for pi-vertex-gemini extension
 *
 * Core message/content types are re-exported from pi-ai to ensure pi-vertex
 * handles the full message structure (thinking blocks, tool calls, tool results)
 * that pi-coding-agent passes through the streamSimple callback.
 */

// Re-export core types from pi-ai
export type {
  AssistantMessage,
  AssistantMessageEvent,
  AssistantMessageEventStream,
  Context,
  ImageContent,
  Message,
  StopReason,
  TextContent,
  ThinkingContent,
  Tool,
  ToolCall,
  ToolResultMessage,
  Usage,
  UserMessage,
} from "@earendil-works/pi-ai";

// Vertex-specific types

export type ModelInputType = "text" | "image";
export type EndpointType = "gemini" | "maas";

export interface ModelCost {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface VertexModelConfig {
  id: string;
  name: string;
  apiId: string;
  publisher: string;
  endpointType: EndpointType;
  contextWindow: number;
  maxTokens: number;
  input: ModelInputType[];
  reasoning: boolean;
  tools: boolean;
  /** Default/global endpoint pricing, per 1M tokens. */
  cost: ModelCost;
  /** Optional non-global endpoint pricing, per 1M tokens. */
  costRegional?: ModelCost;
  region: string;
}

export interface AuthConfig {
  projectId: string;
  location: string;
  credentials?: string;
}

export interface ProviderResponseInfo {
  status: number;
  headers: Record<string, string>;
}

/**
 * Subset of pi-ai's SimpleStreamOptions used by this extension. Declared locally so the
 * extension type-checks against both pre- and post-0.87 pi-ai.
 */
export interface StreamOptions {
  maxTokens?: number;
  temperature?: number;
  reasoning?: "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
  signal?: AbortSignal;
  /** Inspect or replace the provider payload before it is sent (pi >= 0.87). */
  // biome-ignore lint/suspicious/noExplicitAny: model type differs between pi versions
  onPayload?: (payload: unknown, model: any) => unknown | undefined | Promise<unknown | undefined>;
  /** Report the HTTP response before its body is consumed (pi >= 0.87). */
  // biome-ignore lint/suspicious/noExplicitAny: model type differs between pi versions
  onResponse?: (response: ProviderResponseInfo, model: any) => void | Promise<void>;
  /** Custom fetch implementation for provider HTTP requests (pi >= 0.87). */
  fetch?: typeof fetch;
  headers?: Record<string, string | null>;
  maxRetries?: number;
  maxRetryDelayMs?: number;
  timeoutMs?: number;
}
