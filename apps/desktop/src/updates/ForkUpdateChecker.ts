import type { ForkUpdateCheckResult, ForkUpdateState, ForkUpdateStatus } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";

import * as DesktopConfig from "../app/DesktopConfig.ts";
import * as DesktopObservability from "../app/DesktopObservability.ts";
import * as ElectronWindow from "../electron/ElectronWindow.ts";
import * as IpcChannels from "../ipc/channels.ts";

const FORK_UPDATE_STARTUP_DELAY = "10 seconds";

export class ForkUpdateCheckError extends Data.TaggedError("ForkUpdateCheckError")<{
  readonly message: string;
}> {}

export class ForkUpdateFetchError extends Data.TaggedError("ForkUpdateFetchError")<{
  readonly message: string;
}> {}

const GitHubCommitResponse = Schema.Struct({
  sha: Schema.String,
  commit: Schema.Struct({
    message: Schema.String,
    committer: Schema.Struct({
      date: Schema.String,
    }),
  }),
});

const GitHubIssueResponse = Schema.Array(
  Schema.Struct({
    html_url: Schema.String,
    title: Schema.String,
    state: Schema.String,
  }),
);

const decodeGitHubCommit = Schema.decodeUnknownEffect(GitHubCommitResponse);
const decodeGitHubIssues = Schema.decodeUnknownEffect(GitHubIssueResponse);

const currentIsoTimestamp = DateTime.now.pipe(Effect.map(DateTime.formatIso));

export interface ForkUpdateCheckerShape {
  readonly getState: Effect.Effect<ForkUpdateState>;
  readonly emitState: Effect.Effect<void>;
  readonly configure: Effect.Effect<void, never, Scope.Scope>;
  readonly check: (reason: string) => Effect.Effect<ForkUpdateCheckResult>;
}

export class ForkUpdateChecker extends Context.Service<ForkUpdateChecker, ForkUpdateCheckerShape>()(
  "t3/desktop/ForkUpdateChecker",
) {}

const {
  logInfo: logForkInfo,
  logWarning: logForkWarning,
  logError: logForkError,
} = DesktopObservability.makeComponentLogger("fork-update-checker");

function createInitialForkUpdateState(
  forkRepo: Option.Option<string>,
  currentCommit: Option.Option<string>,
): ForkUpdateState {
  const enabled = Option.isSome(forkRepo);
  return {
    enabled,
    status: enabled ? "idle" : "disabled",
    forkRepo: Option.getOrNull(forkRepo),
    currentCommit: Option.getOrNull(currentCommit),
    latestCommit: null,
    latestCommitMessage: null,
    latestCommitDate: null,
    checkedAt: null,
    message: null,
    syncConflictIssueUrl: null,
  };
}

function reduceStateOnCheckStart(state: ForkUpdateState, checkedAt: string): ForkUpdateState {
  return {
    ...state,
    status: "checking",
    checkedAt,
    message: null,
  };
}

function reduceStateOnCheckSuccess(
  state: ForkUpdateState,
  latestCommit: string,
  latestCommitMessage: string,
  latestCommitDate: string,
  checkedAt: string,
  syncConflictIssueUrl: string | null,
): ForkUpdateState {
  const hasNewCommit =
    state.currentCommit !== null &&
    latestCommit !== state.currentCommit &&
    !latestCommit.startsWith(state.currentCommit) &&
    !state.currentCommit.startsWith(latestCommit);

  let status: ForkUpdateStatus;
  if (syncConflictIssueUrl) {
    status = "sync-conflict";
  } else if (hasNewCommit) {
    status = "update-available";
  } else {
    status = "up-to-date";
  }

  return {
    ...state,
    status,
    latestCommit,
    latestCommitMessage: latestCommitMessage.split("\n")[0] ?? latestCommitMessage,
    latestCommitDate,
    checkedAt,
    message: null,
    syncConflictIssueUrl,
  };
}

function reduceStateOnCheckFailure(
  state: ForkUpdateState,
  message: string,
  checkedAt: string,
): ForkUpdateState {
  return {
    ...state,
    status: "error",
    message,
    checkedAt,
  };
}

