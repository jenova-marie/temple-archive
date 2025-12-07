import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getDefaultPipelineConfig } from "../src/pipeline.js";

describe("getDefaultPipelineConfig", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns default config when USE_STUBS is not set", () => {
    delete process.env.USE_STUBS;
    const config = getDefaultPipelineConfig();
    expect(config.useStubs).toBe(false);
  });

  it('returns useStubs=true when USE_STUBS is "true"', () => {
    process.env.USE_STUBS = "true";
    const config = getDefaultPipelineConfig();
    expect(config.useStubs).toBe(true);
  });

  it('returns useStubs=false when USE_STUBS is "false"', () => {
    process.env.USE_STUBS = "false";
    const config = getDefaultPipelineConfig();
    expect(config.useStubs).toBe(false);
  });

  it("returns correct timeout configuration", () => {
    const config = getDefaultPipelineConfig();
    expect(config.timeoutMs).toBe(30000);
  });

  it("returns correct crisis thresholds", () => {
    const config = getDefaultPipelineConfig();
    expect(config.crisis.highThreshold).toBe(7);
    expect(config.crisis.criticalThreshold).toBe(9);
  });

  it("returns correct memory configuration", () => {
    const config = getDefaultPipelineConfig();
    expect(config.memory.l1MessageLimit).toBe(20);
    expect(config.memory.l2MessageLimit).toBe(50);
    expect(config.memory.semanticSearchDays).toBe(90);
  });

  it("returns correct agent configuration", () => {
    const config = getDefaultPipelineConfig();
    expect(config.agent.model).toBe("claude-sonnet-4-20250514");
    expect(config.agent.maxTokens).toBe(4096);
    expect(config.agent.temperature).toBe(0.7);
  });

  it("returns a new object on each call", () => {
    const config1 = getDefaultPipelineConfig();
    const config2 = getDefaultPipelineConfig();
    expect(config1).not.toBe(config2);
    expect(config1).toEqual(config2);
  });
});
