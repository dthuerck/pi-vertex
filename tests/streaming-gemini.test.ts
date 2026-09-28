import { beforeEach, describe, expect, it, vi } from "vitest";
import { streamGemini } from "../streaming/gemini.js";
import type { AssistantMessageEvent, Context, VertexModelConfig } from "../types.js";

const mocks = vi.hoisted(() => ({
  generateContentStream: vi.fn(),
  getAuthConfig: vi.fn(),
  googleGenAI: vi.fn(),
  resolveLocation: vi.fn(),
}));

vi.mock("@google/genai", () => ({
  FinishReason: {
    STOP: "STOP",
    MAX_TOKENS: "MAX_TOKENS",
    SAFETY: "SAFETY",
  },
  GoogleGenAI: mocks.googleGenAI,
  ThinkingLevel: {
    MINIMAL: "MINIMAL",
    LOW: "LOW",
    MEDIUM: "MEDIUM",
    HIGH: "HIGH",
  },
}));

vi.mock("../auth.js", () => ({
  getAuthConfig: mocks.getAuthConfig,
  getGoogleAuthOptions: () => ({ scopes: [] }),
  resolveLocation: mocks.resolveLocation,
}));

const baseContext: Context = { messages: [] };

function makeModel(overrides: Partial<VertexModelConfig> = {}): VertexModelConfig {
  return {
    id: "gemini-2.5-pro",
    name: "Gemini 2.5 Pro",
    apiId: "gemini-2.5-pro",
    publisher: "google",
    endpointType: "gemini",
    contextWindow: 1048576,
    maxTokens: 65536,
    input: ["text", "image"],
    reasoning: true,
    tools: true,
    cost: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 0 },
    region: "global",
    ...overrides,
  };
}

async function* chunks<T>(items: T[]): AsyncGenerator<T> {
  for (const item of items) yield item;
}

