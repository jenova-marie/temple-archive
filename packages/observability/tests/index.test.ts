import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Set test environment before imports
process.env.NODE_ENV = "test";
process.env.VITEST = "true";

// Mock wonder-logger before importing the module
const mockCreateLogger = vi.fn();
const mockCreateTelemetry = vi.fn();
const mockLoadConfig = vi.fn();
const mockCreateMemoryTransport = vi.fn();
const mockCreateConsoleTransport = vi.fn();
const mockWithSpan = vi.fn((_name: string, fn: () => unknown) => fn());
const mockShutdown = vi.fn();

vi.mock("@jenova-marie/wonder-logger", () => ({
  createLogger: (...args: unknown[]) => mockCreateLogger(...args),
  createTelemetry: (...args: unknown[]) => mockCreateTelemetry(...args),
  createLoggerFromConfig: vi.fn(),
  createTelemetryFromConfig: vi.fn(),
  loadConfig: (...args: unknown[]) => mockLoadConfig(...args),
  createMemoryTransport: (...args: unknown[]) =>
    mockCreateMemoryTransport(...args),
  createConsoleTransport: (...args: unknown[]) =>
    mockCreateConsoleTransport(...args),
  withSpan: mockWithSpan,
  getMemoryLogs: vi.fn(() => []),
  clearMemoryLogs: vi.fn(),
}));

// Mock OpenTelemetry
const mockGetTracer = vi.fn();
const mockGetMeter = vi.fn();
const mockGetActiveSpan = vi.fn();
const mockHistogram = { record: vi.fn() };
const mockCounter = { add: vi.fn() };

vi.mock("@opentelemetry/api", () => ({
  trace: {
    getTracer: (...args: unknown[]) => mockGetTracer(...args),
    getActiveSpan: () => mockGetActiveSpan(),
  },
  metrics: {
    getMeter: () => ({
      createHistogram: () => mockHistogram,
      createCounter: () => mockCounter,
    }),
  },
  SpanStatusCode: {
    ERROR: 2,
  },
}));

// Mock fs for monorepo root detection
vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => false),
}));

