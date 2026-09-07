import type {
  ProviderInstanceId,
  ServerProvider,
  ServerProviderUsageWindow,
} from "@t3tools/contracts";
import type { UsageLimitDisplayMode } from "@t3tools/contracts/settings";

export interface UsageLimitWindowSnapshot {
  readonly key: string;
  readonly label: string | null;
  readonly usedPercent: number;
  /** Epoch milliseconds, or null when the provider reports no reset time. */
  readonly resetsAt: number | null;
  readonly windowDurationMins: number | null;
}

export interface AccountRateLimitsSnapshot {
  readonly windows: readonly UsageLimitWindowSnapshot[];
  readonly providerInstanceId: ProviderInstanceId | null;
  /** The signed-in account label the provider reports, e.g. "ChatGPT Pro". */
  readonly accountLabel: string | null;
  readonly updatedAt: string;
}

interface RateLimitDeriveOptions {
  readonly providerInstanceId?: ProviderInstanceId | null | undefined;
  readonly now?: number;
}

/** Session windows first, then the longer allowances the provider reports. */
const WINDOW_KIND_ORDER: Record<ServerProviderUsageWindow["kind"], number> = {
  session: 0,
  weekly: 1,
  monthly: 2,
  other: 3,
};

function parseTimestamp(value: string | undefined): number | null {
  if (value === undefined) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatDurationLabel(minutes: number | null): string | null {
  if (!minutes || !Number.isFinite(minutes)) {
    return null;
  }
  if (minutes < 60) {
    return `${Math.round(minutes)}m`;
  }
  if (minutes < 24 * 60) {
    return `${Math.round(minutes / 60)}h`;
  }
  return `${Math.round(minutes / (24 * 60))}d`;
}

function toWindowSnapshot(window: ServerProviderUsageWindow): UsageLimitWindowSnapshot {
  return {
    key: window.id,
    label: window.label,
    usedPercent: Math.max(0, Math.min(100, Math.round(window.usedPercent))),
    resetsAt: parseTimestamp(window.resetsAt),
    windowDurationMins: window.windowDurationMins ?? null,
  };
}

/**
 * Compact usage snapshot for the composer strip, read from the provider
 * snapshot the server publishes. Adapters normalise their native rate-limit
 * payloads at the boundary and `ProviderUsageLimitsIngestion` folds live
 * updates into that snapshot, so the strip never parses driver shapes.
 */
export function deriveAccountRateLimitsSnapshot(
  providers: ReadonlyArray<ServerProvider>,
  options?: RateLimitDeriveOptions,
): AccountRateLimitsSnapshot | null {
  const instanceId = options?.providerInstanceId ?? null;
  if (instanceId === null) {
    return null;
  }
  const provider = providers.find((candidate) => candidate.instanceId === instanceId);
  const limits = provider?.usageLimits;
  if (!provider || !limits || limits.unavailable !== undefined) {
    return null;
  }

  const now = options?.now ?? Date.now();
  // A provider only republishes a window when its state changes, so one that
  // reset since the last probe still reports its pre-reset percentage. Drop
  // windows whose reset has already passed rather than showing a stale bar.
  const windows = limits.windows
    .filter((window) => {
      const resetsAt = parseTimestamp(window.resetsAt);
      return resetsAt === null || resetsAt > now;
    })
    .toSorted((left, right) => WINDOW_KIND_ORDER[left.kind] - WINDOW_KIND_ORDER[right.kind])
    .map(toWindowSnapshot);

  if (windows.length === 0) {
    return null;
  }

  return {
    windows,
    providerInstanceId: instanceId,
    accountLabel: provider.auth.label ?? null,
    updatedAt: limits.checkedAt,
  };
}

export function formatUsageLimitPercent(
  window: UsageLimitWindowSnapshot | null,
  mode: UsageLimitDisplayMode = "used",
): string {
  if (!window) {
    return "--";
  }
  const percent = mode === "remaining" ? 100 - window.usedPercent : window.usedPercent;
  return `${Math.max(0, Math.min(100, percent))}%`;
}

export function isUsageLimitWindowExhausted(window: UsageLimitWindowSnapshot | null): boolean {
  return Boolean(window && window.usedPercent >= 100);
}

export function formatUsageLimitChipValue(
  window: UsageLimitWindowSnapshot | null,
  mode: UsageLimitDisplayMode = "remaining",
): string {
  return formatUsageLimitPercent(window, mode);
}

export function formatUsageLimitTooltipValue(
  window: UsageLimitWindowSnapshot | null,
  mode: UsageLimitDisplayMode = "remaining",
): string {
  const percent = formatUsageLimitPercent(window, mode);
  if (percent === "--") {
    return percent;
  }
  return mode === "remaining" ? `${percent} left` : `${percent} used`;
}

export function formatUsageWindowLabel(window: UsageLimitWindowSnapshot | null): string {
  return window?.label ?? formatDurationLabel(window?.windowDurationMins ?? null) ?? "Limit";
}

export function formatUsageLimitReset(window: UsageLimitWindowSnapshot | null): string | null {
  if (!window?.resetsAt) {
    return null;
  }
  const includeWeekday =
    window.windowDurationMins !== null && window.windowDurationMins >= 7 * 24 * 60;
  return new Intl.DateTimeFormat(undefined, {
    ...(includeWeekday ? { weekday: "short" } : {}),
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(window.resetsAt));
}
