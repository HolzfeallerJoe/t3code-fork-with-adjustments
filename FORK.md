# Fork maintenance

This repository is a fork of [`pingdotgg/t3code`](https://github.com/pingdotgg/t3code) with its own long-lived features (fork auto-updater, usage/rate-limit display, per-instance default model options, fork-branded installers). This file documents how the fork stays current with upstream. Everything else in the docs is upstream's.

## Automated upstream sync

[`.github/workflows/sync-upstream.yml`](.github/workflows/sync-upstream.yml) runs daily at 06:00 UTC (and on manual dispatch, with a `force_sync` input). It merges the newest upstream **stable** tag — `vX.Y.Z`, never `-nightly` or `-beta` — into `main` and pushes.

It deliberately does not try to be clever about conflicts: anything other than `.github/workflows/release.yml` conflicting aborts the merge, fails the run, and writes the manual-merge instructions to the run summary. `release.yml` is exempt because `.gitattributes` marks it `merge=ours` — the fork deletes upstream's release workflow and must keep it deleted.

For the manual merge that takes over from a failed run, use the `merge-upstream` skill: [`.agents/skills/merge-upstream/SKILL.md`](.agents/skills/merge-upstream/SKILL.md).

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