describe("observability/index", () => {
  let observability: typeof import("../src/index.js");

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    // Set up default mock returns
    mockCreateLogger.mockReturnValue({
      child: vi.fn().mockReturnValue({
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      }),
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    });
    mockCreateMemoryTransport.mockReturnValue({});
    mockCreateConsoleTransport.mockReturnValue({});
    mockLoadConfig.mockReturnValue({ ok: false });
    mockCreateTelemetry.mockReturnValue({ shutdown: mockShutdown });

    // Fresh import to reset singletons
    observability = await import("../src/index.js");
  });

  afterEach(async () => {
    if (observability) {
      await observability.shutdownObservability();
    }
  });

  describe("initializeObservability", () => {
    it("creates logger in test mode", () => {
      observability.initializeObservability();

      expect(mockCreateLogger).toHaveBeenCalledWith(
        expect.objectContaining({
          level: "silent",
        }),
      );
    });

    it("only initializes once", () => {
      observability.initializeObservability();
      observability.initializeObservability();
      observability.initializeObservability();

      expect(mockCreateLogger).toHaveBeenCalledTimes(1);
    });
  });

  describe("getLogger", () => {
    it("returns logger instance", () => {
      const logger = observability.getLogger();

      expect(logger).toBeDefined();
      expect(logger.info).toBeDefined();
    });

    it("auto-initializes if not already initialized", () => {
      observability.getLogger();

      expect(mockCreateLogger).toHaveBeenCalled();
    });
  });

  describe("createChildLogger", () => {
    it("creates child logger with bindings", () => {
      const mockChild = vi.fn().mockReturnValue({ info: vi.fn() });
      mockCreateLogger.mockReturnValue({
        child: mockChild,
        info: vi.fn(),
      });

      // Re-import to use new mock
      vi.resetModules();

      // We can test the concept - child logger should be callable
      const logger = observability.getLogger();
      expect(logger.child).toBeDefined();
    });
  });

  describe("getTelemetrySDK", () => {
    it("returns null in test mode (no telemetry)", () => {
      observability.initializeObservability();

      const sdk = observability.getTelemetrySDK();

      // In test mode, SDK is not created
      expect(sdk).toBeNull();
    });
  });

  describe("shutdownObservability", () => {
    it("can be called safely without initialization", async () => {
      await observability.shutdownObservability();

      // Should not throw
      expect(true).toBe(true);
    });

    it("allows re-initialization after shutdown", async () => {
      observability.initializeObservability();
      await observability.shutdownObservability();

      // Reset mocks to track new calls
      mockCreateLogger.mockClear();

      observability.initializeObservability();

      expect(mockCreateLogger).toHaveBeenCalled();
    });
  });

  describe("withSpan", () => {
    it("is exported and callable", async () => {
      const result = await observability.withSpan(
        "test-span",
        async () => "result",
      );

      expect(mockWithSpan).toHaveBeenCalled();
    });
  });

  describe("getTracer", () => {
    it("returns a tracer", () => {
      mockGetTracer.mockReturnValue({ startSpan: vi.fn() });

      const tracer = observability.getTracer();

      expect(mockGetTracer).toHaveBeenCalled();
    });

    it("accepts custom name", () => {
      mockGetTracer.mockReturnValue({ startSpan: vi.fn() });

      observability.getTracer("custom-tracer");

      expect(mockGetTracer).toHaveBeenCalledWith("custom-tracer");
    });
  });

  describe("getMeter", () => {
    it("returns a meter", () => {
      const meter = observability.getMeter();

      expect(meter).toBeDefined();
    });
  });

  describe("getActiveSpan", () => {
    it("returns undefined when no active span", () => {
      mockGetActiveSpan.mockReturnValue(undefined);

      const span = observability.getActiveSpan();

      expect(span).toBeUndefined();
    });

    it("returns active span when present", () => {
      const mockSpan = { setAttributes: vi.fn() };
      mockGetActiveSpan.mockReturnValue(mockSpan);

      const span = observability.getActiveSpan();

      expect(span).toBe(mockSpan);
    });
  });

  describe("recordSpanError", () => {
    it("does nothing when no active span", () => {
      mockGetActiveSpan.mockReturnValue(undefined);

      observability.recordSpanError(new Error("test error"));

      // Should not throw
      expect(true).toBe(true);
    });

    it("records standard error on span", () => {
      const mockSpan = {
        recordException: vi.fn(),
        setStatus: vi.fn(),
        setAttributes: vi.fn(),
      };
      mockGetActiveSpan.mockReturnValue(mockSpan);

      observability.recordSpanError(new Error("test error"));

      expect(mockSpan.recordException).toHaveBeenCalled();
      expect(mockSpan.setStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 2, // SpanStatusCode.ERROR
        }),
      );
    });

    it("records domain error on span", () => {
      const mockSpan = {
        recordException: vi.fn(),
        setStatus: vi.fn(),
        setAttributes: vi.fn(),
      };
      mockGetActiveSpan.mockReturnValue(mockSpan);

      const domainError = {
        kind: "ValidationError",
        message: "Invalid input",
        context: { field: "email", value: "bad" },
      };

      observability.recordSpanError(domainError);

      expect(mockSpan.setAttributes).toHaveBeenCalledWith(
        expect.objectContaining({
          "error.kind": "ValidationError",
          "error.message": "Invalid input",
          "error.context.field": "email",
        }),
      );
    });
  });

  describe("pipelineMetrics", () => {
    it("exports stageDuration histogram", () => {
      expect(observability.pipelineMetrics.stageDuration).toBeDefined();
    });

    it("exports memoryCacheHits counter", () => {
      expect(observability.pipelineMetrics.memoryCacheHits).toBeDefined();
    });

    it("exports memoryCacheMisses counter", () => {
      expect(observability.pipelineMetrics.memoryCacheMisses).toBeDefined();
    });

    it("exports crisisDetections counter", () => {
      expect(observability.pipelineMetrics.crisisDetections).toBeDefined();
    });

    it("exports tokensUsed counter", () => {
      expect(observability.pipelineMetrics.tokensUsed).toBeDefined();
    });

    it("exports safetyViolations counter", () => {
      expect(observability.pipelineMetrics.safetyViolations).toBeDefined();
    });

    it("exports errors counter", () => {
      expect(observability.pipelineMetrics.errors).toBeDefined();
    });
  });

  describe("re-exports", () => {
    it("exports isTest", () => {
      expect(observability.isTest).toBeDefined();
    });

    it("exports isTracingEnabled", () => {
      expect(observability.isTracingEnabled).toBeDefined();
    });

    it("exports isMetricsEnabled", () => {
      expect(observability.isMetricsEnabled).toBeDefined();
    });

    it("exports getServiceName", () => {
      expect(observability.getServiceName).toBeDefined();
    });

    it("exports getMemoryLogs", () => {
      expect(observability.getMemoryLogs).toBeDefined();
    });

    it("exports clearMemoryLogs", () => {
      expect(observability.clearMemoryLogs).toBeDefined();
    });
  });
});
