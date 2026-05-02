import { describe, it, expect, vi, beforeEach } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import {
  EntityExtractor,
  DEFAULT_EXTRACTOR_CONFIG,
} from "../../src/extraction/EntityExtractor.js";
import type {
  Message,
  TraceContext,
  IKnowledgeStore,
} from "@siri/types";
import { ok } from "@siri/types";

// Mock observability
vi.mock("@siri/observability", () => ({
  getLogger: () => ({
    child: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  }),
  withSpan: vi.fn().mockImplementation((_name, fn) => fn()),
  pipelineMetrics: {
    stageDuration: { record: vi.fn() },
    errors: { add: vi.fn() },
    memoryCacheHits: { add: vi.fn() },
    memoryCacheMisses: { add: vi.fn() },
  },
}));

const createTraceContext = (): TraceContext => ({
  requestId: `req_${Date.now()}`,
  spanId: "span-123",
  traceId: "trace-123",
  startTime: Date.now(),
});

const createMockMessage = (
  role: "user" | "assistant",
  content: string,
): Message => ({
  id: `msg_${Date.now()}`,
  conversationId: "conv_123",
  userId: "user_123",
  role,
  content,
  timestamp: Date.now(),
});

const createMockKnowledgeStore = (): IKnowledgeStore => ({
  upsertEntity: vi.fn().mockResolvedValue(ok(undefined)),
  createRelationship: vi.fn().mockResolvedValue(ok(undefined)),
  getRelatedEntities: vi.fn().mockResolvedValue(ok([])),
  searchEntities: vi.fn().mockResolvedValue(ok([])),
});

