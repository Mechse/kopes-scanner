# Git source pilot operations

This feature is not generally released. Review `plans/phase-6/README.md` before enabling it. Enabling pilots or deploying/upgrading a live installation requires the operator's explicit authorization.

## Flags and permissions

- `KOPES_SOURCE_PILOT=1`: administrator-managed source connections and project source views.
- `KOPES_SOURCE_SCAN_PILOT=1`: source job admission/processing; requires the connection flag and an isolated worker.
- `KOPES_PROVENANCE_PILOT=1`: separate provenance collection/display. It does not enable verified-runtime publication.
- `KOPES_SOURCE_SPOOL`: dedicated shared input/output volume root. Never point this at the application data directory.
- `KOPES_GITLAB_ORIGINS`: comma-separated approved HTTPS self-hosted origins.
- `KOPES_GITLAB_PRIVATE_ORIGINS`: explicit subset allowed to resolve to private addresses. Loopback/link-local/metadata addresses remain rejected. Do not use this to trust arbitrary user input.
- `KOPES_GITLAB_CA_PEM`: optional CA PEM for provider transport. TLS verification is never disabled.

Projects require explicit memberships for source data. Legacy inventory access does not grant source access. Administrators manage projects/connections; members can read assigned source results and request scans. Unassigned discoveries remain visible to administrators for adoption. Resource moves preserve settings by default, preview resets, and detach old project source links. Conflicting aliases are kept separate for review, never silently merged.

GitHub: configure a GitHub App or fine-grained PAT in [GitHub connections](github-connections.md). These are separate from sign-in OAuth. GitLab: for new imports use [personal GitLab consent](gitlab.md), which requests `read_api` separately from sign-in. Legacy pilot token connections remain supported; repository-only tokens may not cover MR history. Minimum scopes/roles and self-hosted versions still require live validation. Never request write scopes for this pilot.

## Worker and data

For local Docker Desktop development with source scanning, set `KOPES_SOURCE_DB_DIR` in `.env` to a durable directory containing `db/trivy.db` and `db/metadata.json`, then run `pnpm dev:docker:source`. To preserve source scanning across ordinary development rebuilds, set `COMPOSE_FILE=compose.yaml:compose.local.yaml:compose.desktop.yaml:compose.dev.yaml:compose.source.yaml` in `.env`. Both `pnpm dev:docker` and `docker compose up -d --build` honor this configuration; `pnpm dev:docker:source` also adds the source overlay when it is absent. Without a configured `COMPOSE_FILE`, `pnpm dev:docker` uses the base, local, Desktop and development overlays. Keep the source overlay after the Desktop overlay so its shared volumes are retained.

The worker uses an immutable database snapshot and cannot refresh it without network access. Prepare a fresh snapshot in a new directory, update `KOPES_SOURCE_DB_DIR`, and recreate the worker when no source job is running. The snapshot's `db/metadata.json` records its update time and next expected refresh.

`compose.source.yaml` is an opt-in overlay. It supplies a separate worker with no network, secrets, host mounts or Docker proxy. `KOPES_SOURCE_DB_DIR` must contain an immutable public Trivy snapshot under `db/` (including `trivy.db` and `metadata.json`). Refresh the snapshot outside active analysis and restart the worker against the new snapshot; never mount the application's whole data volume. Input/output volumes must be owned by UID 65532. The worker image creates matching `/spool/in` and `/spool/out` directories for named-volume initialization; start the worker before the development scanner when initializing new volumes.

Only allowlisted dependency files are fetched, at full commit SHAs. Raw input bundles are removed after processing. Normalized inventories, graphs, SBOMs, scans and evidence remain in SQLite. Repeated matching uses the saved SBOM and preserves authoritative filesystem graph/scope data. No private source is sent to an AI service.

Retention pruning is not enabled: active, deployed, unresolved and historical evidence must not be removed casually. Source admission has conservative disk/result limits; monitor volume/database size during the pilot. A full sustained retention/pressure benchmark remains a release gate.

## Webhooks and polling

Personal GitLab connections use polling only; there is no webhook to configure. For legacy pilot connections, polling is enabled as reconciliation even with hooks. An administrator can retrieve connection-specific setup values through `GET /api/data/source?view=webhook&connectionId=…` while signed in. Register the returned URL/secret manually for push events; Kopes does not change upstream hooks. GitHub validates `X-Hub-Signature-256`; GitLab validates `X-Gitlab-Token` and requires an event UUID for deduplication. Do not claim a self-hosted version supports this until tested. Rotating credentials also changes the derived hook secret; update the manual registration or rely on polling. Do not paste secrets into issues/chat.

## Backup, recovery and rollback

Before upgrading a real installation, take a consistent database/data backup and preserve the authentication encryption secret. Local rehearsal can use `node --import tsx scripts/rehearse-project-migration.ts PATH_TO_DATABASE`; it opens the source read-only, upgrades a disposable backup, compares legacy rows and verifies restore. It does not migrate the supplied database.

Schema version 18 removes legacy GitHub source connections and retains their scan history. Older binaries reject newer schemas. Turning flags off stops new pilot work but does not downgrade schema. Binary rollback requires the pre-upgrade data backup and matching older application version/secret. No in-place downgrade is provided.

Interrupted jobs recover on restart; source retries are bounded and errors preserve prior results. Disconnect removes the encrypted token and cancels pending work; data purge is a separate action. An active worker claim prevents another expensive scan from starting while cancellation stops the analyzer. Restarting the worker clears claims from the terminated process. If the worker stays offline, restart it before resuming scanning, or clear only stale job spool files while all workers are stopped—never delete the saved database or inventories as a recovery shortcut.

## Reproducing local checks

- `pnpm typecheck`, `TERM=xterm-256color pnpm test`, `pnpm build`, `pnpm test:production`.
- `node --import tsx scripts/rehearse-project-migration.ts` for a read-only local backup rehearsal.
- `node --import tsx scripts/probe-source-provider.ts github OWNER/REPO --bundle` (public GETs only); substitute `gitlab` for GitLab.com.
- Build the dedicated local worker with `docker build -f Dockerfile.source-worker -t kopes-source-worker:validation .`, then run `python3 scripts/validate-source-worker.py`: a disposable network-disabled Docker fixture matrix using that packaged image and the `/tmp/kopes-phase0/db` snapshot. Optional public bundles are read from `/tmp/kopes-public-npm.json` and `/tmp/kopes-public-pnpm.json`.
- `scripts/validate-project-ui.ts`: disposable production build/browser smoke; requires a local Playwright driver and Chrome. Includes populated source/remediation views with synthetic evidence; no live database is opened for writing.

See each phase report for measured evidence and unvalidated gates. A zero-finding result, successful deployment, or matching image tag never establishes a verified fix.
