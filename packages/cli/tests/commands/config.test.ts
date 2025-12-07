import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock chalk
vi.mock("chalk", () => ({
  default: {
    cyan: { bold: (s: string) => s },
    gray: (s: string) => s,
    red: (s: string) => s,
    green: (s: string) => s,
  },
}));

// Create shared state for mocks - must be defined before vi.mock
const mockState = {
  getApiUrl: vi.fn(() => "http://localhost:3333"),
  setApiUrl: vi.fn(),
  getUserId: vi.fn(() => "test-user-id"),
  setUserId: vi.fn(),
  getConversationId: vi.fn(() => "test-conv-id"),
  newConversation: vi.fn(() => "new-conv-id"),
  resetConfig: vi.fn(),
};

// Mock the config module that src/commands/config.ts imports
vi.mock("../../src/config.js", () => ({
  config: { path: "/mock/config/path" },
  getApiUrl: () => mockState.getApiUrl(),
  setApiUrl: (url: string) => mockState.setApiUrl(url),
  getUserId: () => mockState.getUserId(),
  setUserId: (id: string) => mockState.setUserId(id),
  getConversationId: () => mockState.getConversationId(),
  newConversation: () => mockState.newConversation(),
  resetConfig: () => mockState.resetConfig(),
}));

// Mock console and process.exit
const originalConsole = { ...console };
const mockConsoleLog = vi.fn();
const mockExit = vi
  .spyOn(process, "exit")
  .mockImplementation(() => undefined as never);

// Import after mocks
import {
  showConfig,
  setConfigValue,
  resetConfigCommand,
  newConversationCommand,
} from "../../src/commands/config.js";

describe("config commands", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    console.log = mockConsoleLog;
  });

  afterEach(() => {
    console.log = originalConsole.log;
  });

  describe("showConfig", () => {
    it("displays current configuration", () => {
      showConfig();

      expect(mockState.getApiUrl).toHaveBeenCalled();
      expect(mockState.getUserId).toHaveBeenCalled();
      expect(mockState.getConversationId).toHaveBeenCalled();
    });

    it("shows API URL", () => {
      showConfig();

      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining("http://localhost:3333"),
      );
    });

    it("shows User ID", () => {
      showConfig();

      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining("test-user-id"),
      );
    });

    it("shows Conversation ID", () => {
      showConfig();

      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining("test-conv-id"),
      );
    });

    it("shows Config Path", () => {
      showConfig();

      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining("/mock/config/path"),
      );
    });
  });

  describe("setConfigValue", () => {
    it('sets apiUrl with "apiurl" key', () => {
      setConfigValue("apiurl", "http://new-api:5000");

      expect(mockState.setApiUrl).toHaveBeenCalledWith("http://new-api:5000");
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining("API URL set to: http://new-api:5000"),
      );
    });

    it('sets apiUrl with "api-url" key', () => {
      setConfigValue("api-url", "http://new-api:5000");

      expect(mockState.setApiUrl).toHaveBeenCalledWith("http://new-api:5000");
    });

    it('sets apiUrl with "url" key', () => {
      setConfigValue("url", "http://new-api:5000");

      expect(mockState.setApiUrl).toHaveBeenCalledWith("http://new-api:5000");
    });

    it('sets userId with "userid" key', () => {
      setConfigValue("userid", "new-user");

      expect(mockState.setUserId).toHaveBeenCalledWith("new-user");
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining("User ID set to: new-user"),
      );
    });

    it('sets userId with "user-id" key', () => {
      setConfigValue("user-id", "new-user");

      expect(mockState.setUserId).toHaveBeenCalledWith("new-user");
    });

    it('sets userId with "user" key', () => {
      setConfigValue("user", "new-user");

      expect(mockState.setUserId).toHaveBeenCalledWith("new-user");
    });

    it("is case insensitive", () => {
      setConfigValue("APIURL", "http://test:5000");

      expect(mockState.setApiUrl).toHaveBeenCalledWith("http://test:5000");
    });

    it("exits with error for unknown key", () => {
      setConfigValue("unknown", "value");

      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining("Unknown config key: unknown"),
      );
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining("Available keys: apiUrl, userId"),
      );
      expect(mockExit).toHaveBeenCalledWith(1);
    });
  });

  describe("resetConfigCommand", () => {
    it("resets configuration", () => {
      resetConfigCommand();

      expect(mockState.resetConfig).toHaveBeenCalled();
    });

    it("shows confirmation message", () => {
      resetConfigCommand();

      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining("Configuration reset to defaults"),
      );
    });

    it("displays new config after reset", () => {
      resetConfigCommand();

      // showConfig is called after reset, which calls getApiUrl, etc.
      expect(mockState.getApiUrl).toHaveBeenCalled();
      expect(mockState.getUserId).toHaveBeenCalled();
      expect(mockState.getConversationId).toHaveBeenCalled();
    });
  });

  describe("newConversationCommand", () => {
    it("creates new conversation", () => {
      newConversationCommand();

      expect(mockState.newConversation).toHaveBeenCalled();
    });

    it("shows new conversation ID", () => {
      newConversationCommand();

      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining("New conversation started: new-conv-id"),
      );
    });
  });
});
