import { AlertTriangleIcon, ExternalLinkIcon, GitForkIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { isElectron } from "../../env";
import { useForkUpdateState } from "../../lib/forkUpdateReactQuery";
import {
  getForkUpdateNotificationMessage,
  getForkUpdateNotificationTitle,
  getForkUpdateTooltip,
  shouldShowForkUpdateNotification,
} from "../forkUpdate.logic";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export function SidebarForkUpdatePill() {
  const state = useForkUpdateState().data ?? null;
  const [dismissed, setDismissed] = useState(false);

  const visible = isElectron && shouldShowForkUpdateNotification(state) && !dismissed;
  const tooltip = state ? getForkUpdateTooltip(state) : "Fork status";

  if (!visible || !state) return null;

  const isSyncConflict = state.status === "sync-conflict";
  const title = getForkUpdateNotificationTitle(state);
  const message = getForkUpdateNotificationMessage(state);

  const handleOpenConflictIssue = () => {
    if (state.syncConflictIssueUrl) {
      window.desktopBridge?.openExternal(state.syncConflictIssueUrl);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      {isSyncConflict ? (
        <Alert variant="warning" className="rounded-2xl border-warning/40 bg-warning/8 text-xs">
          <AlertTriangleIcon className="size-4" />
          <AlertTitle>{title}</AlertTitle>
          <AlertDescription>
            {message}
            {state.syncConflictIssueUrl && (
              <button
                type="button"
                onClick={handleOpenConflictIssue}
                className="mt-1.5 flex items-center gap-1 text-warning hover:underline"
              >
                <ExternalLinkIcon className="size-3" />
                View issue
              </button>
            )}
          </AlertDescription>
        </Alert>
      ) : (
        <div className="group/fork-update relative flex min-h-7 w-full items-center rounded-lg bg-accent/80 text-xs font-medium text-accent-foreground">
          <div className="pointer-events-none absolute inset-0 rounded-lg transition-colors group-has-[button.fork-main:hover]/fork-update:bg-accent" />
          <Tooltip>
            <TooltipTrigger
              render={
                <div
                  className="fork-main relative flex flex-1 flex-col gap-0.5 px-2.5 py-1.5"
                  aria-label={tooltip}
                >
                  <div className="flex items-center gap-1.5">
                    <GitForkIcon className="size-3.5" />
                    <span className="font-medium">{title}</span>
                  </div>
                  <span className="text-[10px] leading-tight text-accent-foreground/70">
                    Rebuild and install from your fork
                  </span>
                </div>
              }
            />
            <TooltipPopup side="top" className="max-w-xs">
              <div className="flex flex-col gap-1">
                <span className="font-medium">{title}</span>
                <span className="text-xs text-muted-foreground">{message}</span>
                {state.latestCommit && (
                  <span className="font-mono text-[10px] text-muted-foreground">
                    Latest: {state.latestCommit.slice(0, 12)}
                  </span>
                )}
              </div>
            </TooltipPopup>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label="Dismiss"
                  className="mr-1.5 inline-flex size-5 items-center justify-center rounded-md text-accent-foreground/60 transition-colors hover:text-accent-foreground"
                  onClick={() => setDismissed(true)}
                >
                  <XIcon className="size-3.5" />
                </button>
              }
            />
            <TooltipPopup side="top">Dismiss until next launch</TooltipPopup>
          </Tooltip>
        </div>
      )}
    </div>
  );
}
