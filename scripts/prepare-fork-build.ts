#!/usr/bin/env node

/**
 * Prepares environment variables for fork update feature.
 * Run this before building the desktop installer to enable fork update notifications.
 *
 * Usage:
 *   bun run prepare:fork-build
 *
 * This will:
 *   1. Detect your fork repo from git remote origin
 *   2. Get the current commit hash
 *   3. Write a .env.fork file with the necessary variables
 *
 * Then build with:
 *   - Windows: set /p x=<.env.fork && bun run dist:desktop:win
 *   - Unix: export $(cat .env.fork | xargs) && bun run dist:desktop:dmg
 */

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

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
  // Handle HTTPS URLs: https://github.com/owner/repo.git
  const httpsMatch = remoteUrl.match(/github\.com[/:]([^/]+\/[^/.]+)/);
  if (httpsMatch?.[1]) {
    return httpsMatch[1].replace(/\.git$/, "");
  }

  // Handle SSH URLs: git@github.com:owner/repo.git
  const sshMatch = remoteUrl.match(/git@github\.com:([^/]+\/[^/.]+)/);
  if (sshMatch?.[1]) {
    return sshMatch[1].replace(/\.git$/, "");
  }

  return undefined;
};

const prepareForkBuild = Effect.gen(function* () {
  const path = yield* Path.Path;
  const fs = yield* FileSystem.FileSystem;
  const repoRoot = yield* RepoRoot;

  yield* Effect.log("Preparing fork build configuration...");

  const commitHash = yield* resolveGitCommitHash();
  if (!commitHash) {
    yield* Effect.logError("Could not resolve git commit hash. Are you in a git repository?");
    return;
  }
  yield* Effect.log(`Commit hash: ${commitHash.slice(0, 12)}`);

  const remoteUrl = yield* resolveGitRemoteUrl();
  if (!remoteUrl) {
    yield* Effect.logError("Could not resolve git remote origin URL.");
    return;
  }
  yield* Effect.log(`Remote URL: ${remoteUrl}`);

  const forkRepo = parseGitHubRepo(remoteUrl);
  if (!forkRepo) {
    yield* Effect.logError("Could not parse GitHub repo from remote URL.");
    yield* Effect.logError(
      "Expected format: https://github.com/owner/repo or git@github.com:owner/repo",
    );
    return;
  }
  yield* Effect.log(`Fork repo: ${forkRepo}`);

  const envContent = [
    `T3CODE_FORK_MODE=1`,
    `T3CODE_FORK_REPO=${forkRepo}`,
    `T3CODE_COMMIT_HASH=${commitHash}`,
  ].join("\n");

  const envFilePath = path.join(repoRoot, ".env.fork");
  yield* fs.writeFileString(envFilePath, envContent + "\n");

  yield* Effect.log("");
  yield* Effect.log("Fork build configuration written to .env.fork:");
  yield* Effect.log("");
  yield* Effect.log(`  T3CODE_FORK_MODE=1`);
  yield* Effect.log(`  T3CODE_FORK_REPO=${forkRepo}`);
  yield* Effect.log(`  T3CODE_COMMIT_HASH=${commitHash.slice(0, 12)}...`);
  yield* Effect.log("");
  yield* Effect.log("To build with fork update support:");
  yield* Effect.log("");

  if (process.platform === "win32") {
    yield* Effect.log("  PowerShell:");
    yield* Effect.log(
      `    Get-Content .env.fork | ForEach-Object { $k,$v = $_ -split '=',2; Set-Item "env:$k" $v }; bun run dist:desktop:win`,
    );
    yield* Effect.log("");
    yield* Effect.log("  Or set variables manually:");
    yield* Effect.log(`    $env:T3CODE_FORK_MODE="1"`);
    yield* Effect.log(`    $env:T3CODE_FORK_REPO="${forkRepo}"`);
    yield* Effect.log(`    $env:T3CODE_COMMIT_HASH="${commitHash}"`);
    yield* Effect.log(`    bun run dist:desktop:win`);
  } else {
    yield* Effect.log("  export $(cat .env.fork | xargs) && bun run dist:desktop:dmg");
  }
});

const cliRuntimeLayer = Layer.mergeAll(Logger.layer([Logger.consolePretty()]), NodeServices.layer);

if (import.meta.main) {
  prepareForkBuild.pipe(Effect.scoped, Effect.provide(cliRuntimeLayer), NodeRuntime.runMain);
}
