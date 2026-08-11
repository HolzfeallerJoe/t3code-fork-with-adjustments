---
name: merge-upstream
description: Merge an upstream pingdotgg/t3code stable release into this fork's main while preserving every fork-only change, adapting fork code to upstream refactors, and deleting fork code that upstream has since implemented itself. Use when the "Sync Fork with Upstream" workflow reports a conflict, when handed a link to one of its Actions runs, or when asked to sync/merge upstream into main.
---

# Merge upstream into the fork

This repository is a fork of `pingdotgg/t3code` (remote `upstream`) with its own long-lived features. `.github/workflows/sync-upstream.yml` merges the newest upstream **stable** tag (`vX.Y.Z`, no `-nightly`/`-beta` suffix) into `main` daily. It aborts and fails the run whenever anything other than `.github/workflows/release.yml` conflicts. This skill is the manual path that takes over from there.

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

As of `v0.0.31`, the fork owns these features. Files move; the intent is what must survive.

| Feature                                                                 | Main files                                                                                                                                                                                                                                                                                                                                                                                                           | Intent                                                                                                    |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Fork auto-updater (desktop checks this fork's releases, not upstream's) | `apps/desktop/src/updates/ForkUpdateChecker.ts`, `apps/desktop/src/ipc/{channels.ts,DesktopIpcHandlers.ts,methods/updates.ts}`, `apps/desktop/src/{main.ts,preload.ts,app/DesktopApp.ts,app/DesktopConfig.ts}`, `packages/contracts/src/ipc.ts`, `apps/web/src/state/forkUpdate.ts`, `apps/web/src/components/forkUpdate.logic.ts`, `apps/web/src/components/sidebar/SidebarForkUpdatePill.tsx`, `SidebarChrome.tsx` | Update checks and the sidebar update pill point at `HolzfeallerJoe/t3code-fork-with-adjustments` releases |
| Usage / rate-limit display                                              | `apps/web/src/lib/usageLimits.ts` (+`.test.ts`), `apps/web/src/components/UsageLimitStrip.tsx`, `BranchToolbar.tsx`, `apps/web/src/state/entities.ts`, `apps/server/src/orchestration/Layers/{ProjectionPipeline.ts,ProviderRuntimeIngestion.ts}` (+tests)                                                                                                                                                           | Provider rate-limit data is ingested, projected, and surfaced in the UI                                   |
| Per-instance default model options (default reasoning effort)           | `apps/web/src/components/settings/{ProviderModelsSection.tsx,ProviderInstanceCard.tsx,SettingsPanels.tsx}`, `apps/web/src/modelSelection.ts` (+`.test.ts`), `composerDraftStore.ts`, `session-logic.ts`, `packages/contracts/src/settings.ts`                                                                                                                                                                        | Each provider instance carries default model + reasoning effort that seed new sessions                    |
| Fork build & release plumbing                                           | `scripts/prepare-fork-build.ts`, `scripts/build-fork-installer.ts`, `package.json` scripts `prepare:fork-build` / `dist:fork`, `.env.fork` in `.gitignore`                                                                                                                                                                                                                                                           | Fork-branded installers built with pnpm (the repo's package manager)                                      |
| Sync/CI shape                                                           | `.github/workflows/sync-upstream.yml`, `.gitattributes` `merge=ours` rule, **deleted** `.github/workflows/release.yml`, `FORK.md`, AGENTS.md "Verifying" section                                                                                                                                                                                                                                                     | Fork has no CI; upstream's release workflow must never come back                                          |
| Dev-time updater suppression                                            | `T3CODE_DISABLE_AUTO_UPDATE ??= "1"` in `apps/desktop/scripts/{dev-electron.mjs,start-electron.mjs}`                                                                                                                                                                                                                                                                                                                 | Dev/start Electron runs never auto-update                                                                 |

## 4. Merge

```bash
git status --porcelain        # must be clean
git switch main
git config merge.ours.driver true   # required by .gitattributes for release.yml
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

- `.github/workflows/release.yml` stays deleted. `.gitattributes` marks it `merge=ours`, which needs the `merge.ours.driver` config above; if it reappears, `git rm -f .github/workflows/release.yml`.
- `.github/workflows/sync-upstream.yml` is fork-only; keep the fork's version unless upstream's tooling changed in a way it must track.
- Package manager is pnpm (`packageManager: pnpm@11.10.0`). Fork scripts shell out via pnpm; if upstream changes the package manager again, update `scripts/prepare-fork-build.ts` and `scripts/build-fork-installer.ts` to match (precedent: commit `ef91120b2`).
- On `pnpm-lock.yaml` conflicts, take upstream's file whole (`git checkout --theirs -- pnpm-lock.yaml`) and then run `pnpm install` to reconcile; never hand-merge the lockfile.
- On conflicts in files the fork only touched for formatting, take upstream and re-apply nothing.

## 6. Realign fork features the merge did not flag

This is where fork breakage actually lives: upstream refactors that do **not** conflict but leave fork code calling a removed API, importing a dropped dependency, or sitting in a code path upstream stopped using. Git will merge those cleanly and silently.

Walk the inventory from step 2/3 and check each feature's integration points against the new upstream code — dependency removals, changed test-runner imports, replaced state patterns, renamed contracts, relocated components. Precedent: commit `77d5e75e5` had to port the update pill off `@tanstack/react-query` after upstream dropped it, and move a test onto `vite-plus/test`.

Land these as a follow-up commit, e.g. `Realign fork features with upstream <tag> conventions`, so the merge commit stays a merge.

## 7. Verify

A whole-release merge is the explicit exception to AGENTS.md's "no repo-wide checks" rule — the merge touches the entire tree, so narrow checks prove nothing:

```bash
pnpm tc                 # repo-wide typecheck
pnpm fmt:check
pnpm lint
```

Then run the fork-owned tests directly, e.g. `apps/web/src/lib/usageLimits.test.ts`, `apps/web/src/modelSelection.test.ts`, `apps/server/src/orchestration/Layers/ProjectionPipeline.test.ts`, `ProviderRuntimeIngestion.test.ts`, `apps/desktop/src/updates/DesktopUpdates.test.ts`.

Report failures honestly, including any that were already failing before the merge (check with `git stash`/`git worktree` on the pre-merge commit if unsure).

## 8. Land it

Summarize before pushing:

- tag merged, and the diffstat of the merge;
- every conflict, with which of the four outcomes it got;
- fork changes adapted to upstream's new shape;
- fork changes deleted, each with the upstream feature that replaced it;
- verification results.

`main` is the fork's published branch: **do not `git push origin main` until the user confirms.** If they want a safety net instead, park the resolved merge on `sync/<tag>` and push that branch for review.