const make = Effect.gen(function* () {
  const config = yield* DesktopConfig.DesktopConfig;
  const electronWindow = yield* ElectronWindow.ElectronWindow;

  const forkRepo = config.forkRepo;
  const forkModeEnabled = config.forkMode && Option.isSome(forkRepo);

  const updateStateRef = yield* Ref.make<ForkUpdateState>(
    createInitialForkUpdateState(
      forkModeEnabled ? forkRepo : Option.none(),
      config.commitHashOverride,
    ),
  );
  const checkInFlightRef = yield* Ref.make(false);

  const emitState = Ref.get(updateStateRef).pipe(
    Effect.flatMap((state) => electronWindow.sendAll(IpcChannels.FORK_UPDATE_STATE_CHANNEL, state)),
  );

  const setState = (state: ForkUpdateState): Effect.Effect<void> =>
    Ref.set(updateStateRef, state).pipe(Effect.andThen(emitState));

  const fetchLatestCommit = (repo: string) =>
    Effect.tryPromise({
      try: async () => {
        const response = await fetch(`https://api.github.com/repos/${repo}/commits/main`, {
          headers: {
            Accept: "application/vnd.github.v3+json",
            "User-Agent": "T3Code-ForkUpdateChecker",
          },
        });
        if (!response.ok) {
          throw new ForkUpdateFetchError({
            message: `GitHub API returned ${response.status}: ${response.statusText}`,
          });
        }
        return response.json();
      },
      catch: (error) =>
        new ForkUpdateFetchError({
          message: error instanceof ForkUpdateFetchError ? error.message : String(error),
        }),
    }).pipe(Effect.flatMap(decodeGitHubCommit));

  const fetchSyncConflictIssue = (repo: string) =>
    Effect.tryPromise({
      try: async () => {
        const response = await fetch(
          `https://api.github.com/repos/${repo}/issues?labels=upstream-sync&state=open`,
          {
            headers: {
              Accept: "application/vnd.github.v3+json",
              "User-Agent": "T3Code-ForkUpdateChecker",
            },
          },
        );
        if (!response.ok) {
          return [];
        }
        return response.json();
      },
      catch: () => [] as unknown[],
    }).pipe(
      Effect.flatMap(decodeGitHubIssues),
      Effect.map((issues) => {
        const conflictIssue = issues.find(
          (issue) => issue.title.includes("Upstream Sync Failed") && issue.state === "open",
        );
        return conflictIssue?.html_url ?? null;
      }),
      Effect.catch(() => Effect.succeed(null)),
    );

  const checkForForkUpdates = Effect.fn("desktop.forkUpdates.check")(function* (reason: string) {
    yield* Effect.annotateCurrentSpan({ reason });

    const state = yield* Ref.get(updateStateRef);
    if (!state.enabled || state.forkRepo === null) {
      return false;
    }

    if (yield* Ref.get(checkInFlightRef)) {
      return false;
    }

    yield* Ref.set(checkInFlightRef, true);
    const checkedAt = yield* currentIsoTimestamp;
    yield* setState(reduceStateOnCheckStart(state, checkedAt));
    yield* logForkInfo("checking fork for updates", { reason, repo: state.forkRepo });

    return yield* Effect.gen(function* () {
      const [commitResult, syncConflictUrl] = yield* Effect.all([
        fetchLatestCommit(state.forkRepo!),
        fetchSyncConflictIssue(state.forkRepo!),
      ]);

      const finalCheckedAt = yield* currentIsoTimestamp;
      yield* setState(
        reduceStateOnCheckSuccess(
          state,
          commitResult.sha,
          commitResult.commit.message,
          commitResult.commit.committer.date,
          finalCheckedAt,
          syncConflictUrl,
        ),
      );

      const currentState = yield* Ref.get(updateStateRef);
      if (currentState.status === "update-available") {
        yield* logForkInfo("fork has new commits", {
          current: state.currentCommit?.slice(0, 12),
          latest: commitResult.sha.slice(0, 12),
          message: commitResult.commit.message.split("\n")[0],
        });
      } else if (currentState.status === "sync-conflict") {
        yield* logForkWarning("upstream sync conflict detected", {
          issueUrl: syncConflictUrl,
        });
      } else {
        yield* logForkInfo("fork is up to date");
      }

      return true;
    }).pipe(
      Effect.catch(
        Effect.fn("desktop.forkUpdates.handleCheckFailure")(function* (error) {
          const failedAt = yield* currentIsoTimestamp;
          yield* setState(reduceStateOnCheckFailure(state, error.message, failedAt));
          yield* logForkError("failed to check fork for updates", { message: error.message });
          return true;
        }),
      ),
      Effect.ensuring(Ref.set(checkInFlightRef, false)),
    );
  });

  const startupCheck: Effect.Effect<void, never, Scope.Scope> = Effect.gen(function* () {
    yield* Effect.sleep(FORK_UPDATE_STARTUP_DELAY).pipe(
      Effect.andThen(checkForForkUpdates("startup")),
      Effect.catchCause((cause) =>
        logForkError("startup fork update check failed", { cause: Cause.pretty(cause) }),
      ),
      Effect.forkScoped,
    );
  }).pipe(Effect.withSpan("desktop.forkUpdates.startupCheck"));

  return ForkUpdateChecker.of({
    getState: Ref.get(updateStateRef),
    emitState,
    configure: Effect.gen(function* () {
      if (!forkModeEnabled) {
        yield* logForkInfo("fork mode disabled - set T3CODE_FORK_MODE=1 and T3CODE_FORK_REPO");
        return;
      }

      yield* logForkInfo("fork mode enabled", {
        repo: Option.getOrNull(forkRepo),
        currentCommit: Option.getOrNull(config.commitHashOverride)?.slice(0, 12),
      });
      yield* startupCheck;
    }).pipe(Effect.withSpan("desktop.forkUpdates.configure")),
    check: Effect.fn("desktop.forkUpdates.manualCheck")(function* (reason: string) {
      yield* Effect.annotateCurrentSpan({ reason });
      const checked = yield* checkForForkUpdates(reason);
      return {
        checked,
        state: yield* Ref.get(updateStateRef),
      };
    }),
  });
});

export const layer = Layer.effect(ForkUpdateChecker, make);
