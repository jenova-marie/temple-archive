import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { TraceContext } from "@siri/types";
import { VoyageEmbeddingProvider } from "../../src/providers/VoyageEmbeddingProvider.js";

const ctx: TraceContext = {
  traceId: "trace-123",
  spanId: "span-456",
  requestId: "req-789",
  startTime: Date.now(),
};

const mockEmbedding = (dim = 1024) =>
  Array.from({ length: dim }, (_, i) => i / dim);

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

describe("VoyageEmbeddingProvider", () => {
  const fetchMock = vi.fn();
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.VOYAGE_API_KEY = "test-key";
    process.env.VOYAGE_MODEL = "voyage-3.5";
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env.VOYAGE_API_KEY;
    delete process.env.VOYAGE_MODEL;
  });

  describe("constructor", () => {
    it("throws if no API key provided", () => {
      delete process.env.VOYAGE_API_KEY;
      expect(() => new VoyageEmbeddingProvider()).toThrow(/Voyage API key/);
    });

    it("uses VOYAGE_API_KEY env var as fallback", () => {
      const provider = new VoyageEmbeddingProvider();
      expect(provider.dimension).toBe(1024);
    });

    it("accepts apiKey via config", () => {
      delete process.env.VOYAGE_API_KEY;
      const provider = new VoyageEmbeddingProvider({ apiKey: "explicit-key" });
      expect(provider.dimension).toBe(1024);
    });
  });

  describe("embed (single text)", () => {
    it("returns ok result with embedding vector", async () => {
      const vec = mockEmbedding();
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          object: "list",
          data: [{ object: "embedding", embedding: vec, index: 0 }],
          model: "voyage-3.5",
          usage: { total_tokens: 5 },
        }),
      );

      const provider = new VoyageEmbeddingProvider();
      const result = await provider.embed("hello world", ctx);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual(vec);
        expect(result.value.length).toBe(1024);
      }
    });

    it("sends Bearer auth header and document input_type by default", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          object: "list",
          data: [{ object: "embedding", embedding: mockEmbedding(), index: 0 }],
          model: "voyage-3.5",
          usage: { total_tokens: 1 },
        }),
      );

      const provider = new VoyageEmbeddingProvider();
      await provider.embed("doc text", ctx);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toContain("/embeddings");
      expect((init as RequestInit).headers).toMatchObject({
        authorization: "Bearer test-key",
      });
      const body = JSON.parse((init as RequestInit).body as string);
      expect(body.input).toEqual(["doc text"]);
      expect(body.model).toBe("voyage-3.5");
      expect(body.input_type).toBe("document");
    });

    it("uses query input_type when label hints at retrieval", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          object: "list",
          data: [{ object: "embedding", embedding: mockEmbedding(), index: 0 }],
          model: "voyage-3.5",
          usage: { total_tokens: 1 },
        }),
      );

      const provider = new VoyageEmbeddingProvider();
      await provider.embed("what is recovery?", ctx, {
        label: "memory_prompt_query",
      });

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.input_type).toBe("query");
    });

    it("returns ProviderError on 400", async () => {
      fetchMock.mockResolvedValueOnce(
        new Response("bad input", {
          status: 400,
        }),
      );

      const provider = new VoyageEmbeddingProvider();
      const result = await provider.embed("oops", ctx);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("ProviderError");
        expect(result.error.context.status).toBe(400);
      }
    });

    it("retries on 429 then succeeds", async () => {
      fetchMock.mockResolvedValueOnce(
        new Response("rate limited", {
          status: 429,
          headers: { "retry-after": "0" },
        }),
      );
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          object: "list",
          data: [{ object: "embedding", embedding: mockEmbedding(), index: 0 }],
          model: "voyage-3.5",
          usage: { total_tokens: 1 },
        }),
      );

      const provider = new VoyageEmbeddingProvider();
      const result = await provider.embed("retry me", ctx);

      expect(result.ok).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  describe("embedBatch", () => {
    it("returns empty array for empty input without calling fetch", async () => {
      const provider = new VoyageEmbeddingProvider();
      const result = await provider.embedBatch([], ctx);

      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toEqual([]);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("preserves input order via index sort", async () => {
      const vecA = mockEmbedding();
      const vecB = mockEmbedding();
      const vecC = mockEmbedding();

      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          object: "list",
          data: [
            { object: "embedding", embedding: vecB, index: 1 },
            { object: "embedding", embedding: vecA, index: 0 },
            { object: "embedding", embedding: vecC, index: 2 },
          ],
          model: "voyage-3.5",
          usage: { total_tokens: 9 },
        }),
      );

      const provider = new VoyageEmbeddingProvider();
      const result = await provider.embedBatch(["a", "b", "c"], ctx);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value[0]).toEqual(vecA);
        expect(result.value[1]).toEqual(vecB);
        expect(result.value[2]).toEqual(vecC);
      }
    });

    it("chunks requests into batches of 128", async () => {
      const oneTwentyEight = Array.from({ length: 128 }, (_, i) => `t${i}`);
      const last = ["t128", "t129"];
      const big = [...oneTwentyEight, ...last];

      // first batch: 128 vectors
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          object: "list",
          data: oneTwentyEight.map((_, i) => ({
            object: "embedding",
            embedding: mockEmbedding(),
            index: i,
          })),
          model: "voyage-3.5",
          usage: { total_tokens: 100 },
        }),
      );
      // second batch: 2 vectors
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          object: "list",
          data: last.map((_, i) => ({
            object: "embedding",
            embedding: mockEmbedding(),
            index: i,
          })),
          model: "voyage-3.5",
          usage: { total_tokens: 4 },
        }),
      );

      const provider = new VoyageEmbeddingProvider();
      const result = await provider.embedBatch(big, ctx);

      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.length).toBe(130);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });
});
