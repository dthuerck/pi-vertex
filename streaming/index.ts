/**
 * Streaming handler dispatcher
 */

import type { AssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { ProviderContext } from "../transcript.js";
import type { StreamOptions, VertexModelConfig } from "../types.js";
import { streamGemini } from "./gemini.js";
import { streamMaaS } from "./maas.js";

/**
 * @param piModel The pi model object, passed back to `onPayload` / `onResponse` hooks.
 */
export function streamVertex(
  model: VertexModelConfig,
  context: ProviderContext,
  options?: StreamOptions,
  piModel?: unknown,
): AssistantMessageEventStream {
  switch (model.endpointType) {
    case "gemini":
      return streamGemini(model, context, options, piModel);
    case "maas":
      return streamMaaS(model, context, options, piModel);
    default: {
      const exhaustive: never = model.endpointType;
      throw new Error(`Unknown endpoint type: ${String(exhaustive)}`);
    }
  }
}

export { streamGemini, streamMaaS };
