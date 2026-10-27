---
name: merge-upstream
description: Merge an upstream pingdotgg/t3code stable release into this fork's main while preserving every fork-only change, adapting fork code to upstream refactors, and deleting fork code that upstream has since implemented itself. Use when the "Sync Fork with Upstream" workflow reports a conflict, when handed a link to one of its Actions runs, or when asked to sync/merge upstream into main.
---

# Merge upstream into the fork

This repository is a fork of `pingdotgg/t3code` (remote `upstream`) with its own long-lived features. `.github/workflows/sync-upstream.yml` merges the newest upstream **stable** tag (`vX.Y.Z`, no `-nightly`/`-beta` suffix) into `main` daily. It aborts and fails the run whenever a path outside its `IGNORE_PATHS` allowlist (the workflows the fork deletes) conflicts. This skill is the manual path that takes over from there.

The goal is never "make the merge succeed". It is: **land the upstream release with every fork behavior still working**, changing fork code only where upstream forced it, and removing fork code only where upstream now does the same job.

Run the shell steps with the Bash tool (Git Bash); the PowerShell tool is fine for `gh` and `pnpm`.

## 1. Identify the target tag

If given an Actions run link, read it: `gh run view <run-id> --repo HolzfeallerJoe/t3code-fork-with-adjustments` (add `--log-failed` for the merge step output). The run summary names the tag and the conflicting paths.

`gh` is often unauthenticated on this machine. Do not stall on it — derive the same facts locally:

```bash
git fetch upstream --tags --prune
# newest stable tag
git tag -l 'v*' --sort=-version:refname | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | head -1
# already merged?
git merge-base --is-ancestor <tag> HEAD && echo "already synced" || echo "needs sync"
```

State the tag you are about to merge before merging it. If the run points at an older tag than the newest stable one, ask which the user wants.

## 2. Snapshot the fork delta first

The last stable tag already merged into `main` is the baseline; the diff from it to `HEAD` is the complete set of fork changes and the preservation checklist for this merge.

```bash
LAST=$(git tag -l 'v*' --sort=-version:refname | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' \
  | while read -r t; do git merge-base --is-ancestor "$t" HEAD && { echo "$t"; break; }; done | head -1)
echo "$LAST"
git diff "$LAST"..HEAD --stat
git log --oneline --no-merges "$LAST"..HEAD
```

Keep that file list. After the merge, every entry must be accounted for as **kept**, **adapted**, or **deliberately dropped with a reason**. Regenerate it this way rather than trusting the inventory below to be current.

## 3. Fork feature inventory

As of `v0.1.3`, the fork owns these features. Files move; the intent is what must survive.

