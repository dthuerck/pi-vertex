/**
 * pi-vertex-gemini - Google Vertex AI provider for Pi coding agent
 *
 * Supports:
 * - Gemini models (via @google/genai)
 * - Claude models (via @anthropic-ai/vertex-sdk)
 * - All MaaS models (Llama, Mistral, DeepSeek, etc. via OpenAI-compatible endpoint)
 *
 * Configuration (environment variables only; same names as pi-vertex-anthropic):
 *
 *   VERTEX_PROJECT_ID          GCP project ID
 *     aliases: ANTHROPIC_VERTEX_PROJECT_ID, GOOGLE_CLOUD_PROJECT, GCLOUD_PROJECT
 *   VERTEX_REGION              Vertex region (optional, default: model region)
 *     aliases: CLOUD_ML_REGION, GOOGLE_CLOUD_LOCATION
 *   VERTEX_SERVICE_ACCOUNT_KEY Path to a service account JSON key (optional)
 *     aliases: GOOGLE_APPLICATION_CREDENTIALS
 *
 * Without a key file, Google Application Default Credentials are used.
 *
 * Usage:
 *   pi --provider vertex --model gemini-2.5-pro
 *   pi --provider vertex --model claude-opus-4-6
 *   pi --provider vertex --model llama-4-maverick
 */

import type { Api, Model } from "@earendil-works/pi-ai";
import type {
  ExtensionAPI,
  ExtensionContext,
  InputEvent,
  SessionStartEvent,
} from "@earendil-works/pi-coding-agent";
import { resolveProjectId } from "./auth.js";
import { ALL_MODELS, getModelById } from "./models/index.js";
import { streamVertex } from "./streaming/index.js";
import type { ProviderContext } from "./transcript.js";
import type { StreamOptions, VertexModelConfig } from "./types.js";

/**
 * Convert Vertex model config to Pi model format
 */
function toPiModel(config: VertexModelConfig): Model<Api> {
  return {
    id: config.id,
    name: config.name,
    api: "vertex-unified",
    provider: "vertex",
    baseUrl: "https://aiplatform.googleapis.com", // Actual URL built per-request
    reasoning: config.reasoning,
    input: config.input,
    cost: config.cost,
    contextWindow: config.contextWindow,
    maxTokens: config.maxTokens,
    headers: {},
  } as Model<Api>;
}

/**
 * Extension entry point
 */
export default function (pi: ExtensionAPI) {
  const projectId = resolveProjectId();

  if (!projectId) {
    console.warn(
      "[pi-vertex-gemini] Skipping: no project ID found. Set VERTEX_PROJECT_ID (or ANTHROPIC_VERTEX_PROJECT_ID / GOOGLE_CLOUD_PROJECT).",
    );
    return;
  }

  pi.registerProvider("vertex", {
    name: "Google Vertex AI",
    // Placeholder; actual URLs are built per-request based on model region.
    baseUrl: "https://aiplatform.googleapis.com",

    // Sentinel API key. Access tokens are obtained inside the stream handlers via
    // google-auth-library (service account key or ADC). This value is never sent;
    // pi just requires *some* credential to consider the provider ready.
    apiKey: "managed-by-extension",

    api: "vertex-unified",
    models: ALL_MODELS.map(toPiModel),

    // pi >= 0.87 passes a TranscriptContext (messages only); older versions pass a
    // Context with systemPrompt/tools. The stream handlers accept both shapes.
    streamSimple: ((model: Model<Api>, context: ProviderContext, options?: StreamOptions) => {
      const vertexModel = getModelById(model.id);
      if (!vertexModel) {
        throw new Error(`Unknown Vertex model: ${model.id}`);
      }
      return streamVertex(vertexModel, context, options, model);
      // biome-ignore lint/suspicious/noExplicitAny: signature differs between pi versions
    }) as any,
  });

  // Show startup info as a widget that clears on first user input
  const startupLines = [
    `   [pi-vertex-gemini] Project: ${projectId}`,
    `   [pi-vertex-gemini] Registered ${ALL_MODELS.length} models`,
  ];
  pi.on("session_start", async (_event: SessionStartEvent, ctx: ExtensionContext) => {
    // biome-ignore lint/suspicious/noExplicitAny: widget theme is duck-typed
    ctx.ui.setWidget("pi-vertex-gemini-startup", (_tui: unknown, theme: any) => ({
      render: () => [...startupLines.map((l: string) => theme.fg("muted", l)), ""],
      invalidate: () => {},
    }));
  });
  pi.on("input", async (_event: InputEvent, ctx: ExtensionContext) => {
    ctx.ui.setWidget("pi-vertex-gemini-startup", undefined);
  });
}

// Export types and utilities for advanced usage
export * from "./types.js";
export * from "./models/index.js";
export * from "./auth.js";
export * from "./transcript.js";
export * from "./streaming/index.js";
