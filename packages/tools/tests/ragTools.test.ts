/**
 * searchKnowledge — sourceUrl construction.
 *
 * Verifies the formatter attaches a Discord deep link to each hit when
 * a guild ID is configured, and gracefully degrades to null / channel-
 * only links when info is missing. The archivist prompt relies on
 * `sourceUrl` being either a complete URL or null — half-built links
 * would mislead the model.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ok, type Result, type TraceContext } from "@siri/types";
import type {
  IRagStore,
  RagError,
  RagQueryOptions,
  RagResult,
  RagStats,
} from "@siri/rag";
import {
  searchKnowledge,
  setRagToolStore,
  setRagToolDiscordGuildId,
  setRagToolTraceContext,
  clearRagToolTraceContext,
} from "../src/ragTools.js";

vi.mock("@siri/observability", () => ({
  getLogger: () => ({
    child: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  }),
  withSpan: (_name: string, fn: () => Promise<unknown>) => fn(),
}));

const GUILD = "111111111111111111";
const CHANNEL = "222222222222222222";
const MESSAGE = "333333333333333333";
const FIRST_MESSAGE = "444444444444444444";

class FakeStore implements IRagStore {
  constructor(private readonly results: RagResult[]) {}
  async query(
    _opts: RagQueryOptions,
    _ctx: TraceContext,
  ): Promise<Result<RagResult[], RagError>> {
    return ok(this.results);
  }
  async getStats(_ctx: TraceContext): Promise<Result<RagStats, RagError>> {
    return ok({ qdrant: { messagesCollection: 0, groupsCollection: 0 } });
  }
}

const TRACE: TraceContext = {
  traceId: "t",
  spanId: "s",
  requestId: "r",
  userId: "u",
  startTime: Date.now(),
};

const ARGS = { query: "what did Siri say about courage" };

interface FormattedHit {
  id: string;
  type: string;
  channelId: string | null;
  sourceUrl: string | null;
  [k: string]: unknown;
}

interface ToolResponse {
  success: boolean;
  results: FormattedHit[];
  count?: number;
  message: string;
}

async function run(): Promise<ToolResponse> {
  // The Vercel AI SDK's tool().execute signature carries a second
  // toolCallOptions arg; the runtime tolerates omission in our flow
  // since none of the helpers consume it. Cast through unknown so the
  // tests stay terse.
  const exec = searchKnowledge.execute as unknown as (
    a: typeof ARGS,
  ) => Promise<ToolResponse>;
  return await exec(ARGS);
}

describe("searchKnowledge — sourceUrl", () => {
  beforeEach(() => {
    setRagToolTraceContext(TRACE);
    setRagToolDiscordGuildId(undefined);
  });

  afterEach(() => {
    clearRagToolTraceContext();
  });

  it("builds a deep link for a message hit when guildId is set", async () => {
    setRagToolDiscordGuildId(GUILD);
    setRagToolStore(
      new FakeStore([
        {
          scopeType: "message",
          scopeId: MESSAGE,
          score: 0.9,
          payload: { channel_id: CHANNEL },
          hydrated: { id: MESSAGE, content: "...", author: "siri" },
        },
      ]),
    );

    const out = await run();
    expect(out.success).toBe(true);
    expect(out.results[0]?.sourceUrl).toBe(
      `https://discord.com/channels/${GUILD}/${CHANNEL}/${MESSAGE}`,
    );
  });

  it("uses first_message_id for a group hit", async () => {
    setRagToolDiscordGuildId(GUILD);
    setRagToolStore(
      new FakeStore([
        {
          scopeType: "group",
          scopeId: "11111111-1111-1111-1111-111111111111",
          score: 0.85,
          payload: { channel_id: CHANNEL, summary: "teaching" },
          hydrated: {
            id: "11111111-1111-1111-1111-111111111111",
            channel_id: CHANNEL,
            summary: "teaching",
            first_message_id: FIRST_MESSAGE,
          },
        },
      ]),
    );

    const out = await run();
    expect(out.results[0]?.sourceUrl).toBe(
      `https://discord.com/channels/${GUILD}/${CHANNEL}/${FIRST_MESSAGE}`,
    );
  });

  it("falls back to a channel-only link when group has no first_message_id", async () => {
    setRagToolDiscordGuildId(GUILD);
    setRagToolStore(
      new FakeStore([
        {
          scopeType: "group",
          scopeId: "22222222-2222-2222-2222-222222222222",
          score: 0.7,
          payload: { channel_id: CHANNEL, summary: "..." },
          hydrated: {
            id: "22222222-2222-2222-2222-222222222222",
            channel_id: CHANNEL,
            summary: "...",
            first_message_id: null,
          },
        },
      ]),
    );

    const out = await run();
    expect(out.results[0]?.sourceUrl).toBe(
      `https://discord.com/channels/${GUILD}/${CHANNEL}`,
    );
  });

  it("returns sourceUrl null when guildId is unset", async () => {
    setRagToolDiscordGuildId(undefined);
    setRagToolStore(
      new FakeStore([
        {
          scopeType: "message",
          scopeId: MESSAGE,
          score: 0.9,
          payload: { channel_id: CHANNEL },
          hydrated: { id: MESSAGE, content: "x" },
        },
      ]),
    );

    const out = await run();
    expect(out.results[0]?.sourceUrl).toBeNull();
  });

  it("returns sourceUrl null when channelId is missing", async () => {
    setRagToolDiscordGuildId(GUILD);
    setRagToolStore(
      new FakeStore([
        {
          scopeType: "message",
          scopeId: MESSAGE,
          score: 0.9,
          payload: {},
          hydrated: { id: MESSAGE, content: "x" },
        },
      ]),
    );

    const out = await run();
    expect(out.results[0]?.sourceUrl).toBeNull();
  });

  it("treats empty-string guildId as unset", async () => {
    setRagToolDiscordGuildId("   ");
    setRagToolStore(
      new FakeStore([
        {
          scopeType: "message",
          scopeId: MESSAGE,
          score: 0.9,
          payload: { channel_id: CHANNEL },
          hydrated: { id: MESSAGE, content: "x" },
        },
      ]),
    );

    const out = await run();
    expect(out.results[0]?.sourceUrl).toBeNull();
  });
});
