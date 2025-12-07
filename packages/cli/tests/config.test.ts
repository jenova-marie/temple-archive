import { describe, it, expect, vi, beforeEach } from "vitest";

// Create shared state for mocks
const mockState = {
  store: new Map<string, unknown>(),
  getMock: vi.fn(),
  setMock: vi.fn(),
  clearMock: vi.fn(),
};

vi.mock("conf", () => {
  return {
    default: vi.fn(() => ({
      get: (key: string) => {
        mockState.getMock(key);
        return mockState.store.get(key);
      },
      set: (key: string, value: unknown) => {
        mockState.setMock(key, value);
        mockState.store.set(key, value);
      },
      clear: () => {
        mockState.clearMock();
        mockState.store.clear();
      },
      path: "/mock/config/path",
    })),
  };
});

// Import after mocks
import {
  config,
  getApiUrl,
  setApiUrl,
  getUserId,
  setUserId,
  getConversationId,
  newConversation,
  resetConfig,
} from "../src/config.js";

describe("config", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.store.clear();
    // Set up defaults
    mockState.store.set("apiUrl", "http://localhost:3333");
    mockState.store.set("userId", "test-user");
    mockState.store.set("conversationId", null);
  });

  describe("config object", () => {
    it("is created with Conf", () => {
      expect(config).toBeDefined();
    });

    it("has path property", () => {
      expect(config.path).toBe("/mock/config/path");
    });
  });

  describe("getApiUrl", () => {
    it("returns API URL from config", () => {
      mockState.store.set("apiUrl", "http://localhost:4000");

      const result = getApiUrl();

      expect(mockState.getMock).toHaveBeenCalledWith("apiUrl");
      expect(result).toBe("http://localhost:4000");
    });
  });

  describe("setApiUrl", () => {
    it("sets API URL in config", () => {
      setApiUrl("http://custom-api:5000");

      expect(mockState.setMock).toHaveBeenCalledWith(
        "apiUrl",
        "http://custom-api:5000",
      );
      expect(mockState.store.get("apiUrl")).toBe("http://custom-api:5000");
    });
  });

  describe("getUserId", () => {
    it("returns user ID from config", () => {
      mockState.store.set("userId", "custom-user-id");

      const result = getUserId();

      expect(mockState.getMock).toHaveBeenCalledWith("userId");
      expect(result).toBe("custom-user-id");
    });
  });

  describe("setUserId", () => {
    it("sets user ID in config", () => {
      setUserId("new-user-id");

      expect(mockState.setMock).toHaveBeenCalledWith("userId", "new-user-id");
    });
  });

  describe("getConversationId", () => {
    it("returns existing conversation ID", () => {
      mockState.store.set("conversationId", "existing-conv-id");

      const result = getConversationId();

      expect(result).toBe("existing-conv-id");
    });

    it("generates new ID when none exists", () => {
      mockState.store.set("conversationId", null);

      const result = getConversationId();

      expect(result).toMatch(/^conv_/);
    });

    it("generated ID has correct format", () => {
      mockState.store.set("conversationId", null);

      const result = getConversationId();

      // Format: conv_{base36timestamp}_{random6chars}
      expect(result).toMatch(/^conv_[a-z0-9]+_[a-z0-9]+$/);
    });
  });

  describe("newConversation", () => {
    it("creates and returns new conversation ID", () => {
      const result = newConversation();

      expect(result).toMatch(/^conv_/);
    });

    it("always generates new ID regardless of existing", () => {
      mockState.store.set("conversationId", "existing-conv");

      const result = newConversation();

      expect(result).toMatch(/^conv_/);
      expect(result).not.toBe("existing-conv");
    });
  });

  describe("resetConfig", () => {
    it("clears all config", () => {
      resetConfig();

      expect(mockState.clearMock).toHaveBeenCalled();
    });
  });
});
