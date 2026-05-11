import { CalendarDaysIcon, Clock3Icon, GaugeIcon } from "lucide-react";
import { Fragment } from "react";

import { type ContextWindowSnapshot, formatContextWindowTokens } from "../lib/contextWindow";
import {
  type AccountRateLimitsSnapshot,
  type UsageLimitWindowSnapshot,
  formatUsageLimitPercent,
  formatUsageLimitReset,
  formatUsageWindowLabel,
} from "../lib/usageLimits";
import { cn } from "../lib/utils";
import { Popover, PopoverPopup, PopoverTrigger } from "./ui/popover";

interface UsageLimitStripProps {
  contextWindow: ContextWindowSnapshot | null;
  rateLimits: AccountRateLimitsSnapshot | null;
  className?: string;
}

interface UsageLimitItemProps {
  icon: typeof GaugeIcon;
  label: string;
  value: string;
}

function formatContextPercentage(value: number | null): string | null {
  if (value === null || !Number.isFinite(value)) {
    return null;
  }
  return `${Math.round(value)}%`;
}

function UsageLimitItem({ icon: Icon, label, value }: UsageLimitItemProps) {
  return (
    <span className="inline-flex h-6 min-w-0 items-center gap-1.5 rounded-md border border-border/50 bg-background/55 px-1.5 text-[11px] leading-none text-muted-foreground">
      <Icon className="size-3 shrink-0 opacity-75" aria-hidden="true" />
      <span className="shrink-0 font-medium">{label}</span>
      <span className="min-w-8 text-right font-medium tabular-nums text-foreground/80">
        {value}
      </span>
    </span>
  );
}

function iconForWindow(window: UsageLimitWindowSnapshot) {
  const minutes = window.windowDurationMins;
  if (minutes !== null && minutes >= 24 * 60) {
    return CalendarDaysIcon;
  }
  if (minutes !== null) {
    return Clock3Icon;
  }
  return GaugeIcon;
}

function formatPlanType(planType: string | null): string | null {
  return planType ? `${planType.charAt(0).toUpperCase()}${planType.slice(1)} plan` : null;
}

export function UsageLimitStrip({ contextWindow, rateLimits, className }: UsageLimitStripProps) {
  const contextPercent = formatContextPercentage(contextWindow?.usedPercentage ?? null);
  const contextValue =
    contextPercent ?? (contextWindow ? formatContextWindowTokens(contextWindow.usedTokens) : "--");
  const windows = rateLimits?.windows ?? [];
  const visibleWindows = windows.slice(0, 3);
  const fallbackWindow: UsageLimitWindowSnapshot | null =
    visibleWindows.length === 0
      ? {
          key: "pending",
          label: "Limit",
          usedPercent: 0,
          resetsAt: null,
          windowDurationMins: null,
          status: null,
        }
      : null;
  const displayWindows = fallbackWindow ? [fallbackWindow] : visibleWindows;

  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={150}
        closeDelay={0}
        render={
          <button
            type="button"
            className={cn(
              "min-w-0 items-center gap-1 rounded-lg text-left transition-opacity hover:opacity-85",
              className,
            )}
            aria-label={`Usage limits. Context ${contextValue}.`}
          >
            <UsageLimitItem icon={GaugeIcon} label="Ctx" value={contextValue} />
            {displayWindows.map((window) => (
              <UsageLimitItem
                key={window.key}
                icon={iconForWindow(window)}
                label={formatUsageWindowLabel(window)}
                value={fallbackWindow ? "--" : formatUsageLimitPercent(window)}
              />
            ))}
          </button>
        }
      />
      <PopoverPopup tooltipStyle side="top" align="end" className="w-max max-w-none px-3 py-2">
        <div className="space-y-1.5 leading-tight">
          <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
            Usage limits
          </div>
          <div className="grid grid-cols-[auto_auto] gap-x-3 gap-y-1 text-xs">
            <span className="text-muted-foreground">Context</span>
            <span className="text-right font-medium text-foreground">
              {contextWindow
                ? contextWindow.maxTokens !== null && contextPercent
                  ? `${contextPercent} - ${formatContextWindowTokens(
                      contextWindow.usedTokens,
                    )}/${formatContextWindowTokens(contextWindow.maxTokens ?? null)}`
                  : `${formatContextWindowTokens(contextWindow.usedTokens)} tokens`
                : "Waiting for usage"}
            </span>
            {windows.length > 0 ? (
              windows.map((window) => {
                const reset = formatUsageLimitReset(window);
                return (
                  <Fragment key={window.key}>
                    <span className="text-muted-foreground">{formatUsageWindowLabel(window)}</span>
                    <span className="text-right font-medium text-foreground">
                      {formatUsageLimitPercent(window)}
                      {reset ? ` - resets ${reset}` : ""}
                    </span>
                  </Fragment>
                );
              })
            ) : (
              <>
                <span className="text-muted-foreground">Limit</span>
                <span className="text-right font-medium text-foreground">Waiting for limit</span>
              </>
            )}
          </div>
          {rateLimits?.limitName || rateLimits?.planType ? (
            <div className="text-xs text-muted-foreground">
              {[rateLimits.limitName, formatPlanType(rateLimits.planType)]
                .filter(Boolean)
                .join(" - ")}
            </div>
          ) : null}
        </div>
      </PopoverPopup>
    </Popover>
  );
}
