/**
 * Gemini streaming handler using @google/genai SDK
 *
 * Aligned with pi-mono's google-vertex.ts for consistent handling of:
 * - Thinking content (thought blocks with signatures)
 * - Tool calls with unique IDs and deduplication
 * - Thinking configuration (levels for Gemini 3, budgets for Gemini 2.5)
 * - Usage tracking including thinking tokens
 */

import {
  type AssistantMessageEventStream,
  createAssistantMessageEventStream,
} from "@earendil-works/pi-ai";
import { FinishReason, GoogleGenAI, ThinkingLevel } from "@google/genai";
import { getAuthConfig, getGoogleAuthOptions, resolveLocation } from "../auth.js";
import { type ProviderContext, resolveContext } from "../transcript.js";
import type { AssistantMessage, StreamOptions, ToolCall, VertexModelConfig } from "../types.js";
import {
  calculateCost,
  convertToGeminiMessages,
  convertToolsForGemini,
  retainThoughtSignature,
  sanitizeText,
} from "../utils.js";

// Module-level counter for generating unique tool call IDs (matches pi-mono pattern)
let toolCallCounter = 0;

const THINKING_LEVEL_MAP: Record<string, ThinkingLevel> = {
  minimal: ThinkingLevel.MINIMAL,
  low: ThinkingLevel.LOW,
  medium: ThinkingLevel.MEDIUM,
  high: ThinkingLevel.HIGH,
};

interface GeminiThinkingConfig {
  includeThoughts?: boolean;
  thinkingBudget?: number;
  thinkingLevel?: ThinkingLevel;
}

function isGemini3ProModel(modelId: string): boolean {
  return /gemini-3(?:\.\d+)?-pro/.test(modelId.toLowerCase());
}

function getGemini3ThinkingLevel(effort: string, modelId: string): ThinkingLevel {
  if (isGemini3ProModel(modelId)) {
    if (effort === "minimal" || effort === "low") return ThinkingLevel.LOW;
    if (effort === "medium") return ThinkingLevel.MEDIUM;
    return ThinkingLevel.HIGH;
  }
  return THINKING_LEVEL_MAP[effort];
}

function mapGeminiStopReason(reason: string): "stop" | "length" | "toolUse" | "error" {
  switch (reason) {
    case FinishReason.STOP:
      return "stop";
    case FinishReason.MAX_TOKENS:
      return "length";
    default:
      return "error";
  }
}

function dropNullHeaders(headers: Record<string, string | null>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).filter((entry): entry is [string, string] => entry[1] !== null),
  );
}

