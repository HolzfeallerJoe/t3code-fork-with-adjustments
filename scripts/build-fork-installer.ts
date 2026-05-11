#!/usr/bin/env node

/**
 * Builds a desktop installer with fork update support enabled.
 * This script automatically sets T3CODE_FORK_MODE, T3CODE_FORK_REPO, and T3CODE_COMMIT_HASH
 * before invoking the standard desktop artifact build.
 *
 * Usage:
 *   bun run dist:fork              # Build for current platform
 *   bun run dist:fork -- --arch x64   # With additional flags
 */

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

class ForkBuildError extends Data.TaggedError("ForkBuildError")<{
  readonly message: string;
}> {}

const RepoRoot = Effect.service(Path.Path).pipe(
  Effect.flatMap((path) => path.fromFileUrl(new URL("..", import.meta.url))),
);

const collectStreamAsString = <E>(stream: Stream.Stream<Uint8Array, E>): Effect.Effect<string, E> =>
  stream.pipe(
    Stream.decodeText(),
    Stream.runFold(
      () => "",
      (acc, chunk) => acc + chunk,
    ),
  );

const runGitCommand = Effect.fn("runGitCommand")(function* (args: string[]) {
  const repoRoot = yield* RepoRoot;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const child = yield* spawner.spawn(ChildProcess.make("git", args, { cwd: repoRoot }));

  const [stdout, exitCode] = yield* Effect.all([
    collectStreamAsString(child.stdout),
    child.exitCode.pipe(Effect.map(Number)),
  ]);

  if (exitCode !== 0) {
    return undefined;
  }

  return stdout.trim();
});

const resolveGitCommitHash = Effect.fn("resolveGitCommitHash")(function* () {
  const result = yield* runGitCommand(["rev-parse", "HEAD"]);
  if (!result || !/^[0-9a-f]{40}$/i.test(result)) {
    return undefined;
  }
  return result.toLowerCase();
});

const resolveGitRemoteUrl = Effect.fn("resolveGitRemoteUrl")(function* () {
  return yield* runGitCommand(["remote", "get-url", "origin"]);
});

const parseGitHubRepo = (remoteUrl: string): string | undefined => {
  const httpsMatch = remoteUrl.match(/github\.com[/:]([^/]+\/[^/.]+)/);
  if (httpsMatch?.[1]) {
    return httpsMatch[1].replace(/\.git$/, "");
  }

  const sshMatch = remoteUrl.match(/git@github\.com:([^/]+\/[^/.]+)/);
  if (sshMatch?.[1]) {
    return sshMatch[1].replace(/\.git$/, "");
  }

  return undefined;
};

const buildForkInstaller = Effect.gen(function* () {
  const repoRoot = yield* RepoRoot;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

  yield* Effect.log("Resolving fork configuration...");

  const commitHash = yield* resolveGitCommitHash();
  if (!commitHash) {
    yield* Effect.logError("Could not resolve git commit hash. Are you in a git repository?");
    return yield* new ForkBuildError({ message: "Missing commit hash" });
  }

  const remoteUrl = yield* resolveGitRemoteUrl();
  if (!remoteUrl) {
    yield* Effect.logError("Could not resolve git remote origin URL.");
    return yield* new ForkBuildError({ message: "Missing remote URL" });
  }

  const forkRepo = parseGitHubRepo(remoteUrl);
  if (!forkRepo) {
    yield* Effect.logError("Could not parse GitHub repo from remote URL.");
    return yield* new ForkBuildError({ message: "Invalid remote URL" });
  }

  yield* Effect.log(`Fork repo: ${forkRepo}`);
  yield* Effect.log(`Commit: ${commitHash.slice(0, 12)}`);
  yield* Effect.log("");
  yield* Effect.log("Building desktop installer with fork update support...");

  const buildEnv: NodeJS.ProcessEnv = {
    ...process.env,
    T3CODE_FORK_MODE: "1",
    T3CODE_FORK_REPO: forkRepo,
    T3CODE_COMMIT_HASH: commitHash,
  };

  const extraArgs = process.argv.slice(2);
  const buildArgs = ["run", "dist:desktop:artifact", ...extraArgs];

  const child = yield* spawner.spawn(
    ChildProcess.make("bun", buildArgs, {
      cwd: repoRoot,
      env: buildEnv,
      stdout: "inherit",
      stderr: "inherit",
      shell: process.platform === "win32",
    }),
  );

  const exitCode = yield* child.exitCode;

  if (exitCode !== 0) {
    yield* Effect.logError(`Build failed with exit code ${exitCode}`);
    return yield* new ForkBuildError({ message: `Build failed with exit code ${exitCode}` });
  }

  yield* Effect.log("");
  yield* Effect.log("Fork installer built successfully!");
});

const cliRuntimeLayer = Layer.mergeAll(Logger.layer([Logger.consolePretty()]), NodeServices.layer);

if (import.meta.main) {
  buildForkInstaller.pipe(
    Effect.scoped,
    Effect.provide(cliRuntimeLayer),
    Effect.catch(() => Effect.sync(() => process.exit(1))),
    NodeRuntime.runMain,
  );
}
