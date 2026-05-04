/**
 * searchKnowledge — sourceUrl + members construction.
 *
 * Verifies the formatter:
 *   - builds Discord deep links from hydrated guild/channel/thread/msg
 *     (no env var, no setter)
 *   - routes thread messages through `thread_id`, not `channel_id`
 *   - exposes a `members` array on group hits with per-member URLs so
 *     the archivist can pinpoint the exact message a quote came from
 *   - degrades gracefully (sourceUrl: null) when info is missing
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
const THREAD = "555555555555555555";
const MESSAGE_A = "333333333333333333";
const MESSAGE_B = "666666666666666666";
const MESSAGE_C = "777777777777777777";

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

interface Member {
  messageId: string | null;
  position: number | null;
  author: string | null;
  content: string | null;
  sourceUrl: string | null;
}

interface FormattedHit {
  id: string;
  type: string;
  channelId: string | null;
  threadId: string | null;
  sourceUrl: string | null;
  members?: Member[];
  [k: string]: unknown;
}

interface ToolResponse {
  success: boolean;
  results: FormattedHit[];
  count?: number;
  message: string;
}

async function run(): Promise<ToolResponse> {
  const exec = searchKnowledge.execute as unknown as (
    a: typeof ARGS,
  ) => Promise<ToolResponse>;
  return await exec(ARGS);
}

describe("searchKnowledge — sourceUrl + members", () => {
  beforeEach(() => {
    setRagToolTraceContext(TRACE);
  });

  afterEach(() => {
    clearRagToolTraceContext();
  });

  it("builds a deep link for a channel-rooted message hit", async () => {
    setRagToolStore(
      new FakeStore([
        {
          scopeType: "message",
          scopeId: MESSAGE_A,
          score: 0.9,
          payload: {},
          hydrated: {
            id: MESSAGE_A,
            channel_id: CHANNEL,
            thread_id: null,
            guild_id: GUILD,
            content: "...",
            author: "siri",
          },
        },
      ]),
    );

    const out = await run();
    expect(out.results[0]?.sourceUrl).toBe(
      `https://discord.com/channels/${GUILD}/${CHANNEL}/${MESSAGE_A}`,
    );
    expect(out.results[0]?.threadId).toBeNull();
  });

  it("routes thread messages through thread_id, not channel_id", async () => {
    setRagToolStore(
      new FakeStore([
        {
          scopeType: "message",
          scopeId: MESSAGE_A,
          score: 0.9,
          payload: {},
          hydrated: {
            id: MESSAGE_A,
            channel_id: CHANNEL,
            thread_id: THREAD,
            guild_id: GUILD,
            content: "...",
            author: "siri",
          },
        },
      ]),
    );

    const out = await run();
    // Discord URLs for thread messages use the thread snowflake as the
    // channel segment — using channel_id would land on the parent forum.
    expect(out.results[0]?.sourceUrl).toBe(
      `https://discord.com/channels/${GUILD}/${THREAD}/${MESSAGE_A}`,
    );
  });

  it("emits a members array with per-member URLs for group hits", async () => {
    setRagToolStore(
      new FakeStore([
        {
          scopeType: "group",
          scopeId: "11111111-1111-1111-1111-111111111111",
          score: 0.85,
          payload: { summary: "teaching" },
          hydrated: {
            id: "11111111-1111-1111-1111-111111111111",
            channel_id: CHANNEL,
            thread_id: null,
            guild_id: GUILD,
            summary: "teaching",
            members: [
              {
                messageId: MESSAGE_A,
                position: 0,
                author: "siri",
                content: "first line",
                createdAt: "2025-01-01T00:00:00Z",
                threadId: null,
              },
              {
                messageId: MESSAGE_B,
                position: 1,
                author: "siri",
                content: "the actual quoted line lives here",
                createdAt: "2025-01-01T00:00:30Z",
                threadId: null,
              },
              {
                messageId: MESSAGE_C,
                position: 2,
                author: "jenova",
                content: "tail",
                createdAt: "2025-01-01T00:01:00Z",
                threadId: null,
              },
            ],
          },
        },
      ]),
    );

    const out = await run();
    const hit = out.results[0]!;
    expect(hit.members).toHaveLength(3);
    expect(hit.members?.[1]?.sourceUrl).toBe(
      `https://discord.com/channels/${GUILD}/${CHANNEL}/${MESSAGE_B}`,
    );
    // Group-level fallback points at first member.
    expect(hit.sourceUrl).toBe(
      `https://discord.com/channels/${GUILD}/${CHANNEL}/${MESSAGE_A}`,
    );
  });

  it("uses thread_id when group lives in a thread", async () => {
    setRagToolStore(
      new FakeStore([
        {
          scopeType: "group",
          scopeId: "22222222-2222-2222-2222-222222222222",
          score: 0.7,
          payload: { summary: "..." },
          hydrated: {
            id: "22222222-2222-2222-2222-222222222222",
            channel_id: CHANNEL,
            thread_id: THREAD,
            guild_id: GUILD,
            summary: "...",
            members: [
              {
                messageId: MESSAGE_A,
                position: 0,
                author: "siri",
                content: "thread message",
                createdAt: "2025-01-01T00:00:00Z",
                threadId: THREAD,
              },
            ],
          },
        },
      ]),
    );

    const out = await run();
    expect(out.results[0]?.threadId).toBe(THREAD);
    expect(out.results[0]?.members?.[0]?.sourceUrl).toBe(
      `https://discord.com/channels/${GUILD}/${THREAD}/${MESSAGE_A}`,
    );
  });

  it("falls back to channel-only group URL when members array is empty", async () => {
    setRagToolStore(
      new FakeStore([
        {
          scopeType: "group",
          scopeId: "33333333-3333-3333-3333-333333333333",
          score: 0.6,
          payload: { summary: "..." },
          hydrated: {
            id: "33333333-3333-3333-3333-333333333333",
            channel_id: CHANNEL,
            thread_id: null,
            guild_id: GUILD,
            summary: "...",
            members: [],
          },
        },
      ]),
    );

    const out = await run();
    expect(out.results[0]?.members).toEqual([]);
    expect(out.results[0]?.sourceUrl).toBe(
      `https://discord.com/channels/${GUILD}/${CHANNEL}`,
    );
  });

  it("returns sourceUrl null when guild_id is missing", async () => {
    setRagToolStore(
      new FakeStore([
        {
          scopeType: "message",
          scopeId: MESSAGE_A,
          score: 0.9,
          payload: { channel_id: CHANNEL },
          hydrated: {
            id: MESSAGE_A,
            channel_id: CHANNEL,
            thread_id: null,
            guild_id: null,
            content: "x",
          },
        },
      ]),
    );

    const out = await run();
    expect(out.results[0]?.sourceUrl).toBeNull();
  });
});