| Feature                                                                 | Main files                                                                                                                                                                                                                                                                                                                                                                                                           | Intent                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fork auto-updater (desktop checks this fork's releases, not upstream's) | `apps/desktop/src/updates/ForkUpdateChecker.ts`, `apps/desktop/src/ipc/{channels.ts,DesktopIpcHandlers.ts,methods/updates.ts}`, `apps/desktop/src/{main.ts,preload.ts,app/DesktopApp.ts,app/DesktopConfig.ts}`, `packages/contracts/src/ipc.ts`, `apps/web/src/state/forkUpdate.ts`, `apps/web/src/components/forkUpdate.logic.ts`, `apps/web/src/components/sidebar/SidebarForkUpdatePill.tsx`, `SidebarChrome.tsx` | Update checks and the sidebar update pill point at `HolzfeallerJoe/t3code-fork-with-adjustments` releases                                                                                                                                                                    |
| Usage / rate-limit display                                              | `apps/web/src/lib/usageLimits.ts` (+`.test.ts`), `apps/web/src/components/UsageLimitStrip.tsx`, `BranchToolbar.tsx`, `ChatView.tsx` (`contextWindow` and `providerInstanceId` props), `usageLimitDisplayMode` in `packages/contracts/src/settings.ts` (toggle under Settings → Chat → Composer in `SettingsPanels.tsx`)                                                                                              | An always-visible composer strip shows context window and the active instance's rate-limit windows, read from upstream's `ServerProvider` usage snapshot. Upstream's own `/usage-limits` banner and Usage page are on-demand and do not replace it                           |
| Per-instance default model options (default reasoning effort)           | `defaultOptions` in `ProviderModelPreferences` + `setProviderDefaultOptions` in `ServerSettingsPatch` (`packages/contracts/src/settings.ts`), `packages/shared/src/serverSettings.ts` (+test), `apps/web/src/components/settings/{ProviderModelsSection.tsx,ProviderInstanceCard.tsx,ProviderSettingsPanel.tsx}`, `apps/web/src/modelSelection.ts` (+`.test.ts`), `composerDraftStore.ts`                            | Each provider instance carries default option selections that seed new sessions. Since v0.1.0 they live in environment-shared server settings beside upstream's hidden models and model order, and legacy client values migrate through upstream's `migrateModelPreferences` |
| Fork build & release plumbing                                           | `scripts/prepare-fork-build.ts`, `scripts/build-fork-installer.ts`, `package.json` scripts `prepare:fork-build` / `dist:fork`, `.env.fork` in `.gitignore`                                                                                                                                                                                                                                                           | Fork-branded installers built with pnpm (the repo's package manager)                                                                                                                                                                                                         |
| Sync/CI shape                                                           | `.github/workflows/sync-upstream.yml`, `.gitattributes` `merge=ours` rule, the **deleted** workflows listed in `FORK.md`, `FORK.md` itself, AGENTS.md "Verifying" section                                                                                                                                                                                                                                            | Fork has no CI; the workflows it cannot run must never come back                                                                                                                                                                                                             |
| Dev-time updater suppression                                            | `T3CODE_DISABLE_AUTO_UPDATE ??= "1"` in `apps/desktop/scripts/{dev-electron.mjs,start-electron.mjs}`                                                                                                                                                                                                                                                                                                                 | Dev/start Electron runs never auto-update                                                                                                                                                                                                                                    |

## 4. Merge

```bash
git status --porcelain        # must be clean
git switch main
git config merge.ours.driver true   # required by the .gitattributes merge=ours rule
git merge <tag> --no-edit -m "Merge upstream stable release <tag>"
git diff --name-only --diff-filter=U
```

Do not `git merge --abort` once you have started resolving — resolving is the job. Aborting is only acceptable immediately after the merge command, before any edits.

Never rebase the fork's commits onto upstream, never squash upstream history, never force-push `main`.

## 5. Resolve conflicts

For each conflicting hunk, pick one of four outcomes and be able to say why:

1. **Keep fork** — fork-only code upstream knows nothing about.
2. **Take upstream** — upstream rewrote code the fork only incidentally touched.
3. **Re-express fork intent on upstream's new shape** — the common and most important case: the fork's behavior stays, written against upstream's new API, pattern, or file layout.
4. **Drop the fork change** — upstream now implements the same thing, or the thing the fork's change worked around is gone. Deleting is correct here; note it in the summary.

Never resolve by dropping fork behavior just to make the conflict disappear — that is outcome 4 without the justification.

Standing rules:

- **Deleted workflows stay deleted.** The fork removes every workflow it cannot run — the table in [`FORK.md`](../../../FORK.md#workflows-the-fork-does-not-run) is the authoritative list, mirrored by `IGNORE_PATHS` in `sync-upstream.yml`. Any of these that upstream edits comes back as a **modify/delete** conflict; `merge=ours` does not prevent that (it only covers content conflicts), so the resolution is always `git rm -f <path>`. Keep `issue-labels.yml`, `pr-size.yml`, and `pr-vouch.yml` — they run on stock runners with only `GITHUB_TOKEN`. If upstream adds a _new_ workflow, keep it only if it needs neither a `blacksmith-*` runner nor secrets the fork lacks; otherwise delete it with its helper scripts and add it to both the FORK.md table and `IGNORE_PATHS`. The same goes for a new `.github/scripts` helper that only parses a deleted workflow (precedent: `vercel-deployment-output.test.cjs` in v0.1.2). A helper that local tooling imports stays and stays out of `IGNORE_PATHS`, which pins paths to the fork's copy: `ci-changes.cjs` backs `vp run check:changed`.
- `.github/workflows/sync-upstream.yml` is fork-only; keep the fork's version unless upstream's tooling changed in a way it must track.
- Package manager is pnpm (`packageManager: pnpm@12.14.0`). Fork scripts shell out via pnpm; if upstream changes the package manager again, update `scripts/prepare-fork-build.ts` and `scripts/build-fork-installer.ts` to match (precedent: commit `ef91120b2`).
- On `pnpm-lock.yaml` conflicts, take upstream's file whole (`git checkout --theirs -- pnpm-lock.yaml`) and then run `pnpm install` to reconcile; never hand-merge the lockfile.
- On conflicts in files the fork only touched for formatting, take upstream and re-apply nothing.

## 6. Realign fork features the merge did not flag

This is where fork breakage actually lives: upstream refactors that do **not** conflict but leave fork code calling a removed API, importing a dropped dependency, or sitting in a code path upstream stopped using. Git will merge those cleanly and silently.

Walk the inventory from step 2/3 and check each feature's integration points against the new upstream code — dependency removals, changed test-runner imports, replaced state patterns, renamed contracts, relocated components. Precedent: commit `77d5e75e5` had to port the update pill off `@tanstack/react-query` after upstream dropped it, and move a test onto `vite-plus/test`.

Land these as a follow-up commit, e.g. `Realign fork features with upstream <tag> conventions`, so the merge commit stays a merge.

## 7. Verify

A whole-release merge is the explicit exception to AGENTS.md's "no repo-wide checks" rule — the merge touches the entire tree, so narrow checks prove nothing:

If `pnpm tc` fails with `Cannot find module ...typescript@<old>...`, pnpm left stale workspace `node_modules/.bin` shims after a dependency swap: delete the shims that name the old version and rerun `pnpm install --offline`. `vp` is not on PATH in PowerShell; use `pnpm exec vp`.

```bash
pnpm tc                 # repo-wide typecheck
pnpm fmt:check
pnpm lint
```

Then run the fork-owned tests directly, e.g. `apps/web/src/lib/usageLimits.test.ts`, `apps/web/src/modelSelection.test.ts`, `packages/shared/src/serverSettings.test.ts`, `apps/desktop/src/updates/DesktopUpdates.test.ts`, `apps/desktop/src/settings/DesktopClientSettings.test.ts`. On Windows, `DesktopClientSettings`' symlink test and `DesktopUpdates`' Linux `.deb` test fail on path separators in upstream code; that is not merge breakage.

Report failures honestly, including any that were already failing before the merge (check with `git stash`/`git worktree` on the pre-merge commit if unsure).

## 8. Land it

Once the merge and realign commits are in and verification shows no breakage the merge caused, push the current branch to origin without asking:

```bash
git push origin HEAD
```

Never force-push. If the push is rejected because origin moved, fetch and merge `origin/<branch>`, re-verify, and push again.

Then summarize:

- tag merged, and the diffstat of the merge;
- every conflict, with which of the four outcomes it got;
- fork changes adapted to upstream's new shape;
- fork changes deleted, each with the upstream feature that replaced it;
- verification results.
