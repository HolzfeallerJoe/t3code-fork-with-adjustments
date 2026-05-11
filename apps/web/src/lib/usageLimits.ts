import type {
  OrchestrationThreadActivity,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import type { AppState } from "../store";

export interface UsageLimitWindowSnapshot {
  readonly key: string;
  readonly label: string | null;
  readonly usedPercent: number;
  readonly resetsAt: number | null;
  readonly windowDurationMins: number | null;
  readonly status: string | null;
}

export interface AccountRateLimitsSnapshot {
  readonly windows: readonly UsageLimitWindowSnapshot[];
  readonly provider: ProviderDriverKind | string | null;
  readonly providerInstanceId: ProviderInstanceId | string | null;
  readonly limitId: string | null;
  readonly limitName: string | null;
  readonly planType: string | null;
  readonly reachedType: string | null;
  readonly updatedAt: string;
}

interface RateLimitDeriveOptions {
  readonly providerInstanceId?: ProviderInstanceId | string | null;
  readonly provider?: ProviderDriverKind | string | null;
}

interface ParsedRateLimitSnapshot {
  readonly windows: readonly UsageLimitWindowSnapshot[];
  readonly provider: ProviderDriverKind | string | null;
  readonly providerInstanceId: ProviderInstanceId | string | null;
  readonly limitId: string | null;
  readonly limitName: string | null;
  readonly planType: string | null;
  readonly reachedType: string | null;
}

const EMPTY_ACTIVITIES: readonly OrchestrationThreadActivity[] = [];

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function normalizePercent(value: number): number {
  const percent = value <= 1 ? value * 100 : value;
  return Math.max(0, Math.min(100, Math.round(percent)));
}

function normalizeResetTimestamp(value: unknown): number | null {
  const timestamp = asFiniteNumber(value);
  if (timestamp === null) {
    return null;
  }
  return timestamp < 100_000_000_000 ? timestamp * 1000 : timestamp;
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

function humanizeLimitType(value: string): string {
  return value
    .split(/[_\s-]+/u)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function claudeRateLimitTypeToWindow(
  rateLimitType: string | null,
): Pick<UsageLimitWindowSnapshot, "label" | "windowDurationMins"> {
  switch (rateLimitType) {
    case "five_hour":
      return { label: "5h", windowDurationMins: 5 * 60 };
    case "seven_day":
      return { label: "7d", windowDurationMins: 7 * 24 * 60 };
    case "seven_day_opus":
      return { label: "7d Opus", windowDurationMins: 7 * 24 * 60 };
    case "seven_day_sonnet":
      return { label: "7d Sonnet", windowDurationMins: 7 * 24 * 60 };
    case "overage":
      return { label: "Overage", windowDurationMins: null };
    default:
      return {
        label: rateLimitType ? humanizeLimitType(rateLimitType) : null,
        windowDurationMins: null,
      };
  }
}

function parseOpenAiWindow(
  value: unknown,
  key: string,
  fallbackLabel: string | null,
): UsageLimitWindowSnapshot | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const usedPercent = asFiniteNumber(record.usedPercent);
  if (usedPercent === null) {
    return null;
  }
  const windowDurationMins = asFiniteNumber(record.windowDurationMins);
  return {
    key,
    label: formatDurationLabel(windowDurationMins) ?? fallbackLabel,
    usedPercent: normalizePercent(usedPercent),
    resetsAt: normalizeResetTimestamp(record.resetsAt),
    windowDurationMins,
    status: null,
  };
}

function parseOpenAiRateLimitSnapshot(
  record: Record<string, unknown>,
  keyPrefix: string,
): ParsedRateLimitSnapshot | null {
  const windows = [
    parseOpenAiWindow(record.primary, `${keyPrefix}:primary`, null),
    parseOpenAiWindow(record.secondary, `${keyPrefix}:secondary`, null),
  ].filter((window): window is UsageLimitWindowSnapshot => window !== null);

  if (windows.length === 0) {
    return null;
  }

  return {
    windows,
    provider: null,
    providerInstanceId: null,
    limitId: asString(record.limitId),
    limitName: asString(record.limitName),
    planType: asString(record.planType),
    reachedType: asString(record.rateLimitReachedType),
  };
}

function parseClaudeRateLimitSnapshot(
  record: Record<string, unknown>,
): ParsedRateLimitSnapshot | null {
  const info = asRecord(record.rate_limit_info);
  if (!info) {
    return null;
  }
  const utilization = asFiniteNumber(info.utilization);
  if (utilization === null) {
    return null;
  }
  const rateLimitType = asString(info.rateLimitType);
  const window = claudeRateLimitTypeToWindow(rateLimitType);

  return {
    windows: [
      {
        key: `claude:${rateLimitType ?? "default"}`,
        label: window.label,
        usedPercent: normalizePercent(utilization),
        resetsAt: normalizeResetTimestamp(info.resetsAt),
        windowDurationMins: window.windowDurationMins,
        status: asString(info.status),
      },
    ],
    provider: "claudeAgent",
    providerInstanceId: null,
    limitId: rateLimitType,
    limitName: rateLimitType ? humanizeLimitType(rateLimitType) : "Claude",
    planType: null,
    reachedType: asString(info.status),
  };
}

function mergeParsedSnapshots(
  left: ParsedRateLimitSnapshot | null,
  right: ParsedRateLimitSnapshot | null,
): ParsedRateLimitSnapshot | null {
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }
  return {
    windows: [...left.windows, ...right.windows],
    provider: left.provider ?? right.provider,
    providerInstanceId: left.providerInstanceId ?? right.providerInstanceId,
    limitId: left.limitId ?? right.limitId,
    limitName: left.limitName ?? right.limitName,
    planType: left.planType ?? right.planType,
    reachedType: left.reachedType ?? right.reachedType,
  };
}

function parseRateLimitPayload(payload: unknown): ParsedRateLimitSnapshot | null {
  const root = asRecord(payload);
  if (!root) {
    return null;
  }

  const provider = asString(root.provider);
  const providerInstanceId = asString(root.providerInstanceId);
  let parsed: ParsedRateLimitSnapshot | null = null;

  const claude = parseClaudeRateLimitSnapshot(root);
  parsed = mergeParsedSnapshots(parsed, claude);

  const openAi = parseOpenAiRateLimitSnapshot(root, provider ?? asString(root.limitId) ?? "limit");
  parsed = mergeParsedSnapshots(parsed, openAi);

  const nestedRateLimits =
    root.rateLimits !== undefined ? parseRateLimitPayload(root.rateLimits) : null;
  parsed = mergeParsedSnapshots(parsed, nestedRateLimits);

  const rateLimitsByLimitId = asRecord(root.rateLimitsByLimitId);
  if (rateLimitsByLimitId) {
    for (const [limitId, value] of Object.entries(rateLimitsByLimitId)) {
      const limitRecord = asRecord(value);
      const limitSnapshot = limitRecord ? parseOpenAiRateLimitSnapshot(limitRecord, limitId) : null;
      parsed = mergeParsedSnapshots(parsed, limitSnapshot);
    }
  }

  if (!parsed) {
    return null;
  }

  return {
    ...parsed,
    provider: provider ?? parsed.provider,
    providerInstanceId: providerInstanceId ?? parsed.providerInstanceId,
  };
}

function matchesProvider(
  snapshot: ParsedRateLimitSnapshot | AccountRateLimitsSnapshot,
  options: RateLimitDeriveOptions | undefined,
): boolean {
  if (!options) {
    return true;
  }
  if (
    options.providerInstanceId &&
    snapshot.providerInstanceId &&
    snapshot.providerInstanceId !== options.providerInstanceId
  ) {
    return false;
  }
  if (options.provider && snapshot.provider && snapshot.provider !== options.provider) {
    return false;
  }
  if (
    options.providerInstanceId &&
    !snapshot.providerInstanceId &&
    options.provider &&
    snapshot.provider
  ) {
    return snapshot.provider === options.provider;
  }
  if (options.provider && !snapshot.provider) {
    return false;
  }
  return true;
}

function windowIdentityKey(window: UsageLimitWindowSnapshot): string {
  return `${window.label ?? "limit"}:${window.windowDurationMins ?? "unknown"}`;
}

function toSnapshot(parsed: ParsedRateLimitSnapshot, updatedAt: string): AccountRateLimitsSnapshot {
  const windowsByKey = new Map<string, UsageLimitWindowSnapshot>();
  for (const window of parsed.windows) {
    const key = windowIdentityKey(window);
    if (!windowsByKey.has(key)) {
      windowsByKey.set(key, window);
    }
  }

  return {
    windows: [...windowsByKey.values()],
    provider: parsed.provider,
    providerInstanceId: parsed.providerInstanceId,
    limitId: parsed.limitId,
    limitName: parsed.limitName,
    planType: parsed.planType,
    reachedType: parsed.reachedType,
    updatedAt,
  };
}

export function deriveLatestAccountRateLimitsSnapshot(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  options?: RateLimitDeriveOptions,
): AccountRateLimitsSnapshot | null {
  let latestParsed: ParsedRateLimitSnapshot | null = null;
  let latestUpdatedAt: string | null = null;
  const seenWindowKeys = new Set<string>();

  for (let index = activities.length - 1; index >= 0; index -= 1) {
    const activity = activities[index];
    if (!activity || activity.kind !== "account-rate-limits.updated") {
      continue;
    }

    const parsed = parseRateLimitPayload(activity.payload);
    if (!parsed || !matchesProvider(parsed, options)) {
      continue;
    }

    const unseenWindows = parsed.windows.filter(
      (window) => !seenWindowKeys.has(windowIdentityKey(window)),
    );
    if (unseenWindows.length === 0) {
      continue;
    }
    for (const window of unseenWindows) {
      seenWindowKeys.add(windowIdentityKey(window));
    }

    latestParsed = mergeParsedSnapshots(latestParsed, { ...parsed, windows: unseenWindows });
    latestUpdatedAt ??= activity.createdAt;
  }

  return latestParsed && latestUpdatedAt ? toSnapshot(latestParsed, latestUpdatedAt) : null;
}

function compareSnapshotUpdatedAt(
  left: AccountRateLimitsSnapshot | null,
  right: AccountRateLimitsSnapshot | null,
): AccountRateLimitsSnapshot | null {
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }
  const leftTime = Date.parse(left.updatedAt);
  const rightTime = Date.parse(right.updatedAt);
  return Number.isFinite(rightTime) && (!Number.isFinite(leftTime) || rightTime > leftTime)
    ? right
    : left;
}

export function deriveLatestAccountRateLimitsSnapshotFromState(
  state: AppState,
  options?: RateLimitDeriveOptions,
): AccountRateLimitsSnapshot | null {
  let latest: AccountRateLimitsSnapshot | null = null;

  for (const environmentState of Object.values(state.environmentStateById)) {
    for (const [threadId, activityIds] of Object.entries(
      environmentState.activityIdsByThreadId,
    ) as Array<[ThreadId, string[]]>) {
      const activityById = environmentState.activityByThreadId[threadId] ?? {};
      const activities =
        activityIds.length > 0
          ? activityIds.flatMap((activityId) => {
              const activity = activityById[activityId];
              return activity ? [activity] : [];
            })
          : EMPTY_ACTIVITIES;
      latest = compareSnapshotUpdatedAt(
        latest,
        deriveLatestAccountRateLimitsSnapshot(activities, options),
      );
    }
  }

  return latest;
}

export function formatUsageLimitPercent(window: UsageLimitWindowSnapshot | null): string {
  return window ? `${window.usedPercent}%` : "--";
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
