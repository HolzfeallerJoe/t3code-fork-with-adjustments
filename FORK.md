# Fork maintenance

This repository is a fork of [`pingdotgg/t3code`](https://github.com/pingdotgg/t3code) with its own long-lived features (fork auto-updater, usage/rate-limit display, per-instance default model options, fork-branded installers). This file documents how the fork stays current with upstream. Everything else in the docs is upstream's.

## Automated upstream sync

[`.github/workflows/sync-upstream.yml`](.github/workflows/sync-upstream.yml) runs daily at 06:00 UTC (and on manual dispatch, with a `force_sync` input). It merges the newest upstream **stable** tag — `vX.Y.Z`, never `-nightly` or `-beta` — into `main` and pushes.

It deliberately does not try to be clever about conflicts. A conflict in any path outside the `IGNORE_PATHS` allowlist in its merge step aborts the merge, fails the run, and writes the manual-merge instructions to the run summary. The allowlisted paths are the workflows the fork deletes (see below); for those the fork's own state is forced back in — kept, modified, or deleted — and the merge proceeds.

For the manual merge that takes over from a failed run, use the `merge-upstream` skill: [`.agents/skills/merge-upstream/SKILL.md`](.agents/skills/merge-upstream/SKILL.md).

## Workflows the fork does not run

Upstream's CI depends on infrastructure this fork does not have: [Blacksmith](https://blacksmith.sh) runners (`runs-on: blacksmith-*`), an Expo/EAS account, Vercel, and Cloudflare/PlanetScale/Axiom credentials. None of the workflows below carry a `github.repository ==` guard, so on the fork they queue for a runner that never arrives instead of skipping. They are deleted here:

| Deleted workflow                  | Why it cannot run on the fork                                                                                                    |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `ci.yml`                          | Blacksmith runners; the fork has no CI.                                                                                          |
| `release.yml`                     | Upstream's release pipeline; the fork ships via `pnpm dist:fork`.                                                                |
| `deploy-relay.yml`                | Blacksmith + Cloudflare/PlanetScale/Axiom secrets. Fired on every push to `main`.                                                |
| `desktop-macos-preview.yml`       | Blacksmith macOS + Linux runners.                                                                                                |
| `publish-aur.yml`                 | Blacksmith + `AUR_SSH_PRIVATE_KEY`; the fork does not publish to the AUR.                                                        |
| `mobile-eas-preview.yml`          | Blacksmith + `EXPO_TOKEN`.                                                                                                       |
| `mobile-eas-production.yml`       | Blacksmith + `EXPO_TOKEN`.                                                                                                       |
| `mobile-fingerprint-check.yml`    | Blacksmith. Fired on PRs touching `packages/**`, `scripts/**`, or the lockfile.                                                  |
| `mobile-showcase-screenshots.yml` | Blacksmith macOS + Linux runners.                                                                                                |
| `web-preview.yml`                 | Blacksmith + Vercel secrets.                                                                                                     |
| `thread-transfer-report.yml`      | Triggers on `workflow_run` of `CI`, which the fork deleted. Its `.github/scripts/thread-transfer-report.*` helpers went with it. |

Kept, because they run on stock GitHub runners with only `GITHUB_TOKEN`: `issue-labels.yml`, `pr-size.yml`, `pr-vouch.yml`, and the fork's own `sync-upstream.yml`.

**Consequence for syncing:** `merge=ours` in `.gitattributes` does _not_ protect a deleted file — git raises a modify/delete conflict regardless of the merge driver, as `release.yml` does on every sync that touches it. So whenever upstream edits any workflow in the table above, the daily sync will fail and want a manual merge whose resolution is always `git rm -f <path>`. That is the accepted cost of keeping the Actions tab clean. (The alternative, if the conflict churn ever outweighs it, is to restore the files and disable them per-repo under Actions → Workflows → Disable, which leaves no delete to conflict with.)

## Credentials

The sync workflow authenticates with the repository secret **`SYNC_PAT`**, which holds the fine-grained personal access token named **`ForkUpdater`** on the `HolzfeallerJoe` account.

|                   |                                                                            |
| ----------------- | -------------------------------------------------------------------------- |
| Secret            | `SYNC_PAT` (repository secret, Settings → Secrets and variables → Actions) |
| Token             | fine-grained PAT `ForkUpdater`                                             |
| Repository access | `HolzfeallerJoe/t3code-fork-with-adjustments`                              |
| Permissions       | Contents: read & write · Workflows: read & write                           |

A PAT is required rather than the built-in `GITHUB_TOKEN`: upstream releases regularly change files under `.github/workflows/**`, and `GITHUB_TOKEN` cannot push those — it has no `workflows: write` permission. The workflow's `secrets.SYNC_PAT || secrets.GITHUB_TOKEN` fallback only covers an _unset_ secret; a present-but-invalid token is used as-is and fails.

### When the token expires or is rotated

The run fails at the **checkout** step, before any merge work, with:

```
fatal: could not read Username for 'https://github.com': terminal prompts disabled
```

That message is misleading — the credential _was_ sent as an `AUTHORIZATION` extra header and GitHub rejected it with a 401; git then fell back to prompting, which the runner disallows. The repository being public does not help, because `actions/checkout` sends the token on reads too.

To fix: mint a replacement `ForkUpdater` token with the permissions above, update the `SYNC_PAT` secret, then dispatch the workflow once with `force_sync: true` to confirm it goes green. That dispatch is safe on an already-synced repo — the merge and push both no-op.

Note that nothing in the app surfaces a failed sync. The desktop update pill only polls for open issues labeled `upstream-sync` (`apps/desktop/src/updates/ForkUpdateChecker.ts`), and this workflow no longer opens issues. A failed-workflow email from GitHub is the only notification.
