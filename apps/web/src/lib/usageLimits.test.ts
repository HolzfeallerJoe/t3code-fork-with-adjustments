import { describe, expect, it } from "vitest";
import { EventId, type OrchestrationThreadActivity, ThreadId, TurnId } from "@t3tools/contracts";

import {
  deriveLatestAccountRateLimitsSnapshot,
  deriveLatestAccountRateLimitsSnapshotFromState,
  formatUsageLimitChipValue,
  formatUsageLimitPercent,
  formatUsageLimitTooltipValue,
  formatUsageWindowLabel,
  isUsageLimitWindowExhausted,
} from "./usageLimits";

function makeActivity(id: string, kind: string, payload: unknown): OrchestrationThreadActivity {
  return {
    id: EventId.make(id),
    tone: "info",
    kind,
    summary: kind,
    payload,
    turnId: TurnId.make("turn-1"),
    createdAt: "2026-03-23T00:00:00.000Z",
  };
}

describe("usageLimits", () => {
  it("derives hourly and weekly windows from the latest valid rate limit activity", () => {
    const snapshot = deriveLatestAccountRateLimitsSnapshot([
      makeActivity("activity-1", "account-rate-limits.updated", {
        provider: "codex",
        providerInstanceId: "codex",
        rateLimits: {
          primary: {
            usedPercent: 90,
            windowDurationMins: 60,
          },
        },
      }),
      makeActivity("activity-2", "tool.started", {}),
      makeActivity("activity-3", "account-rate-limits.updated", {
        provider: "codex",
        providerInstanceId: "codex",
        rateLimits: {
          limitId: "codex",
          limitName: "Codex",
          planType: "pro",
          primary: {
            usedPercent: 12,
            windowDurationMins: 60,
          },
          secondary: {
            usedPercent: 34,
            windowDurationMins: 10_080,
          },
        },
      }),
    ]);

    expect(snapshot).not.toBeNull();
    expect(snapshot?.limitId).toBe("codex");
    expect(snapshot?.limitName).toBe("Codex");
    expect(snapshot?.planType).toBe("pro");
    expect(snapshot?.provider).toBe("codex");
    expect(snapshot?.providerInstanceId).toBe("codex");
    expect(snapshot?.windows.map((window) => [window.label, window.usedPercent])).toEqual([
      ["1h", 12],
      ["7d", 34],
    ]);
  });

  it("handles account rate limits keyed by limit id", () => {
    const snapshot = deriveLatestAccountRateLimitsSnapshot([
      makeActivity("activity-1", "account-rate-limits.updated", {
        rateLimitsByLimitId: {
          codex: {
            primary: {
              usedPercent: 42,
              windowDurationMins: 60,
            },
            secondary: {
              usedPercent: 7,
              windowDurationMins: 10_080,
            },
          },
        },
      }),
    ]);

    expect(snapshot?.windows.map((window) => [window.label, window.usedPercent])).toEqual([
      ["1h", 42],
      ["7d", 7],
    ]);
  });

  it("handles Claude rate limit events without OpenAI-shaped windows", () => {
    const snapshot = deriveLatestAccountRateLimitsSnapshot([
      makeActivity("activity-1", "account-rate-limits.updated", {
        provider: "claudeAgent",
        providerInstanceId: "claudeAgent",
        rateLimits: {
          type: "rate_limit_event",
          rate_limit_info: {
            status: "allowed_warning",
            rateLimitType: "five_hour",
            utilization: 0.37,
            resetsAt: 1_775_000_000,
          },
        },
      }),
      makeActivity("activity-2", "account-rate-limits.updated", {
        provider: "claudeAgent",
        providerInstanceId: "claudeAgent",
        rateLimits: {
          type: "rate_limit_event",
          rate_limit_info: {
            status: "allowed",
            rateLimitType: "seven_day_opus",
            utilization: 42,
          },
        },
      }),
    ]);

    expect(snapshot?.provider).toBe("claudeAgent");
    expect(snapshot?.windows.map((window) => [window.label, window.usedPercent])).toEqual([
      ["7d Opus", 42],
      ["5h", 37],
    ]);
  });

  it("ignores malformed payloads and formats placeholders", () => {
    const snapshot = deriveLatestAccountRateLimitsSnapshot([
      makeActivity("activity-1", "account-rate-limits.updated", {}),
    ]);

    expect(snapshot).toBeNull();
    expect(formatUsageLimitPercent(null)).toBe("--");
  });

  it("formats limit chips as remaining or used percentages", () => {
    const snapshot = deriveLatestAccountRateLimitsSnapshot([
      makeActivity("activity-1", "account-rate-limits.updated", {
        provider: "codex",
        rateLimits: {
          primary: {
            usedPercent: 100,
            windowDurationMins: 300,
            resetsAt: 1_775_000_000,
          },
        },
      }),
    ]);
    const window = snapshot?.windows[0] ?? null;

    expect(isUsageLimitWindowExhausted(window)).toBe(true);
    expect(formatUsageLimitPercent(window)).toBe("100%");
    expect(formatUsageLimitChipValue(window, "remaining")).toBe("0%");
    expect(formatUsageLimitChipValue(window, "used")).toBe("100%");
    expect(formatUsageLimitTooltipValue(window, "remaining")).toBe("0% left");
    expect(formatUsageLimitTooltipValue(window, "used")).toBe("100% used");
  });

  it("derives the latest rate limits across loaded thread activity state", () => {
    const older = makeActivity("activity-1", "account-rate-limits.updated", {
      rateLimits: {
        primary: {
          usedPercent: 12,
          windowDurationMins: 60,
        },
      },
    });
    const newer = {
      ...makeActivity("activity-2", "account-rate-limits.updated", {
        rateLimits: {
          primary: {
            usedPercent: 55,
            windowDurationMins: 300,
          },
        },
      }),
      createdAt: "2026-03-23T01:00:00.000Z",
    };
    const thread1 = ThreadId.make("thread-1");
    const thread2 = ThreadId.make("thread-2");

    const snapshot = deriveLatestAccountRateLimitsSnapshotFromState({
      activeEnvironmentId: null,
      environmentStateById: {
        env: {
          projectIds: [],
          projectById: {},
          threadIds: [],
          threadIdsByProjectId: {},
          threadShellById: {},
          threadSessionById: {},
          threadTurnStateById: {},
          messageIdsByThreadId: {},
          messageByThreadId: {},
          activityIdsByThreadId: {
            [thread1]: [older.id],
            [thread2]: [newer.id],
          },
          activityByThreadId: {
            [thread1]: { [older.id]: older },
            [thread2]: { [newer.id]: newer },
          },
          proposedPlanIdsByThreadId: {},
          proposedPlanByThreadId: {},
          turnDiffIdsByThreadId: {},
          turnDiffSummaryByThreadId: {},
          sidebarThreadSummaryById: {},
          bootstrapComplete: true,
        },
      },
    });

    expect(snapshot?.windows[0]?.usedPercent).toBe(55);
    expect(formatUsageWindowLabel(snapshot?.windows[0] ?? null)).toBe("5h");
  });

  it("filters global rate limits to the requested provider", () => {
    const codex = makeActivity("activity-1", "account-rate-limits.updated", {
      provider: "codex",
      providerInstanceId: "codex",
      rateLimits: {
        primary: {
          usedPercent: 12,
          windowDurationMins: 300,
        },
      },
    });
    const claude = makeActivity("activity-2", "account-rate-limits.updated", {
      provider: "claudeAgent",
      providerInstanceId: "claudeAgent",
      rateLimits: {
        type: "rate_limit_event",
        rate_limit_info: {
          status: "allowed",
          rateLimitType: "five_hour",
          utilization: 0.66,
        },
      },
    });
    const thread1 = ThreadId.make("thread-1");
    const thread2 = ThreadId.make("thread-2");
    const state = {
      activeEnvironmentId: null,
      environmentStateById: {
        env: {
          projectIds: [],
          projectById: {},
          threadIds: [],
          threadIdsByProjectId: {},
          threadShellById: {},
          threadSessionById: {},
          threadTurnStateById: {},
          messageIdsByThreadId: {},
          messageByThreadId: {},
          activityIdsByThreadId: {
            [thread1]: [codex.id],
            [thread2]: [claude.id],
          },
          activityByThreadId: {
            [thread1]: { [codex.id]: codex },
            [thread2]: { [claude.id]: claude },
          },
          proposedPlanIdsByThreadId: {},
          proposedPlanByThreadId: {},
          turnDiffIdsByThreadId: {},
          turnDiffSummaryByThreadId: {},
          sidebarThreadSummaryById: {},
          bootstrapComplete: true,
        },
      },
    };

    const snapshot = deriveLatestAccountRateLimitsSnapshotFromState(state, {
      provider: "claudeAgent",
      providerInstanceId: "claudeAgent",
    });

    expect(snapshot?.provider).toBe("claudeAgent");
    expect(snapshot?.windows[0]?.usedPercent).toBe(66);
  });

  it("does not use unknown-provider limits when filtering to a selected provider", () => {
    const snapshot = deriveLatestAccountRateLimitsSnapshot(
      [
        makeActivity("activity-1", "account-rate-limits.updated", {
          rateLimits: {
            primary: {
              usedPercent: 12,
              windowDurationMins: 300,
            },
          },
        }),
      ],
      {
        provider: "cursor",
        providerInstanceId: "cursor",
      },
    );

    expect(snapshot).toBeNull();
  });
});
