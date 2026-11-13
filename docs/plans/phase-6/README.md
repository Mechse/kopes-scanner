# Phase 6 — validation and release status

**Release is blocked; no production readiness claim.** Local implementation is available behind independent opt-in pilot flags. Phase 7 repository writes are absent.

## Executed locally

- Transactional synthetic v5 migration plus read-only online backup of the existing local v2 database. Original tables and schema stayed unchanged; the disposable upgraded copy and backup restore were verified. Evidence: `../phase-1/migration-evidence.json`.
- Project create/assign/rename/reload and mobile-width browser checks against a copied build and disposable database. Evidence: `../phase-1/browser-evidence.json`.
- Actual unauthenticated GitHub/GitLab.com adapter reads, stored separately from permission assumptions.
- Public npm application (`nestjs/typescript-starter`) and pnpm workspace/library (`pmndrs/zustand`) dependency inputs fetched at immutable commits; see the adjacent hash/identity evidence. No repository source scripts were fetched or run.
- Isolated packaged-worker synthetic and public runs, linked-workspace/alias/peer graph assertions, lifecycle marker check, active cancellation without result publication, pending-input restart recovery, and SBOM rematch retaining scopes. Evidence: `../phase-3/worker-evidence.json`.
- Populated two-repository browser fixtures on desktop/mobile: editable parents, unknown coverage, errors retaining history, export, disabled scan controls and separate fix/deployment labels. See `browser-source-evidence.json`.
- Unit tests for shared-image authorization, membership revocation, stale assignment previews, conflicting discovery aliases, encryption, hooks/replay, restart recovery, evidence attribution, incomplete coverage and rollback rules.

Final local acceptance is recorded in `acceptance.json`: 130 regression tests, 129 passed, one HAProxy-dependent skip, zero failures; typecheck/build passed; two production smoke tests passed; populated desktop/mobile browser checks passed; thirteen packaged-worker cases passed. Active cancellation released the claim in 0.15 seconds, without publishing a result. No OOM kills occurred, but total memory accounting reached the configured 1 GiB ceiling. An earlier public worker attempt was interrupted because Docker Desktop stopped; after the user restarted it, the checks were rerun. Earlier successes were never relabelled as covering the interrupted attempt.

## Release gates still open

1. Private GitHub App and GitLab.com least-privilege lifecycle tests, and a certified self-hosted GitLab version/network/CA matrix. Public reads cannot satisfy these.
2. Live Coolify version and deployment/image linkage matrix. No automatic verified-runtime status is released until these pass.
3. Package-manager-generated advanced dependency compatibility fixtures (authored contract fixtures now pass), validated Yarn support if included, sustained worker restart/cancellation/disk-pressure tests, retention controls and restore rehearsal on the intended deployment footprint. Container memory accounting reached the 1 GiB worker ceiling after adding database hashing, with no OOM kill; this still needs a sustained footprint check.
4. Multi-repository private pilot with real membership changes, webhook delivery, force pushes, transfer/rename, branch deletion, provider outages and full end-to-end remediation.
5. Browser walkthroughs on private pilot accounts and the live deployment evidence matrix. Populated synthetic source/remediation browser checks pass locally but do not satisfy live integration checks.

These gates are not silently waived. Runtime inventory and historical evidence continue to work while source/provenance pilots are off. No production data migration, provider configuration change or deployment was performed.

## Deliberate limitations and design changes

- GitHub onboarding currently accepts a repository-selected App installation token. Automatic App JWT/token issuance and renewal are not implemented; expiry requires administrator rotation. Public access is suitable for local contracts, not private installation lifecycle certification.
- The dedicated offline process owns parsing and analyzer execution. A shared spool/activity claim coordinates expensive work without giving the worker Docker or scanner-data access. Single worker/installation ownership is required.
- Yarn is explicitly unsupported; real public npm/pnpm projects with unresolved consumer/workspace context remain partial, even when Trivy inventories their packages.
- Automatic runtime-verified and reopened publication is withheld until the real linkage/coverage gate passes. Pure evidence rules are tested, but provider-reported deployment alone cannot activate them.
- Retention is conservative: admission limits stop new source work, and no historical-evidence pruning runs. Sustained retention operations remain incomplete.
