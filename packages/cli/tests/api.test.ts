import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock config module that src/api.ts imports
vi.mock("../src/config.js", () => ({
  getApiUrl: () => "http://localhost:3333",
  getConversationId: () => "test-conversation-id",
}));

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Import after mocks
import { sendMessage, checkHealth, getMetrics } from "../src/api.js";

/**
 * Helper to create a mock UI Message Stream (SSE with JSON)
 * UI Message Stream format:
 * - `data: {"type":"text-delta","id":"0","delta":"text"}`
 * - `data: {"type":"finish","finishReason":"stop"}`
 * - `data: [DONE]`
 */
function createMockUIStream(chunks: string[]) {
  const encoder = new TextEncoder();
  // Create SSE format lines
  const lines = [
    'data: {"type":"start"}\n\n',
    'data: {"type":"start-step"}\n\n',
    'data: {"type":"text-start","id":"0"}\n\n',
    ...chunks.map(chunk => `data: {"type":"text-delta","id":"0","delta":"${chunk}"}\n\n`),
    'data: {"type":"text-end","id":"0"}\n\n',
    'data: {"type":"finish-step"}\n\n',
    'data: {"type":"finish","finishReason":"stop"}\n\n',
    'data: [DONE]\n\n',
  ];

  let index = 0;

  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < lines.length) {
        controller.enqueue(encoder.encode(lines[index]));
        index++;
      } else {
        controller.close();
      }
    },
  });
}

/**
 * Create a simple success stream with complete text
 */
function createSuccessStream(text: string) {
  const encoder = new TextEncoder();
  const content = [
    'data: {"type":"start"}\n\n',
    'data: {"type":"start-step"}\n\n',
    'data: {"type":"text-start","id":"0"}\n\n',
    `data: {"type":"text-delta","id":"0","delta":"${text}"}\n\n`,
    'data: {"type":"text-end","id":"0"}\n\n',
    'data: {"type":"finish-step"}\n\n',
    'data: {"type":"finish","finishReason":"stop"}\n\n',
    'data: [DONE]\n\n',
  ].join('');

  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(content));
      controller.close();
    },
  });
}

describe("api", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("sendMessage", () => {
    it("sends message to correct endpoint with new format", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        body: createSuccessStream("Hello! How can I help?"),
      });

      const result = await sendMessage("Hello");

      expect(mockFetch).toHaveBeenCalledWith("http://localhost:3333/api/v1/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: expect.any(String),
      });

      // Verify the request body format
      const callArgs = mockFetch.mock.calls[0][1];
      const body = JSON.parse(callArgs.body);
      expect(body.messages).toBeInstanceOf(Array);
      expect(body.messages[0].role).toBe("user");
      expect(body.messages[0].parts[0].text).toBe("Hello");

      expect(result.response).toBe("Hello! How can I help?");
      expect(result.conversationId).toBe("test-conversation-id");
    });

    it("buffers streamed text and returns complete response", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        body: createMockUIStream(["Hello ", "world", "!"]),
      });

      const result = await sendMessage("test");

      expect(result.response).toBe("Hello world!");
    });

    it("throws error on non-ok response", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        statusText: "Bad Request",
        json: () =>
          Promise.resolve({
            error: "Bad Request",
            message: "Invalid request body",
            statusCode: 400,
          }),
      });

      await expect(sendMessage("")).rejects.toThrow(
        "API Error (400): Invalid request body",
      );
    });

    it("handles JSON parse errors in error response", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        json: () => Promise.reject(new Error("Invalid JSON")),
      });

      await expect(sendMessage("test")).rejects.toThrow(
        "API Error (500): Internal Server Error",
      );
    });

    it("returns ChatResponse structure", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        body: createSuccessStream("Response text"),
      });

      const result = await sendMessage("test");

      expect(result.response).toBe("Response text");
      expect(result.conversationId).toBe("test-conversation-id");
    });

    it("throws error on stream error event", async () => {
      const encoder = new TextEncoder();
      const errorStream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(`data: {"type":"text-delta","id":"0","delta":"Partial "}\n\n`));
          controller.enqueue(encoder.encode(`data: {"type":"error","message":"Processing failed"}\n\n`));
          controller.close();
        },
      });

      mockFetch.mockResolvedValue({
        ok: true,
        body: errorStream,
      });

      await expect(sendMessage("test")).rejects.toThrow(
        "Stream error:",
      );
    });
  });

  describe("checkHealth", () => {
    it("calls health endpoint", async () => {
      const mockHealth = {
        status: "healthy",
        timestamp: new Date().toISOString(),
        uptime: 12345,
        version: "0.1.0",
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockHealth),
      });

      const result = await checkHealth();

      expect(mockFetch).toHaveBeenCalledWith("http://localhost:3333/health");
      expect(result).toEqual(mockHealth);
    });

    it("throws error on failed health check", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        statusText: "Service Unavailable",
      });

      await expect(checkHealth()).rejects.toThrow(
        "Health check failed: Service Unavailable",
      );
    });
  });

  describe("getMetrics", () => {
    it("calls metrics endpoint", async () => {
      const metricsText =
        "# HELP recoverysky_uptime_seconds Uptime in seconds\n# TYPE recoverysky_uptime_seconds gauge\nrecoverysky_uptime_seconds 12345";

      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(metricsText),
      });

      const result = await getMetrics();

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3333/health/metrics",
      );
      expect(result).toBe(metricsText);
    });

    it("throws error on failed metrics request", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        statusText: "Not Found",
      });

      await expect(getMetrics()).rejects.toThrow(
        "Metrics request failed: Not Found",
      );
    });
  });
});
