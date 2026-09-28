# Test Coverage

## Current Status
- **Automated tests**: ✅ 89 tests across auth, transcript handling, utils, models, Gemini message conversion, streaming dispatch, mocked Gemini streaming, and mocked MaaS (Anthropic + OpenAI-compat) streaming.
- **Lint/type checks**: Biome + TypeScript (`npm run check`, `npm run build`). `npm run check` is clean (0 warnings).
- **CI**: GitHub Actions runs `build`, `check`, and `test:coverage` on every PR and push to `main`.

## Test Files
| File | Coverage |
|------|----------|
| `tests/utils.test.ts` | `sanitizeText`, `retainThoughtSignature`, `mapStopReason`, `calculateCost`, `convertTools`, `convertToolsForGemini` |
| `tests/auth.test.ts` | env-var resolution (`resolveProjectId`, `resolveLocation`, `resolveKeyFile`), `getAuthConfig`, endpoint hosts, `buildBaseUrl` |
| `tests/models.test.ts` | Model definitions integrity, uniqueness, field validation |
| `tests/convert-to-gemini.test.ts` | `convertToGeminiMessages` — user text/images, assistant text/thinking/tool calls, tool results including images and missing-result synthesis, cross-provider signatures, multi-turn conversations |
| `tests/streaming-dispatch.test.ts` | `streamVertex` endpoint type dispatch (gemini/maas routing, error on unknown type) |
| `tests/streaming-gemini.test.ts` | `streamGemini` integration-style tests with mocked `@google/genai`: Gemini 2.5 default thinking budgets, Gemini 3/3.5 native defaults, cached-token usage, safety termination, pi 0.87 transcript system messages, `onPayload`/`onResponse` hooks |
| `tests/streaming-maas.test.ts` | `streamMaaS` Anthropic path (happy path, regional pricing, tool_use stop reason, sync error path, exactly-one `stream.end()` regression test) and OpenAI-compat path (event relay + model id rewrite) |

## Gaps / Next Steps
- Add broader integration tests for `streaming/gemini.ts` event sequencing (text/thinking/tool-call chunks).
- Expand `streaming/maas.ts` Anthropic-path coverage: thinking blocks with signatures, multi-turn tool-result adjacency, tool-id sanitization edge cases.
- Add tests for `index.ts` extension entry point (requires mocking `pi-coding-agent` ExtensionAPI).
- Tighten the `any` usage in `streaming/maas.ts` (currently disabled via biome override) by introducing an internal type for the normalize/replay pipeline.
