import { ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  deriveAccountRateLimitsSnapshot,
  formatUsageLimitChipValue,
  formatUsageLimitPercent,
  formatUsageLimitTooltipValue,
  formatUsageWindowLabel,
  isUsageLimitWindowExhausted,
} from "./usageLimits";

const CHECKED_AT = "2026-03-23T00:00:00.000Z";
const NOW = Date.parse(CHECKED_AT);

function makeProvider(input: {
  id: string;
  usageLimits?: ServerProvider["usageLimits"];
  authLabel?: string;
}): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make(input.id),
    driver: "codex",
    label: input.id,
    enabled: true,
    installed: true,
    version: null,
    status: "ready",
    auth: { status: "authenticated", ...(input.authLabel ? { label: input.authLabel } : {}) },
    checkedAt: CHECKED_AT,
    models: [],
    slashCommands: [],
    skills: [],
    ...(input.usageLimits ? { usageLimits: input.usageLimits } : {}),
  } as unknown as ServerProvider;
}

describe("deriveAccountRateLimitsSnapshot", () => {
  it("orders session windows ahead of longer allowances", () => {
    const snapshot = deriveAccountRateLimitsSnapshot(
      [
        makeProvider({
          id: "codex",
          authLabel: "ChatGPT Pro",
          usageLimits: {
            checkedAt: CHECKED_AT,
            windows: [
              { id: "secondary", kind: "weekly", label: "7d", usedPercent: 34 },
              { id: "primary", kind: "session", label: "5h", usedPercent: 12 },
            ],
          },
        }),
      ],
      { providerInstanceId: ProviderInstanceId.make("codex"), now: NOW },
    );

    expect(snapshot?.windows.map((window) => [window.label, window.usedPercent])).toEqual([
      ["5h", 12],
      ["7d", 34],
    ]);
    expect(snapshot?.accountLabel).toBe("ChatGPT Pro");
    expect(snapshot?.updatedAt).toBe(CHECKED_AT);
  });

  it("reads only the requested provider instance", () => {
    const providers = [
      makeProvider({
        id: "codex",
        usageLimits: {
          checkedAt: CHECKED_AT,
          windows: [{ id: "primary", kind: "session", label: "5h", usedPercent: 12 }],
        },
      }),
      makeProvider({ id: "claude" }),
    ];

    expect(
      deriveAccountRateLimitsSnapshot(providers, {
        providerInstanceId: ProviderInstanceId.make("claude"),
        now: NOW,
      }),
    ).toBeNull();
    expect(deriveAccountRateLimitsSnapshot(providers, { now: NOW })).toBeNull();
  });

  it("hides limits a provider cannot report", () => {
    const snapshot = deriveAccountRateLimitsSnapshot(
      [
        makeProvider({
          id: "codex",
          usageLimits: {
            checkedAt: CHECKED_AT,
            windows: [{ id: "primary", kind: "session", label: "5h", usedPercent: 12 }],
            unavailable: { reason: "unsupported" },
          },
        }),
      ],
      { providerInstanceId: ProviderInstanceId.make("codex"), now: NOW },
    );

    expect(snapshot).toBeNull();
  });

  it("drops windows whose reset has already passed", () => {
    const snapshot = deriveAccountRateLimitsSnapshot(
      [
        makeProvider({
          id: "codex",
          usageLimits: {
            checkedAt: CHECKED_AT,
            windows: [
              {
                id: "primary",
                kind: "session",
                label: "5h",
                usedPercent: 95,
                resetsAt: "2026-03-22T23:00:00.000Z",
              },
              {
                id: "secondary",
                kind: "weekly",
                label: "7d",
                usedPercent: 40,
                resetsAt: "2026-03-26T00:00:00.000Z",
              },
            ],
          },
        }),
      ],
      { providerInstanceId: ProviderInstanceId.make("codex"), now: NOW },
    );

    expect(snapshot?.windows.map((window) => window.label)).toEqual(["7d"]);
  });
});

describe("usage limit formatting", () => {
  it("formats chips as remaining or used percentages", () => {
    const snapshot = deriveAccountRateLimitsSnapshot(
      [
        makeProvider({
          id: "codex",
          usageLimits: {
            checkedAt: CHECKED_AT,
            windows: [
              {
                id: "primary",
                kind: "session",
                label: "5h",
                usedPercent: 100,
                windowDurationMins: 300,
              },
            ],
          },
        }),
      ],
      { providerInstanceId: ProviderInstanceId.make("codex"), now: NOW },
    );
    const window = snapshot?.windows[0] ?? null;

    expect(isUsageLimitWindowExhausted(window)).toBe(true);
    expect(formatUsageLimitPercent(window)).toBe("100%");
    expect(formatUsageLimitChipValue(window, "remaining")).toBe("0%");
    expect(formatUsageLimitChipValue(window, "used")).toBe("100%");
    expect(formatUsageLimitTooltipValue(window, "remaining")).toBe("0% left");
    expect(formatUsageLimitTooltipValue(window, "used")).toBe("100% used");
  });

  it("falls back to the window duration when no label is reported", () => {
    expect(formatUsageLimitPercent(null)).toBe("--");
    expect(formatUsageWindowLabel(null)).toBe("Limit");
    expect(
      formatUsageWindowLabel({
        key: "primary",
        label: null,
        usedPercent: 10,
        resetsAt: null,
        windowDurationMins: 10_080,
      }),
    ).toBe("7d");
  });
});
