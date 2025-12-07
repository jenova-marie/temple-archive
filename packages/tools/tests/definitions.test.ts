import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  findMeetings,
  getLiveMeetings,
  logMood,
  getCrisisResources,
  getResources,
  recoveryTools,
} from "../src/definitions.js";
import { resetMeetingClient } from "../src/clients/meetingClient.js";

// Mock observability
vi.mock("@recoverysky/observability", () => ({
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

// Mock fetch for meeting API calls
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("tools/definitions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMeetingClient();
  });

  afterEach(() => {
    resetMeetingClient();
  });

  describe("findMeetings", () => {
    it("has correct description", () => {
      expect(findMeetings.description).toContain("AA");
      expect(findMeetings.description).toContain("NA");
      expect(findMeetings.description).toContain("CMA");
      expect(findMeetings.description).toContain("RD");
    });

    it("returns live meetings when when=now", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            timestamp: "2025-12-07T12:00:00Z",
            count: 2,
            liveCount: 2,
            meetings: [
              {
                id: "1",
                name: "AA Meeting",
                fellowship: "AA",
                url: "https://zoom.us/j/123",
              },
              {
                id: "2",
                name: "NA Meeting",
                fellowship: "NA",
                location: "Community Center",
              },
            ],
          }),
      });

      const result = await findMeetings.execute({
        fellowship: "all",
        when: "now",
        format: "both",
        timezone: "America/New_York",
      });

      expect(result.success).toBe(true);
      expect(result.source).toBe("live");
      expect(result.meetings).toHaveLength(2);
    });

    it("returns scheduled meetings when when=today", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            timezone: "America/New_York",
            range: {
              start: "2025-12-07T00:00:00Z",
              end: "2025-12-07T23:59:59Z",
            },
            count: 3,
            meetings: [
              {
                id: "1",
                name: "Morning AA",
                fellowship: "AA",
                trex: { hour: 7, minute: 0, dow: 1 },
              },
              {
                id: "2",
                name: "Noon NA",
                fellowship: "NA",
                trex: { hour: 12, minute: 0, dow: 1 },
              },
              {
                id: "3",
                name: "Evening CMA",
                fellowship: "CMA",
                trex: { hour: 19, minute: 30, dow: 1 },
              },
            ],
          }),
      });

      const result = await findMeetings.execute({
        fellowship: "all",
        when: "today",
        format: "both",
        timezone: "America/New_York",
      });

      expect(result.success).toBe(true);
      expect(result.source).toBe("schedule");
      expect(result.meetings).toHaveLength(3);
    });

    it("filters by fellowship", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            count: 2,
            liveCount: 2,
            meetings: [
              { id: "1", name: "AA Meeting", fellowship: "AA" },
              { id: "2", name: "NA Meeting", fellowship: "NA" },
            ],
          }),
      });

      const result = await findMeetings.execute({
        fellowship: "aa",
        when: "now",
        format: "both",
        timezone: "America/New_York",
      });

      expect(result.success).toBe(true);
      expect(result.meetings).toHaveLength(1);
      expect(result.meetings[0].fellowship).toBe("AA");
    });

    it("filters by format (online)", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            count: 2,
            liveCount: 2,
            meetings: [
              {
                id: "1",
                name: "Online AA",
                fellowship: "AA",
                url: "https://zoom.us/j/123",
              },
              {
                id: "2",
                name: "In-Person NA",
                fellowship: "NA",
                location: "Community Center",
              },
            ],
          }),
      });

      const result = await findMeetings.execute({
        fellowship: "all",
        when: "now",
        format: "online",
        timezone: "America/New_York",
      });

      expect(result.success).toBe(true);
      expect(result.meetings).toHaveLength(1);
      expect(result.meetings[0].format).toBe("online");
    });

    it("handles API errors gracefully", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        json: () => Promise.resolve({ message: "Database error" }),
      });

      const result = await findMeetings.execute({
        fellowship: "all",
        when: "now",
        format: "both",
        timezone: "America/New_York",
      });

      expect(result.success).toBe(false);
      expect(result.meetings).toHaveLength(0);
      expect(result.error).toBeDefined();
      expect(result.message).toContain("Unable to fetch");
    });

    it("handles network errors gracefully", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const result = await findMeetings.execute({
        fellowship: "all",
        when: "now",
        format: "both",
        timezone: "America/New_York",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Network error");
    });

    it("formats meeting time correctly", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            count: 1,
            liveCount: 1,
            meetings: [
              {
                id: "1",
                name: "Evening AA",
                fellowship: "AA",
                trex: { hour: 19, minute: 30, dow: 2 },
              },
            ],
          }),
      });

      const result = await findMeetings.execute({
        fellowship: "all",
        when: "now",
        format: "both",
        timezone: "America/New_York",
      });

      expect(result.meetings[0].time).toBe("7:30 PM");
      expect(result.meetings[0].day).toBe("Tuesday");
    });

    it("returns appropriate message for empty results", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            count: 0,
            liveCount: 0,
            meetings: [],
          }),
      });

      const result = await findMeetings.execute({
        fellowship: "aa",
        when: "now",
        format: "both",
        timezone: "America/New_York",
      });

      expect(result.success).toBe(true);
      expect(result.meetings).toHaveLength(0);
      expect(result.message).toContain("No");
      expect(result.message).toContain("AA");
    });
  });

  describe("getLiveMeetings", () => {
    it("has correct description", () => {
      expect(getLiveMeetings.description).toContain("RIGHT NOW");
    });

    it("returns live meetings", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            timestamp: "2025-12-07T12:00:00Z",
            count: 2,
            liveCount: 2,
            meetings: [
              { id: "1", name: "AA Meeting", fellowship: "AA" },
              { id: "2", name: "NA Meeting", fellowship: "NA" },
            ],
          }),
      });

      const result = await getLiveMeetings.execute({ fellowship: "all" });

      expect(result.success).toBe(true);
      expect(result.meetings).toHaveLength(2);
      expect(result.timestamp).toBeDefined();
    });

    it("filters by fellowship", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            count: 2,
            liveCount: 2,
            meetings: [
              { id: "1", name: "AA Meeting", fellowship: "AA" },
              { id: "2", name: "NA Meeting", fellowship: "NA" },
            ],
          }),
      });

      const result = await getLiveMeetings.execute({ fellowship: "na" });

      expect(result.meetings).toHaveLength(1);
      expect(result.meetings[0].fellowship).toBe("NA");
    });

    it("handles errors gracefully", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Connection refused"));

      const result = await getLiveMeetings.execute({ fellowship: "all" });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Connection refused");
    });
  });

  describe("logMood", () => {
    it("has correct description", () => {
      expect(logMood.description).toContain("mood");
    });

    it("logs mood successfully", async () => {
      const result = await logMood.execute({ mood: "good" });

      expect(result.success).toBe(true);
      expect(result.entry.mood).toBe("good");
      expect(result.message).toContain("good");
    });

    it("includes entry id and timestamp", async () => {
      const result = await logMood.execute({ mood: "okay" });

      expect(result.entry.id).toMatch(/^mood_\d+$/);
      expect(result.entry.timestamp).toBeDefined();
    });

    it("includes optional notes", async () => {
      const result = await logMood.execute({
        mood: "struggling",
        notes: "Had a tough day",
      });

      expect(result.entry.notes).toBe("Had a tough day");
    });

    it("includes optional triggers", async () => {
      const result = await logMood.execute({
        mood: "bad",
        triggers: ["stress", "isolation"],
      });

      expect(result.entry.triggers).toEqual(["stress", "isolation"]);
    });

    it("includes optional coping strategies", async () => {
      const result = await logMood.execute({
        mood: "okay",
        copingStrategies: ["deep breathing", "called sponsor"],
      });

      expect(result.entry.copingStrategies).toEqual([
        "deep breathing",
        "called sponsor",
      ]);
    });

    it("returns positive encouragement for good moods", async () => {
      const result = await logMood.execute({ mood: "great" });

      expect(result.encouragement).toContain("wonderful");
    });

    it("returns neutral encouragement for okay mood", async () => {
      const result = await logMood.execute({ mood: "okay" });

      expect(result.encouragement).toContain("progress");
    });

    it("returns supportive encouragement for struggling moods", async () => {
      const result = await logMood.execute({ mood: "struggling" });

      expect(result.encouragement).toContain("strength");
    });

    it("accepts all mood levels", async () => {
      const moods = [
        "great",
        "good",
        "okay",
        "struggling",
        "bad",
        "crisis",
      ] as const;

      for (const mood of moods) {
        const result = await logMood.execute({ mood });
        expect(result.success).toBe(true);
        expect(result.entry.mood).toBe(mood);
      }
    });
  });

  describe("getCrisisResources", () => {
    it("has correct description", () => {
      expect(getCrisisResources.description).toContain("crisis");
      expect(getCrisisResources.description).toContain("emergency");
    });

    it("returns all resources by default", async () => {
      const result = await getCrisisResources.execute({});

      expect(result.success).toBe(true);
      expect(result.resources.length).toBeGreaterThan(0);
      expect(result.urgent).toBe(true);
    });

    it("returns general resources", async () => {
      const result = await getCrisisResources.execute({ type: "general" });

      expect(result.success).toBe(true);
      expect(
        result.resources.some((r: { phone: string }) => r.phone === "988"),
      ).toBe(true);
    });

    it("returns suicide resources", async () => {
      const result = await getCrisisResources.execute({ type: "suicide" });

      expect(result.success).toBe(true);
      expect(
        result.resources.some((r: { phone: string }) => r.phone === "988"),
      ).toBe(true);
    });

    it("returns substance resources", async () => {
      const result = await getCrisisResources.execute({ type: "substance" });

      expect(result.success).toBe(true);
      expect(
        result.resources.some((r: { name: string }) =>
          r.name.includes("SAMHSA"),
        ),
      ).toBe(true);
    });

    it("returns domestic violence resources", async () => {
      const result = await getCrisisResources.execute({
        type: "domestic-violence",
      });

      expect(result.success).toBe(true);
      expect(
        result.resources.some((r: { name: string }) =>
          r.name.includes("Domestic Violence"),
        ),
      ).toBe(true);
    });

    it("includes resource details", async () => {
      const result = await getCrisisResources.execute({ type: "general" });

      const resource = result.resources[0];
      expect(resource.name).toBeDefined();
      expect(resource.description).toBeDefined();
      expect(resource.available24x7).toBe(true);
    });

    it("includes supportive message", async () => {
      const result = await getCrisisResources.execute({});

      expect(result.message).toContain("24/7");
      expect(result.message).toContain("support");
    });
  });

  describe("getResources", () => {
    it("has correct description", () => {
      expect(getResources.description).toContain("recovery");
      expect(getResources.description).toContain("resources");
    });

    it("returns relapse prevention resources", async () => {
      const result = await getResources.execute({
        topic: "relapse-prevention",
      });

      expect(result.success).toBe(true);
      expect(result.topic).toBe("relapse-prevention");
      expect(result.resources.length).toBeGreaterThan(0);
    });

    it("returns coping strategies resources", async () => {
      const result = await getResources.execute({ topic: "coping-strategies" });

      expect(result.success).toBe(true);
      expect(
        result.resources.some((r: { title: string }) =>
          r.title.includes("Grounding"),
        ),
      ).toBe(true);
    });

    it("returns meditation resources", async () => {
      const result = await getResources.execute({ topic: "meditation" });

      expect(result.success).toBe(true);
      expect(
        result.resources.some((r: { title: string }) =>
          r.title.includes("Meditation"),
        ),
      ).toBe(true);
    });

    it("returns general resources for unknown topics", async () => {
      const result = await getResources.execute({ topic: "general" });

      expect(result.success).toBe(true);
      expect(result.resources.length).toBeGreaterThan(0);
    });

    it("includes resource details", async () => {
      const result = await getResources.execute({
        topic: "relapse-prevention",
      });

      const resource = result.resources[0];
      expect(resource.title).toBeDefined();
      expect(resource.description).toBeDefined();
      expect(resource.type).toBeDefined();
    });

    it("returns message with topic", async () => {
      const result = await getResources.execute({ topic: "coping-strategies" });

      expect(result.message).toContain("coping strategies");
    });

    it("accepts all topic types", async () => {
      const topics = [
        "relapse-prevention",
        "coping-strategies",
        "meditation",
        "exercise",
        "nutrition",
        "sleep",
        "relationships",
        "work-life",
        "general",
      ] as const;

      for (const topic of topics) {
        const result = await getResources.execute({ topic });
        expect(result.success).toBe(true);
      }
    });
  });

  describe("recoveryTools", () => {
    it("exports all tools", () => {
      expect(recoveryTools.findMeetings).toBe(findMeetings);
      expect(recoveryTools.getLiveMeetings).toBe(getLiveMeetings);
      expect(recoveryTools.logMood).toBe(logMood);
      expect(recoveryTools.getCrisisResources).toBe(getCrisisResources);
      expect(recoveryTools.getResources).toBe(getResources);
    });

    it("has 5 tools", () => {
      expect(Object.keys(recoveryTools)).toHaveLength(5);
    });
  });
});
