import type { ForkUpdateState } from "@t3tools/contracts";
import { msg } from "gt-react";

import { m, type MessageResolver } from "../i18n/messages";

export function shouldShowForkUpdateNotification(state: ForkUpdateState | null): boolean {
  if (!state || !state.enabled) {
    return false;
  }
  return state.status === "update-available" || state.status === "sync-conflict";
}

export function getForkUpdateNotificationTitle(
  state: ForkUpdateState,
  resolve: MessageResolver = m,
): string {
  if (state.status === "sync-conflict") {
    return resolve(msg("Fork Sync Conflict"));
  }
  if (state.status === "update-available") {
    return resolve(msg("Fork Updated"));
  }
  return resolve(msg("Fork Status"));
}

export function getForkUpdateNotificationMessage(
  state: ForkUpdateState,
  resolve: MessageResolver = m,
): string {
  if (state.status === "sync-conflict") {
    return resolve(
      msg("Upstream sync failed due to merge conflicts. Manual merge required before rebuilding."),
    );
  }
  if (state.status === "update-available") {
    return state.latestCommitMessage
      ? resolve(
          msg("Your fork has new commits. Rebuild and install a new version.\n\nLatest: {commit}", {
            commit: state.latestCommitMessage,
          }),
        )
      : resolve(msg("Your fork has new commits. Rebuild and install a new version."));
  }
  if (state.status === "error") {
    return state.message ?? resolve(msg("Failed to check fork status."));
  }
  return resolve(msg("Your fork is up to date."));
}

export function getForkUpdateTooltip(state: ForkUpdateState, resolve: MessageResolver = m): string {
  if (state.status === "checking") {
    return resolve(msg("Checking fork for updates..."));
  }
  if (state.status === "sync-conflict") {
    return resolve(msg("Upstream sync failed - resolve conflicts and rebuild"));
  }
  if (state.status === "update-available") {
    return resolve(
      msg("New commit {commit} available - rebuild your fork", {
        commit: state.latestCommit?.slice(0, 7) ?? "unknown",
      }),
    );
  }
  if (state.status === "error") {
    return state.message ?? resolve(msg("Error checking fork"));
  }
  if (state.status === "up-to-date") {
    return resolve(msg("Fork is up to date with your build"));
  }
  return resolve(msg("Fork update checking disabled"));
}