describe("EntityExtractor", () => {
  let mockClient: {
    messages: {
      create: ReturnType<typeof vi.fn>;
    };
  };
  let mockKnowledgeStore: IKnowledgeStore;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = {
      messages: {
        create: vi.fn(),
      },
    };
    mockKnowledgeStore = createMockKnowledgeStore();
  });

  describe("constructor", () => {
    it("should use default config when not provided", () => {
      const extractor = new EntityExtractor(null, mockKnowledgeStore);
      expect(extractor.getConfig()).toEqual(DEFAULT_EXTRACTOR_CONFIG);
    });

    it("should merge provided config with defaults", () => {
      const extractor = new EntityExtractor(null, mockKnowledgeStore, {
        mode: "sample:50",
        minImportance: 0.5,
      });

      const config = extractor.getConfig();
      expect(config.mode).toBe("sample:50");
      expect(config.minImportance).toBe(0.5);
      expect(config.model).toBe(DEFAULT_EXTRACTOR_CONFIG.model);
    });
  });

  describe("extract - mode checks", () => {
    it("should skip extraction when mode is none", async () => {
      const extractor = new EntityExtractor(
        mockClient as unknown as Anthropic,
        mockKnowledgeStore,
        { mode: "none" },
      );

      const result = await extractor.extract(
        createMockMessage("user", "I talked to my sponsor today"),
        createMockMessage("assistant", "That sounds like a positive step"),
        3,
        createTraceContext(),
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.entities).toHaveLength(0);
      }
      expect(mockClient.messages.create).not.toHaveBeenCalled();
    });

    it("should skip extraction when mode is significant and crisis < 4", async () => {
      const extractor = new EntityExtractor(
        mockClient as unknown as Anthropic,
        mockKnowledgeStore,
        { mode: "significant" },
      );

      const result = await extractor.extract(
        createMockMessage("user", "Regular message"),
        createMockMessage("assistant", "Response"),
        3,
        createTraceContext(),
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.entities).toHaveLength(0);
      }
      expect(mockClient.messages.create).not.toHaveBeenCalled();
    });

    it("should extract when mode is significant and crisis >= 4", async () => {
      mockClient.messages.create.mockResolvedValue({
        content: [
          { type: "text", text: '{"entities": [], "relationships": []}' },
        ],
      });

      const extractor = new EntityExtractor(
        mockClient as unknown as Anthropic,
        mockKnowledgeStore,
        { mode: "significant" },
      );

      await extractor.extract(
        createMockMessage("user", "I am struggling"),
        createMockMessage("assistant", "I hear you"),
        5,
        createTraceContext(),
      );

      expect(mockClient.messages.create).toHaveBeenCalled();
    });

    it("should extract when mode is all", async () => {
      mockClient.messages.create.mockResolvedValue({
        content: [
          { type: "text", text: '{"entities": [], "relationships": []}' },
        ],
      });

      const extractor = new EntityExtractor(
        mockClient as unknown as Anthropic,
        mockKnowledgeStore,
        { mode: "all" },
      );

      await extractor.extract(
        createMockMessage("user", "Hello"),
        createMockMessage("assistant", "Hi"),
        1,
        createTraceContext(),
      );

      expect(mockClient.messages.create).toHaveBeenCalled();
    });
  });

  describe("extract - LLM parsing", () => {
    it("should parse entities from LLM response", async () => {
      mockClient.messages.create.mockResolvedValue({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              entities: [
                {
                  name: "John",
                  type: "person",
                  importance: 0.8,
                  context: "Sponsor",
                },
                {
                  name: "work stress",
                  type: "trigger",
                  importance: 0.6,
                  context: "Job related",
                },
              ],
              relationships: [
                {
                  from: "John",
                  to: "work stress",
                  type: "helps_with",
                  strength: 0.7,
                },
              ],
            }),
          },
        ],
      });

      const extractor = new EntityExtractor(
        mockClient as unknown as Anthropic,
        mockKnowledgeStore,
        { mode: "all" },
      );

      const result = await extractor.extract(
        createMockMessage(
          "user",
          "I talked to my sponsor John about work stress",
        ),
        createMockMessage("assistant", "It is great you have support"),
        1,
        createTraceContext(),
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.entities).toHaveLength(2);
        // Entity names are normalized to lowercase
        expect(result.value.entities[0].name).toBe("john");
        expect(result.value.relationships).toHaveLength(1);
      }
    });

    it("should filter by importance threshold", async () => {
      mockClient.messages.create.mockResolvedValue({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              entities: [
                {
                  name: "John",
                  type: "person",
                  importance: 0.8,
                  context: "High",
                },
                {
                  name: "weather",
                  type: "event",
                  importance: 0.1,
                  context: "Low",
                },
              ],
              relationships: [],
            }),
          },
        ],
      });

      const extractor = new EntityExtractor(
        mockClient as unknown as Anthropic,
        mockKnowledgeStore,
        { mode: "all", minImportance: 0.3 },
      );

      const result = await extractor.extract(
        createMockMessage("user", "John mentioned the weather"),
        createMockMessage("assistant", "Okay"),
        1,
        createTraceContext(),
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        // Only John should pass the threshold (names normalized to lowercase)
        expect(result.value.entities).toHaveLength(1);
        expect(result.value.entities[0].name).toBe("john");
      }
    });

    it("should filter out entities with disabled types", async () => {
      mockClient.messages.create.mockResolvedValue({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              entities: [
                {
                  name: "John",
                  type: "person",
                  importance: 0.8,
                  context: "Sponsor",
                },
                {
                  name: "happy",
                  type: "emotion",
                  importance: 0.9,
                  context: "Feeling",
                },
              ],
              relationships: [],
            }),
          },
        ],
      });

      const extractor = new EntityExtractor(
        mockClient as unknown as Anthropic,
        mockKnowledgeStore,
        { mode: "all", enabledTypes: ["person"] },
      );

      const result = await extractor.extract(
        createMockMessage("user", "John made me happy"),
        createMockMessage("assistant", "Great"),
        1,
        createTraceContext(),
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        // Only person type should be included
        expect(result.value.entities).toHaveLength(1);
        expect(result.value.entities[0].type).toBe("person");
      }
    });
  });

  describe("extract - error handling", () => {
    it("should return empty result when no client", async () => {
      const extractor = new EntityExtractor(null, mockKnowledgeStore, {
        mode: "all",
      });

      const result = await extractor.extract(
        createMockMessage("user", "Hello"),
        createMockMessage("assistant", "Hi"),
        1,
        createTraceContext(),
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.entities).toHaveLength(0);
      }
    });

    it("should handle LLM errors gracefully", async () => {
      mockClient.messages.create.mockRejectedValue(new Error("API Error"));

      const extractor = new EntityExtractor(
        mockClient as unknown as Anthropic,
        mockKnowledgeStore,
        { mode: "all" },
      );

      const result = await extractor.extract(
        createMockMessage("user", "Hello"),
        createMockMessage("assistant", "Hi"),
        1,
        createTraceContext(),
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("LLMError");
      }
    });

    it("should handle invalid JSON response", async () => {
      mockClient.messages.create.mockResolvedValue({
        content: [{ type: "text", text: "Invalid JSON response" }],
      });

      const extractor = new EntityExtractor(
        mockClient as unknown as Anthropic,
        mockKnowledgeStore,
        { mode: "all" },
      );

      const result = await extractor.extract(
        createMockMessage("user", "Hello"),
        createMockMessage("assistant", "Hi"),
        1,
        createTraceContext(),
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("ParseError");
      }
    });
  });

  describe("extract - persistence", () => {
    it("should persist extracted entities to knowledge store", async () => {
      mockClient.messages.create.mockResolvedValue({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              entities: [
                {
                  name: "John",
                  type: "person",
                  importance: 0.8,
                  context: "Sponsor",
                },
              ],
              relationships: [],
            }),
          },
        ],
      });

      const extractor = new EntityExtractor(
        mockClient as unknown as Anthropic,
        mockKnowledgeStore,
        { mode: "all" },
      );

      await extractor.extract(
        createMockMessage("user", "I talked to John"),
        createMockMessage("assistant", "That is great"),
        1,
        createTraceContext(),
      );

      expect(mockKnowledgeStore.upsertEntity).toHaveBeenCalled();
    });

    it("should persist relationships to knowledge store", async () => {
      mockClient.messages.create.mockResolvedValue({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              entities: [
                {
                  name: "John",
                  type: "person",
                  importance: 0.8,
                  context: "Sponsor",
                },
                {
                  name: "stress",
                  type: "trigger",
                  importance: 0.7,
                  context: "Trigger",
                },
              ],
              relationships: [
                {
                  from: "John",
                  to: "stress",
                  type: "helps_with",
                  strength: 0.6,
                },
              ],
            }),
          },
        ],
      });

      const extractor = new EntityExtractor(
        mockClient as unknown as Anthropic,
        mockKnowledgeStore,
        { mode: "all" },
      );

      await extractor.extract(
        createMockMessage("user", "John helps with stress"),
        createMockMessage("assistant", "Good"),
        1,
        createTraceContext(),
      );

      expect(mockKnowledgeStore.createRelationship).toHaveBeenCalled();
    });

    it("should skip relationship persistence when disabled", async () => {
      mockClient.messages.create.mockResolvedValue({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              entities: [
                {
                  name: "John",
                  type: "person",
                  importance: 0.8,
                  context: "Sponsor",
                },
              ],
              relationships: [],
            }),
          },
        ],
      });

      const extractor = new EntityExtractor(
        mockClient as unknown as Anthropic,
        mockKnowledgeStore,
        { mode: "all", inferRelationships: false },
      );

      await extractor.extract(
        createMockMessage("user", "John"),
        createMockMessage("assistant", "Hi"),
        1,
        createTraceContext(),
      );

      expect(mockKnowledgeStore.createRelationship).not.toHaveBeenCalled();
    });
  });

  describe("relationship name resolution", () => {
    it("should resolve partial entity names in relationships", async () => {
      // LLM returns "John Smith" as entity but "John" in relationship
      mockClient.messages.create.mockResolvedValue({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              entities: [
                {
                  name: "John Smith",
                  type: "person",
                  importance: 0.8,
                  context: "Sponsor",
                },
                {
                  name: "work stress",
                  type: "trigger",
                  importance: 0.7,
                  context: "Job related",
                },
              ],
              relationships: [
                {
                  from: "John", // Partial name - should resolve to "john smith"
                  to: "work stress",
                  type: "HELPS_WITH",
                  strength: 0.6,
                },
              ],
            }),
          },
        ],
      });

      const extractor = new EntityExtractor(
        mockClient as unknown as Anthropic,
        mockKnowledgeStore,
        { mode: "all" },
      );

      await extractor.extract(
        createMockMessage("user", "John Smith helps with work stress"),
        createMockMessage("assistant", "That's great support"),
        1,
        createTraceContext(),
      );

      // Relationship should be created with resolved names
      expect(mockKnowledgeStore.createRelationship).toHaveBeenCalledWith(
        "john smith", // Resolved from "John"
        "work stress", // Exact match
        "HELPS_WITH",
        expect.any(Object),
        expect.any(Object),
      );
    });

    it("should skip relationships when entity cannot be resolved", async () => {
      // LLM returns relationship with entity name that doesn't exist
      mockClient.messages.create.mockResolvedValue({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              entities: [
                {
                  name: "John",
                  type: "person",
                  importance: 0.8,
                  context: "Sponsor",
                },
              ],
              relationships: [
                {
                  from: "John",
                  to: "NonExistent Entity", // This entity was not extracted
                  type: "KNOWS",
                  strength: 0.5,
                },
              ],
            }),
          },
        ],
      });

      const extractor = new EntityExtractor(
        mockClient as unknown as Anthropic,
        mockKnowledgeStore,
        { mode: "all" },
      );

      await extractor.extract(
        createMockMessage("user", "John knows someone"),
        createMockMessage("assistant", "Okay"),
        1,
        createTraceContext(),
      );

      // Relationship should NOT be created because "NonExistent Entity" doesn't exist
      expect(mockKnowledgeStore.createRelationship).not.toHaveBeenCalled();
    });

    it("should handle case-insensitive name matching", async () => {
      mockClient.messages.create.mockResolvedValue({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              entities: [
                {
                  name: "GOOGLE",
                  type: "place",
                  importance: 0.8,
                  context: "Company",
                },
                {
                  name: "Alice",
                  type: "person",
                  importance: 0.7,
                  context: "Friend",
                },
              ],
              relationships: [
                {
                  from: "alice", // lowercase
                  to: "Google", // mixed case
                  type: "WORKS_AT",
                  strength: 0.9,
                },
              ],
            }),
          },
        ],
      });

      const extractor = new EntityExtractor(
        mockClient as unknown as Anthropic,
        mockKnowledgeStore,
        { mode: "all" },
      );

      await extractor.extract(
        createMockMessage("user", "Alice works at Google"),
        createMockMessage("assistant", "Nice"),
        1,
        createTraceContext(),
      );

      expect(mockKnowledgeStore.createRelationship).toHaveBeenCalledWith(
        "alice",
        "google",
        "WORKS_AT",
        expect.any(Object),
        expect.any(Object),
      );
    });
  });

  describe("sample mode", () => {
    it("should extract based on sample rate", async () => {
      // Mock Math.random to return predictable values
      const originalRandom = Math.random;
      let callCount = 0;

      mockClient.messages.create.mockResolvedValue({
        content: [
          { type: "text", text: '{"entities": [], "relationships": []}' },
        ],
      });

      const extractor = new EntityExtractor(
        mockClient as unknown as Anthropic,
        mockKnowledgeStore,
        { mode: "sample:50" },
      );

      // Run multiple extractions with controlled randomness
      Math.random = () => {
        callCount++;
        return callCount % 2 === 0 ? 0.3 : 0.7; // Alternates between < 0.5 and >= 0.5
      };

      try {
        // First call: 0.7 > 0.5 - should NOT extract
        await extractor.extract(
          createMockMessage("user", "Test 1"),
          createMockMessage("assistant", "Response 1"),
          1,
          createTraceContext(),
        );

        // Second call: 0.3 < 0.5 - should extract
        await extractor.extract(
          createMockMessage("user", "Test 2"),
          createMockMessage("assistant", "Response 2"),
          1,
          createTraceContext(),
        );

        // LLM should only be called once (for the second call)
        expect(mockClient.messages.create).toHaveBeenCalledTimes(1);
      } finally {
        Math.random = originalRandom;
      }
    });
  });

  describe("L3 Memory persistence", () => {
    let mockL3Store: {
      getL3Entity: ReturnType<typeof vi.fn>;
      upsertL3Entity: ReturnType<typeof vi.fn>;
      appendSourceHistory: ReturnType<typeof vi.fn>;
      createObservation: ReturnType<typeof vi.fn>;
      createL3Relationship: ReturnType<typeof vi.fn>;
    };

    beforeEach(() => {
      mockL3Store = {
        getL3Entity: vi.fn().mockResolvedValue(ok(null)),
        upsertL3Entity: vi.fn().mockResolvedValue(
          ok({
            id: "entity-123",
            name: "john smith",
            displayName: "John Smith",
            aliases: [],
            canonicalType: "person",
            labels: ["friend"],
            importance: 0.8,
            firstSeen: Date.now(),
            lastSeen: Date.now(),
            mentionCount: 1,
            sourceHistory: [],
            metadata: {},
          }),
        ),
        appendSourceHistory: vi.fn().mockResolvedValue(ok(undefined)),
        createObservation: vi.fn().mockResolvedValue(
          ok({
            id: "obs-123",
            content: "Works at Google",
            createdAt: Date.now(),
            conversationId: "conv_123",
            messageId: "msg_123",
            confidence: 0.9,
          }),
        ),
        createL3Relationship: vi.fn().mockResolvedValue(ok(undefined)),
      };
    });

    it("should use L3 store when provided", async () => {
      mockClient.messages.create.mockResolvedValue({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              entities: [
                {
                  name: "john smith",
                  displayName: "John Smith",
                  type: "person",
                  labels: ["friend"],
                  importance: 0.8,
                  context: "Close friend",
                },
              ],
              observations: [],
              relationships: [],
            }),
          },
        ],
      });

      const extractor = new EntityExtractor(
        mockClient as unknown as Anthropic,
        mockKnowledgeStore,
        { mode: "all" },
        { l3Store: mockL3Store as any },
      );

      await extractor.extract(
        createMockMessage("user", "John Smith is my friend"),
        createMockMessage("assistant", "Nice to hear about John"),
        1,
        createTraceContext(),
      );

      // Should use L3 store, not legacy store
      expect(mockL3Store.upsertL3Entity).toHaveBeenCalled();
      expect(mockKnowledgeStore.upsertEntity).not.toHaveBeenCalled();
    });

    it("should track source history with 'created' action for new entities", async () => {
      mockClient.messages.create.mockResolvedValue({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              entities: [
                {
                  name: "john",
                  type: "person",
                  importance: 0.8,
                  context: "New friend",
                },
              ],
              observations: [],
              relationships: [],
            }),
          },
        ],
      });

      // Entity doesn't exist
      mockL3Store.getL3Entity.mockResolvedValue(ok(null));

      const extractor = new EntityExtractor(
        mockClient as unknown as Anthropic,
        mockKnowledgeStore,
        { mode: "all" },
        { l3Store: mockL3Store as any },
      );

      await extractor.extract(
        createMockMessage("user", "I met John"),
        createMockMessage("assistant", "Great"),
        1,
        createTraceContext(),
      );

      expect(mockL3Store.appendSourceHistory).toHaveBeenCalledWith(
        "john",
        expect.objectContaining({
          action: "created",
          conversationId: "conv_123",
        }),
        expect.any(Object),
      );
    });

    it("should track source history with 'updated' action for existing entities", async () => {
      mockClient.messages.create.mockResolvedValue({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              entities: [
                {
                  name: "john",
                  type: "person",
                  importance: 0.8,
                  context: "Existing friend",
                },
              ],
              observations: [],
              relationships: [],
            }),
          },
        ],
      });

      // Entity exists
      mockL3Store.getL3Entity.mockResolvedValue(
        ok({
          id: "existing-123",
          name: "john",
          canonicalType: "person",
        }),
      );

      const extractor = new EntityExtractor(
        mockClient as unknown as Anthropic,
        mockKnowledgeStore,
        { mode: "all" },
        { l3Store: mockL3Store as any },
      );

      await extractor.extract(
        createMockMessage("user", "Saw John again"),
        createMockMessage("assistant", "Nice"),
        1,
        createTraceContext(),
      );

      expect(mockL3Store.appendSourceHistory).toHaveBeenCalledWith(
        "john",
        expect.objectContaining({
          action: "updated",
        }),
        expect.any(Object),
      );
    });

    it("should create observations as separate nodes", async () => {
      mockClient.messages.create.mockResolvedValue({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              entities: [
                {
                  name: "john",
                  type: "person",
                  importance: 0.8,
                  context: "Friend",
                },
              ],
              observations: [
                {
                  entityName: "john",
                  content: "Works at Google as an engineer",
                  confidence: 0.9,
                },
                {
                  entityName: "john",
                  content: "Lives in San Francisco",
                  confidence: 0.85,
                },
              ],
              relationships: [],
            }),
          },
        ],
      });

      const extractor = new EntityExtractor(
        mockClient as unknown as Anthropic,
        mockKnowledgeStore,
        { mode: "all" },
        { l3Store: mockL3Store as any },
      );

      await extractor.extract(
        createMockMessage("user", "John works at Google in SF"),
        createMockMessage("assistant", "Interesting"),
        1,
        createTraceContext(),
      );

      expect(mockL3Store.createObservation).toHaveBeenCalledTimes(2);
      expect(mockL3Store.createObservation).toHaveBeenCalledWith(
        "john",
        expect.objectContaining({
          content: "Works at Google as an engineer",
          confidence: 0.9,
        }),
        expect.any(Object),
      );
    });

    it("should use createL3Relationship for L3 mode", async () => {
      mockClient.messages.create.mockResolvedValue({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              entities: [
                {
                  name: "john",
                  type: "person",
                  importance: 0.8,
                  context: "Friend",
                },
                {
                  name: "google",
                  type: "organization",
                  importance: 0.7,
                  context: "Company",
                },
              ],
              observations: [],
              relationships: [
                {
                  from: "john",
                  to: "google",
                  type: "works_at",
                  strength: 0.9,
                  properties: {
                    context: "employment",
                    when: "current",
                  },
                },
              ],
            }),
          },
        ],
      });

      const extractor = new EntityExtractor(
        mockClient as unknown as Anthropic,
        mockKnowledgeStore,
        { mode: "all" },
        { l3Store: mockL3Store as any },
      );

      await extractor.extract(
        createMockMessage("user", "John works at Google"),
        createMockMessage("assistant", "Cool"),
        1,
        createTraceContext(),
      );

      expect(mockL3Store.createL3Relationship).toHaveBeenCalledWith(
        "john",
        "google",
        "works_at",
        expect.objectContaining({
          strength: 0.9,
          context: "employment",
          when: "current",
        }),
        expect.any(Object),
      );
      expect(mockKnowledgeStore.createRelationship).not.toHaveBeenCalled();
    });

    it("should filter observations for filtered-out entities", async () => {
      mockClient.messages.create.mockResolvedValue({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              entities: [
                {
                  name: "john",
                  type: "person",
                  importance: 0.8, // Above threshold
                  context: "Important",
                },
                {
                  name: "weather",
                  type: "concept",
                  importance: 0.1, // Below threshold
                  context: "Not important",
                },
              ],
              observations: [
                {
                  entityName: "john",
                  content: "Likes coffee",
                  confidence: 0.9,
                },
                {
                  entityName: "weather",
                  content: "Was sunny",
                  confidence: 0.9,
                },
              ],
              relationships: [],
            }),
          },
        ],
      });

      const extractor = new EntityExtractor(
        mockClient as unknown as Anthropic,
        mockKnowledgeStore,
        { mode: "all", minImportance: 0.3 },
        { l3Store: mockL3Store as any },
      );

      await extractor.extract(
        createMockMessage("user", "John likes coffee on sunny days"),
        createMockMessage("assistant", "Nice"),
        1,
        createTraceContext(),
      );

      // Only observation for "john" should be created
      expect(mockL3Store.createObservation).toHaveBeenCalledTimes(1);
      expect(mockL3Store.createObservation).toHaveBeenCalledWith(
        "john",
        expect.objectContaining({
          content: "Likes coffee",
        }),
        expect.any(Object),
      );
    });

    it("should map legacy types to canonical types", async () => {
      mockClient.messages.create.mockResolvedValue({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              entities: [
                {
                  name: "anxiety",
                  type: "emotion", // Legacy type
                  importance: 0.8,
                  context: "Feeling anxious",
                },
                {
                  name: "breathing",
                  type: "coping_strategy", // Legacy type
                  importance: 0.7,
                  context: "Deep breathing",
                },
              ],
              observations: [],
              relationships: [],
            }),
          },
        ],
      });

      const extractor = new EntityExtractor(
        mockClient as unknown as Anthropic,
        mockKnowledgeStore,
        { mode: "all" },
        { l3Store: mockL3Store as any },
      );

      await extractor.extract(
        createMockMessage("user", "I feel anxious but breathing helps"),
        createMockMessage("assistant", "Good strategy"),
        1,
        createTraceContext(),
      );

      // Should map to canonical types
      expect(mockL3Store.upsertL3Entity).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "anxiety",
          canonicalType: "concept", // emotion -> concept
        }),
        expect.any(Object),
      );
      expect(mockL3Store.upsertL3Entity).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "breathing",
          canonicalType: "concept", // coping_strategy -> concept
        }),
        expect.any(Object),
      );
    });
  });
});
