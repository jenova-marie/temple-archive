import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createQdrantClient,
  getQdrantClient,
  closeQdrantClient,
  checkQdrantHealth,
} from "../../src/qdrant/client.js";

// Mock observability
vi.mock("@pippa/observability", () => ({
  getLogger: () => ({
    child: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  }),
}));

// Mock Qdrant client
const mockGetCollections = vi.fn();
vi.mock("@qdrant/js-client-rest", () => ({
  QdrantClient: vi.fn().mockImplementation((config) => ({
    _config: config,
    getCollections: mockGetCollections,
  })),
}));

describe("qdrant/client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the singleton by closing the client
    closeQdrantClient();
    // Clear env vars
    delete process.env.QDRANT_URL;
    delete process.env.QDRANT_API_KEY;
  });

  afterEach(() => {
    closeQdrantClient();
  });

  describe("createQdrantClient", () => {
    it("creates client with default URL", () => {
      const client = createQdrantClient();

      expect(client).toBeDefined();
      expect((client as { _config: { url: string } })._config.url).toBe(
        "http://localhost:6333",
      );
    });

    it("creates client with custom URL", () => {
      const client = createQdrantClient({
        url: "http://qdrant.example.com:6333",
      });

      expect((client as { _config: { url: string } })._config.url).toBe(
        "http://qdrant.example.com:6333",
      );
    });

    it("uses QDRANT_URL environment variable", () => {
      process.env.QDRANT_URL = "http://env-qdrant:6333";

      const client = createQdrantClient();

      expect((client as { _config: { url: string } })._config.url).toBe(
        "http://env-qdrant:6333",
      );
    });

    it("config URL takes precedence over env var", () => {
      process.env.QDRANT_URL = "http://env-qdrant:6333";

      const client = createQdrantClient({ url: "http://config-qdrant:6333" });

      expect((client as { _config: { url: string } })._config.url).toBe(
        "http://config-qdrant:6333",
      );
    });

    it("creates client with API key", () => {
      const client = createQdrantClient({ apiKey: "test-api-key" });

      expect((client as { _config: { apiKey: string } })._config.apiKey).toBe(
        "test-api-key",
      );
    });

    it("uses QDRANT_API_KEY environment variable", () => {
      process.env.QDRANT_API_KEY = "env-api-key";

      const client = createQdrantClient();

      expect((client as { _config: { apiKey: string } })._config.apiKey).toBe(
        "env-api-key",
      );
    });

    it("creates client with custom timeout", () => {
      const client = createQdrantClient({ timeout: 60000 });

      expect((client as { _config: { timeout: number } })._config.timeout).toBe(
        60000,
      );
    });

    it("uses default timeout of 30000ms", () => {
      const client = createQdrantClient();

      expect((client as { _config: { timeout: number } })._config.timeout).toBe(
        30000,
      );
    });
  });

  describe("getQdrantClient", () => {
    it("creates client on first call", () => {
      const client = getQdrantClient();

      expect(client).toBeDefined();
    });

    it("returns same instance on subsequent calls", () => {
      const client1 = getQdrantClient();
      const client2 = getQdrantClient();

      expect(client1).toBe(client2);
    });

    it("returns existing client if already created", () => {
      const created = createQdrantClient({ url: "http://custom:6333" });
      const retrieved = getQdrantClient();

      expect(retrieved).toBe(created);
    });
  });

  describe("closeQdrantClient", () => {
    it("clears the singleton client", () => {
      const client1 = getQdrantClient();
      closeQdrantClient();
      const client2 = getQdrantClient();

      expect(client1).not.toBe(client2);
    });

    it("can be called multiple times safely", () => {
      closeQdrantClient();
      closeQdrantClient();
      closeQdrantClient();

      // Should not throw
      expect(true).toBe(true);
    });
  });

  describe("checkQdrantHealth", () => {
    it("returns true when Qdrant is healthy", async () => {
      mockGetCollections.mockResolvedValue({ collections: [] });

      const healthy = await checkQdrantHealth();

      expect(healthy).toBe(true);
      expect(mockGetCollections).toHaveBeenCalled();
    });

    it("returns false when Qdrant is unreachable", async () => {
      mockGetCollections.mockRejectedValue(new Error("Connection refused"));

      const healthy = await checkQdrantHealth();

      expect(healthy).toBe(false);
    });

    it("returns false on timeout", async () => {
      mockGetCollections.mockRejectedValue(new Error("Request timeout"));

      const healthy = await checkQdrantHealth();

      expect(healthy).toBe(false);
    });
  });
});