export function streamGemini(
  model: VertexModelConfig,
  context: ProviderContext,
  options?: StreamOptions,
  piModel?: unknown,
): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();

  (async () => {
    const output: AssistantMessage = {
      role: "assistant",
      content: [],
      api: "google-generative-ai",
      provider: "vertex",
      model: model.id,
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: Date.now(),
    };

    try {
      // Priority: env var > model region > default
      const location = resolveLocation(model.region);
      const auth = getAuthConfig(location);

      // Create client with explicit API version (matches pi-mono)
      const client = new GoogleGenAI({
        vertexai: true,
        project: auth.projectId,
        location: auth.location,
        apiVersion: "v1",
        googleAuthOptions: getGoogleAuthOptions(),
        ...(options?.headers ? { httpOptions: { headers: dropNullHeaders(options.headers) } } : {}),
      });

      // pi >= 0.87: system prompt and tools live in transcript system messages.
      const resolved = resolveContext(context);

      // Convert messages with model ID for proper thinking/tool handling
      const contents = convertToGeminiMessages(resolved.messages, model.apiId);

      // Build config — only set temperature when explicitly provided.
      // The Vertex Gemini config shape is sprawling and not exhaustively typed by
      // @google/genai, so we use Record<string, unknown> and let the SDK validate.
      const config: Record<string, unknown> = {
        maxOutputTokens: options?.maxTokens || model.maxTokens,
        ...(options?.temperature !== undefined && { temperature: options.temperature }),
      };

      // Add system prompt if present
      if (resolved.systemPrompt) {
        config.systemInstruction = sanitizeText(resolved.systemPrompt);
      }

      // Add tools if present (using parametersJsonSchema for full JSON Schema support)
      if (resolved.tools.length > 0) {
        config.tools = convertToolsForGemini(resolved.tools);
      }

      // Add thinking configuration (matches pi-mono's buildParams logic)
      if (model.reasoning) {
        if (options?.reasoning) {
          const effort = options.reasoning === "xhigh" ? "high" : options.reasoning;
          const isGemini3 = model.apiId.startsWith("gemini-3");

          const thinkingConfig: GeminiThinkingConfig = { includeThoughts: true };

          if (isGemini3) {
            // Gemini 3 Pro does not support MINIMAL; Flash models do.
            thinkingConfig.thinkingLevel = getGemini3ThinkingLevel(effort, model.apiId);
          } else {
            // Gemini 2.5 models use thinking budgets (token counts)
            const budgets: Record<string, number> = {
              minimal: 128,
              low: 2048,
              medium: 8192,
              high: model.apiId.includes("2.5-pro") ? 32768 : 24576,
            };
            thinkingConfig.thinkingBudget = budgets[effort] ?? 8192;
          }

          config.thinkingConfig = thinkingConfig;
        } else {
          // If no reasoning level is specified:
          // - For Gemini 3.x/3.5 models, omit thinkingConfig entirely so Vertex AI uses
          //   the model's native default level (e.g. MEDIUM for 3.5, HIGH for others).
          // - For Gemini 2.5 models, apply a healthy thinking budget floor because
          //   thinking is disabled by default on 2.5.
          const isGemini3 = model.apiId.startsWith("gemini-3");
          if (!isGemini3) {
            config.thinkingConfig = {
              includeThoughts: true,
              thinkingBudget: model.apiId.includes("2.5-pro") ? 2048 : 1024,
            };
          }
        }
      }

      // Pass abort signal to SDK for in-flight cancellation
      if (options?.signal) {
        if (options.signal.aborted) {
          throw new Error("Request aborted");
        }
        config.abortSignal = options.signal;
      }

      // Let other extensions inspect or replace the request (pi >= 0.87 contract).
      // abortSignal is kept out of the inspected payload and re-attached afterwards.
      const { abortSignal, ...inspectableConfig } = config;
      let params: Record<string, unknown> = {
        model: model.apiId,
        contents,
        config: inspectableConfig,
      };
      const replacement = await options?.onPayload?.(params, piModel ?? model);
      if (replacement !== undefined && replacement !== null) {
        params = replacement as Record<string, unknown>;
      }
      if (abortSignal) {
        params.config = { ...((params.config as Record<string, unknown>) ?? {}), abortSignal };
      }

      // Start streaming
      const response = await client.models.generateContentStream(
        params as unknown as Parameters<typeof client.models.generateContentStream>[0],
      );

      stream.push({ type: "start", partial: output });
      let responseReported = false;

      // Track current content block for thinking/text transitions.
      // We hold a reference to the most recently appended block in output.content
      // so we can mutate text/thinking and signatures in place.
      type StreamingTextBlock = { type: "text"; text: string; textSignature?: string };
      type StreamingThinkingBlock = {
        type: "thinking";
        thinking: string;
        thinkingSignature?: string;
      };
      let currentBlock: StreamingTextBlock | StreamingThinkingBlock | null = null;
      let currentBlockType: "text" | "thinking" | null = null;

      for await (const chunk of response) {
        if (!responseReported) {
          responseReported = true;
          // The SDK only exposes response headers on the parsed chunks; a chunk
          // arriving at all implies a successful (2xx) HTTP response.
          await options?.onResponse?.(
            { status: 200, headers: chunk.sdkHttpResponse?.headers ?? {} },
            piModel ?? model,
          );
        }
        output.responseId ||= chunk.responseId;
        const candidate = chunk.candidates?.[0];

        // Process individual parts (handles thinking vs text detection)
        if (candidate?.content?.parts) {
          for (const part of candidate.content.parts) {
            if (part.text !== undefined) {
              const isThinking = part.thought === true;
              const targetType = isThinking ? "thinking" : "text";

              // Check if we need to transition to a new block
              if (currentBlockType !== targetType) {
                // End previous block (narrow on currentBlock.type so each branch
                // sees the correctly-typed block)
                if (currentBlock?.type === "text") {
                  stream.push({
                    type: "text_end",
                    contentIndex: output.content.length - 1,
                    content: currentBlock.text,
                    partial: output,
                  });
                } else if (currentBlock?.type === "thinking") {
                  stream.push({
                    type: "thinking_end",
                    contentIndex: output.content.length - 1,
                    content: currentBlock.thinking,
                    partial: output,
                  });
                }

                // Start new block
                if (isThinking) {
                  currentBlock = { type: "thinking", thinking: "", thinkingSignature: undefined };
                  output.content.push(currentBlock);
                  stream.push({
                    type: "thinking_start",
                    contentIndex: output.content.length - 1,
                    partial: output,
                  });
                } else {
                  currentBlock = { type: "text", text: "", textSignature: undefined };
                  output.content.push(currentBlock);
                  stream.push({
                    type: "text_start",
                    contentIndex: output.content.length - 1,
                    partial: output,
                  });
                }
                currentBlockType = targetType;
              }

              // Accumulate content (narrow on the discriminator so each branch
              // sees the correctly-typed block)
              if (currentBlock?.type === "thinking") {
                currentBlock.thinking += part.text;
                currentBlock.thinkingSignature = retainThoughtSignature(
                  currentBlock.thinkingSignature,
                  part.thoughtSignature,
                );
                stream.push({
                  type: "thinking_delta",
                  contentIndex: output.content.length - 1,
                  delta: part.text,
                  partial: output,
                });
              } else if (currentBlock?.type === "text") {
                currentBlock.text += part.text;
                currentBlock.textSignature = retainThoughtSignature(
                  currentBlock.textSignature,
                  part.thoughtSignature,
                );
                stream.push({
                  type: "text_delta",
                  contentIndex: output.content.length - 1,
                  delta: part.text,
                  partial: output,
                });
              }
            }

            if (part.functionCall) {
              // End current text/thinking block before tool call
              if (currentBlock?.type === "text") {
                stream.push({
                  type: "text_end",
                  contentIndex: output.content.length - 1,
                  content: currentBlock.text,
                  partial: output,
                });
              } else if (currentBlock?.type === "thinking") {
                stream.push({
                  type: "thinking_end",
                  contentIndex: output.content.length - 1,
                  content: currentBlock.thinking,
                  partial: output,
                });
              }
              if (currentBlock) {
                currentBlock = null;
                currentBlockType = null;
              }

              // Generate unique tool call ID with dedup (matches pi-mono pattern)
              const providedId = part.functionCall.id;
              const needsNewId =
                !providedId ||
                output.content.some(
                  (b) => b.type === "toolCall" && (b as { id?: string }).id === providedId,
                );
              const toolCallId = needsNewId
                ? `${part.functionCall.name}_${Date.now()}_${++toolCallCounter}`
                : providedId;

              const toolCall = {
                type: "toolCall" as const,
                id: toolCallId,
                name: part.functionCall.name || "",
                arguments: (part.functionCall.args ?? {}) as ToolCall["arguments"],
                ...(part.thoughtSignature && { thoughtSignature: part.thoughtSignature }),
              };

              output.content.push(toolCall);
              const idx = output.content.length - 1;
              stream.push({ type: "toolcall_start", contentIndex: idx, partial: output });
              stream.push({
                type: "toolcall_delta",
                contentIndex: idx,
                delta: JSON.stringify(toolCall.arguments),
                partial: output,
              });
              stream.push({ type: "toolcall_end", contentIndex: idx, toolCall, partial: output });
            }
          }
        }

        // Handle finish reason
        if (candidate?.finishReason) {
          output.stopReason = mapGeminiStopReason(candidate.finishReason);
          if (candidate.finishReason === FinishReason.SAFETY) {
            output.errorMessage = "Content blocked by safety filters";
          }
          // Override to toolUse if any tool calls are present (matches pi-mono)
          if (output.content.some((b) => b.type === "toolCall")) {
            output.stopReason = "toolUse";
          }
        }

        // Update usage — include thoughtsTokenCount in output (matches pi-mono)
        if (chunk.usageMetadata) {
          const meta = chunk.usageMetadata as {
            cachedContentTokenCount?: number;
            promptTokenCount?: number;
            candidatesTokenCount?: number;
            thoughtsTokenCount?: number;
            totalTokenCount?: number;
          };
          const cachedTokens = meta.cachedContentTokenCount || 0;
          output.usage = {
            input: Math.max(0, (meta.promptTokenCount || 0) - cachedTokens),
            output: (meta.candidatesTokenCount || 0) + (meta.thoughtsTokenCount || 0),
            cacheRead: cachedTokens,
            cacheWrite: 0,
            totalTokens: meta.totalTokenCount || 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          };
          calculateCost(
            model.cost.input,
            model.cost.output,
            model.cost.cacheRead,
            model.cost.cacheWrite,
            output.usage,
          );
        }
      }

      // End final block
      if (currentBlock?.type === "text") {
        stream.push({
          type: "text_end",
          contentIndex: output.content.length - 1,
          content: currentBlock.text,
          partial: output,
        });
      } else if (currentBlock?.type === "thinking") {
        stream.push({
          type: "thinking_end",
          contentIndex: output.content.length - 1,
          content: currentBlock.thinking,
          partial: output,
        });
      }

      if (options?.signal?.aborted) {
        throw new Error("Request was aborted");
      }
      if (output.stopReason === "aborted" || output.stopReason === "error") {
        throw new Error(output.errorMessage || "An unknown error occurred");
      }

      stream.push({
        type: "done",
        reason: output.stopReason as "stop" | "length" | "toolUse",
        message: output,
      });
      stream.end();
    } catch (error) {
      output.stopReason = options?.signal?.aborted ? "aborted" : "error";
      output.errorMessage = error instanceof Error ? error.message : String(error);
      stream.push({ type: "error", reason: output.stopReason, error: output });
      stream.end();
    }
  })();

  return stream;
}
