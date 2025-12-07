import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  isProduction,
  isTest,
  isTracingEnabled,
  isMetricsEnabled,
  getServiceName,
  getServiceVersion,
} from "../src/config.js";

describe("config utilities", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("isProduction", () => {
    it("returns true when NODE_ENV is production", () => {
      process.env.NODE_ENV = "production";
      expect(isProduction()).toBe(true);
    });

    it("returns false when NODE_ENV is development", () => {
      process.env.NODE_ENV = "development";
      expect(isProduction()).toBe(false);
    });

    it("returns false when NODE_ENV is not set", () => {
      delete process.env.NODE_ENV;
      expect(isProduction()).toBe(false);
    });
  });

  describe("isTest", () => {
    it("returns true when NODE_ENV is test", () => {
      process.env.NODE_ENV = "test";
      delete process.env.VITEST;
      expect(isTest()).toBe(true);
    });

    it("returns true when VITEST is true", () => {
      process.env.NODE_ENV = "development";
      process.env.VITEST = "true";
      expect(isTest()).toBe(true);
    });

    it("returns false when neither test nor vitest", () => {
      process.env.NODE_ENV = "development";
      delete process.env.VITEST;
      expect(isTest()).toBe(false);
    });
  });

  describe("isTracingEnabled", () => {
    it("returns false in test mode by default", () => {
      process.env.NODE_ENV = "test";
      delete process.env.ENABLE_TRACING;
      expect(isTracingEnabled()).toBe(false);
    });

    it("returns true in test mode when ENABLE_TRACING is true", () => {
      process.env.NODE_ENV = "test";
      process.env.ENABLE_TRACING = "true";
      expect(isTracingEnabled()).toBe(true);
    });

    it("returns true in non-test mode by default", () => {
      process.env.NODE_ENV = "development";
      delete process.env.VITEST;
      delete process.env.OTEL_ENABLED;
      expect(isTracingEnabled()).toBe(true);
    });

    it("returns false when OTEL_ENABLED is false", () => {
      process.env.NODE_ENV = "development";
      delete process.env.VITEST;
      process.env.OTEL_ENABLED = "false";
      expect(isTracingEnabled()).toBe(false);
    });
  });

  describe("isMetricsEnabled", () => {
    it("returns false in test mode by default", () => {
      process.env.NODE_ENV = "test";
      delete process.env.ENABLE_METRICS;
      expect(isMetricsEnabled()).toBe(false);
    });

    it("returns true in test mode when ENABLE_METRICS is true", () => {
      process.env.NODE_ENV = "test";
      process.env.ENABLE_METRICS = "true";
      expect(isMetricsEnabled()).toBe(true);
    });

    it("returns true in non-test mode by default", () => {
      process.env.NODE_ENV = "development";
      delete process.env.VITEST;
      delete process.env.OTEL_METRICS_ENABLED;
      expect(isMetricsEnabled()).toBe(true);
    });

    it("returns false when OTEL_METRICS_ENABLED is false", () => {
      process.env.NODE_ENV = "development";
      delete process.env.VITEST;
      process.env.OTEL_METRICS_ENABLED = "false";
      expect(isMetricsEnabled()).toBe(false);
    });
  });

  describe("getServiceName", () => {
    it("returns SERVICE_NAME env var when set", () => {
      process.env.SERVICE_NAME = "my-custom-service";
      expect(getServiceName()).toBe("my-custom-service");
    });

    it("returns default when SERVICE_NAME is not set", () => {
      delete process.env.SERVICE_NAME;
      expect(getServiceName()).toBe("recoverysky-agent");
    });
  });

  describe("getServiceVersion", () => {
    it("returns SERVICE_VERSION env var when set", () => {
      process.env.SERVICE_VERSION = "1.2.3";
      expect(getServiceVersion()).toBe("1.2.3");
    });

    it("returns default when SERVICE_VERSION is not set", () => {
      delete process.env.SERVICE_VERSION;
      expect(getServiceVersion()).toBe("0.1.0");
    });
  });
});
