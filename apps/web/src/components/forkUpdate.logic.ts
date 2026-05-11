import type { ForkUpdateState } from "@t3tools/contracts";

export function shouldShowForkUpdateNotification(state: ForkUpdateState | null): boolean {
  if (!state || !state.enabled) {
    return false;
  }
  return state.status === "update-available" || state.status === "sync-conflict";
}

export function getForkUpdateNotificationTitle(state: ForkUpdateState): string {
  if (state.status === "sync-conflict") {
    return "Fork Sync Conflict";
  }
  if (state.status === "update-available") {
    return "Fork Updated";
  }
  return "Fork Status";
}

export function getForkUpdateNotificationMessage(state: ForkUpdateState): string {
  if (state.status === "sync-conflict") {
    return "Upstream sync failed due to merge conflicts. Manual merge required before rebuilding.";
  }
  if (state.status === "update-available") {
    const commitInfo = state.latestCommitMessage ? `\n\nLatest: ${state.latestCommitMessage}` : "";
    return `Your fork has new commits. Rebuild and install a new version.${commitInfo}`;
  }
  if (state.status === "error") {
    return state.message ?? "Failed to check fork status.";
  }
  return "Your fork is up to date.";
}

export function getForkUpdateTooltip(state: ForkUpdateState): string {
  if (state.status === "checking") {
    return "Checking fork for updates...";
  }
  if (state.status === "sync-conflict") {
    return "Upstream sync failed - resolve conflicts and rebuild";
  }
  if (state.status === "update-available") {
    const shortCommit = state.latestCommit?.slice(0, 7) ?? "unknown";
    return `New commit ${shortCommit} available - rebuild your fork`;
  }
  if (state.status === "error") {
    return state.message ?? "Error checking fork";
  }
  if (state.status === "up-to-date") {
    return "Fork is up to date with your build";
  }
  return "Fork update checking disabled";
}

export function canCheckForkUpdate(state: ForkUpdateState | null): boolean {
  if (!state || !state.enabled) return false;
  return state.status !== "checking" && state.status !== "disabled";
}
