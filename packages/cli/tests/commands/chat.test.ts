import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock chalk to return strings
vi.mock("chalk", () => ({
  default: {
    cyan: Object.assign((s: string) => s, { bold: (s: string) => s }),
    gray: (s: string) => s,
    red: Object.assign((s: string) => s, { bold: (s: string) => s }),
    yellow: (s: string) => s,
    blue: (s: string) => s,
    green: (s: string) => s,
    white: { bold: (s: string) => s },
  },
}));

// Mock ora
const mockSpinner = {
  start: vi.fn().mockReturnThis(),
  stop: vi.fn(),
  succeed: vi.fn(),
  fail: vi.fn(),
};
vi.mock("ora", () => ({
  default: vi.fn(() => mockSpinner),
}));

// Mock api module that src/commands/chat.ts imports
vi.mock("../../src/api.js", () => ({
  sendMessage: vi.fn(),
}));

// Mock config module that src/commands/chat.ts imports
vi.mock("../../src/config.js", () => ({
  getConversationId: vi.fn(() => "test-conv-id"),
  getUserId: vi.fn(() => "test-user-id"),
  newConversation: vi.fn(() => "new-conv-id"),
}));

// Mock console
const originalConsole = { ...console };
const mockConsoleLog = vi.fn();
const mockConsoleError = vi.fn();

// Mock process.exit
const mockExit = vi
  .spyOn(process, "exit")
  .mockImplementation(() => undefined as never);

// Import after mocks
import { chatCommand } from "../../src/commands/chat.js";
import type { ChatOptions } from "../../src/commands/chat.js";
import { sendMessage } from "../../src/api.js";
import type { ChatResponse } from "../../src/api.js";
import type { Mock } from "vitest";

// Ensure types are used (prevents TS6133)
const _typeCheck: { opt: ChatOptions } | null = null;
void _typeCheck;

describe("chat command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    console.log = mockConsoleLog;
    console.error = mockConsoleError;
  });

  afterEach(() => {
    console.log = originalConsole.log;
    console.error = originalConsole.error;
  });

  const createMockResponse = (
    overrides: Partial<ChatResponse> = {},
  ): ChatResponse => ({
    response: "Hello! How can I help?",
    conversationId: "test-conv-id",
    ...overrides,
  });

  describe("chatCommand", () => {
    it("starts spinner when sending message", async () => {
      (sendMessage as Mock).mockResolvedValue(
        createMockResponse(),
      );

      await chatCommand("Hello", {});

      expect(mockSpinner.start).toHaveBeenCalled();
    });

    it("stops spinner after response", async () => {
      (sendMessage as Mock).mockResolvedValue(
        createMockResponse(),
      );

      await chatCommand("Hello", {});

      expect(mockSpinner.stop).toHaveBeenCalled();
    });

    it("displays response text", async () => {
      (sendMessage as Mock).mockResolvedValue(
        createMockResponse({ response: "Test response" }),
      );

      await chatCommand("Hello", {});

      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining("Sky:"),
        "Test response",
      );
    });

    it("shows conversation ID with --verbose flag", async () => {
      (sendMessage as Mock).mockResolvedValue(
        createMockResponse({ conversationId: "verbose-conv-123" }),
      );

      await chatCommand("Hello", { verbose: true });

      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining("Conversation: verbose-conv-123"),
      );
    });

    it("handles API errors", async () => {
      (sendMessage as Mock).mockRejectedValue(
        new Error("API failed"),
      );

      await chatCommand("Hello", {});

      expect(mockSpinner.fail).toHaveBeenCalledWith("Failed to send message");
      expect(mockConsoleError).toHaveBeenCalledWith("API failed");
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it("calls sendMessage with the provided message", async () => {
      (sendMessage as Mock).mockResolvedValue(
        createMockResponse(),
      );

      await chatCommand("Test message", {});

      expect(sendMessage).toHaveBeenCalledWith("Test message");
    });
  });
});