async function collectEvents(stream: AsyncIterable<AssistantMessageEvent>) {
  const events: AssistantMessageEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

describe("streamGemini", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.resolveLocation.mockImplementation((region?: string) => region ?? "us-central1");
    mocks.getAuthConfig.mockReturnValue({ projectId: "test-project", location: "global" });
    mocks.googleGenAI.mockImplementation(() => ({
      models: { generateContentStream: mocks.generateContentStream },
    }));
    mocks.generateContentStream.mockReturnValue(
      chunks([{ candidates: [{ finishReason: "STOP" }] }]),
    );
  });

  it("uses a healthy Gemini 2.5 thinking config when Pi reasoning is not requested", async () => {
    await collectEvents(streamGemini(makeModel(), baseContext));

    expect(mocks.generateContentStream).toHaveBeenCalledOnce();
    expect(mocks.generateContentStream.mock.calls[0][0].config.thinkingConfig).toEqual({
      includeThoughts: true,
      thinkingBudget: 2048,
    });

    mocks.generateContentStream.mockClear();

    await collectEvents(
      streamGemini(makeModel({ id: "gemini-2.5-flash", apiId: "gemini-2.5-flash" }), baseContext),
    );

    expect(mocks.generateContentStream.mock.calls[0][0].config.thinkingConfig).toEqual({
      includeThoughts: true,
      thinkingBudget: 1024,
    });
  });

  it("omits thinkingConfig for Gemini 3/3.5 when Pi reasoning is not requested", async () => {
    await collectEvents(
      streamGemini(makeModel({ id: "gemini-3.5-flash", apiId: "gemini-3.5-flash" }), baseContext),
    );

    expect(mocks.generateContentStream).toHaveBeenCalledOnce();
    expect(mocks.generateContentStream.mock.calls[0][0].config).not.toHaveProperty(
      "thinkingConfig",
    );

    mocks.generateContentStream.mockClear();

    await collectEvents(
      streamGemini(
        makeModel({ id: "gemini-3.1-pro", apiId: "gemini-3.1-pro-preview" }),
        baseContext,
      ),
    );

    expect(mocks.generateContentStream.mock.calls[0][0].config).not.toHaveProperty(
      "thinkingConfig",
    );
  });

  it("maps Gemini 3 Pro thinking levels to supported Vertex values", async () => {
    await collectEvents(
      streamGemini(
        makeModel({ id: "gemini-3.1-pro", apiId: "gemini-3.1-pro-preview" }),
        baseContext,
        { reasoning: "minimal" },
      ),
    );

    expect(mocks.generateContentStream.mock.calls[0][0].config.thinkingConfig).toEqual({
      includeThoughts: true,
      thinkingLevel: "LOW",
    });

    mocks.generateContentStream.mockClear();

    await collectEvents(
      streamGemini(
        makeModel({ id: "gemini-3.1-pro", apiId: "gemini-3.1-pro-preview" }),
        baseContext,
        { reasoning: "medium" },
      ),
    );

    expect(mocks.generateContentStream.mock.calls[0][0].config.thinkingConfig).toEqual({
      includeThoughts: true,
      thinkingLevel: "MEDIUM",
    });
  });

  it("does not double-count cached input tokens in usage cost", async () => {
    mocks.generateContentStream.mockReturnValue(
      chunks([
        {
          candidates: [{ finishReason: "STOP" }],
          usageMetadata: {
            promptTokenCount: 100,
            cachedContentTokenCount: 40,
            candidatesTokenCount: 20,
            thoughtsTokenCount: 5,
            totalTokenCount: 125,
          },
        },
      ]),
    );

    const events = await collectEvents(streamGemini(makeModel(), baseContext));
    const done = events.find((event) => event.type === "done");

    expect(done?.type).toBe("done");
    if (done?.type !== "done") throw new Error("Expected done event");

    expect(done.message.usage).toMatchObject({
      input: 60,
      output: 25,
      cacheRead: 40,
      totalTokens: 125,
    });
    expect(done.message.usage.cost.input).toBeCloseTo(0.00012);
    expect(done.message.usage.cost.output).toBeCloseTo(0.00025);
    expect(done.message.usage.cost.cacheRead).toBeCloseTo(0.000008);
    expect(done.message.usage.cost.total).toBeCloseTo(0.000378);
  });

  it("reads system prompt and tools from pi >= 0.87 transcript system messages", async () => {
    const params = { type: "object", properties: {} } as any;
    const transcript = {
      messages: [
        {
          role: "system",
          content: "base prompt",
          sections: { rules: "<rules>be nice</rules>" },
          toolsAdded: [
            { name: "read", description: "read a file", parameters: params },
            { name: "bash", description: "run bash", parameters: params },
          ],
          timestamp: 0,
        },
        { role: "user", content: "hello", timestamp: 1 },
        {
          role: "system",
          content: "extra",
          sections: { rules: null },
          toolsRemoved: [{ name: "bash" }],
          timestamp: 2,
        },
      ],
    };

    await collectEvents(streamGemini(makeModel(), transcript));

    const call = mocks.generateContentStream.mock.calls[0][0];
    expect(call.config.systemInstruction).toBe("base prompt\n\nextra");
    expect(call.config.tools[0].functionDeclarations.map((t: any) => t.name)).toEqual(["read"]);
    // System messages must not leak into the conversation contents.
    expect(call.contents).toEqual([{ role: "user", parts: [{ text: "hello" }] }]);
  });

  it("invokes onPayload (with replacement) and onResponse", async () => {
    mocks.generateContentStream.mockReturnValue(
      chunks([
        {
          sdkHttpResponse: { headers: { "x-test": "1" } },
          candidates: [{ finishReason: "STOP" }],
        },
      ]),
    );
    const piModel = { id: "gemini-2.5-pro" };
    const onPayload = vi.fn((payload: any, _model: unknown) => ({ ...payload, model: "replaced" }));
    const onResponse = vi.fn();

    await collectEvents(streamGemini(makeModel(), baseContext, { onPayload, onResponse }, piModel));

    expect(onPayload).toHaveBeenCalledOnce();
    expect(onPayload.mock.calls[0][1]).toBe(piModel);
    expect(mocks.generateContentStream.mock.calls[0][0].model).toBe("replaced");
    expect(onResponse).toHaveBeenCalledWith({ status: 200, headers: { "x-test": "1" } }, piModel);
  });

  it("terminates safety finish reasons as error events", async () => {
    mocks.generateContentStream.mockReturnValue(
      chunks([{ candidates: [{ finishReason: "SAFETY" }] }]),
    );

    const events = await collectEvents(streamGemini(makeModel(), baseContext));
    const last = events.at(-1);

    expect(last?.type).toBe("error");
    expect(events.some((event) => event.type === "done")).toBe(false);
    if (last?.type === "error") {
      expect(last.reason).toBe("error");
      expect(last.error.errorMessage).toBe("Content blocked by safety filters");
    }
  });
});
