# Phase 1 — identity and access foundation

Date: 2026-11-09. Status: **local management/migration/access acceptance implemented and tested; live deployment rehearsal remains a release gate**.

The user authorized implementation after the Phase 0 report. External gates remain gates for dependent functionality, rather than a prohibition on independent local work. Subsequent gated implementation and validation is recorded in the Phase 2–6 reports; Phase 7 remains excluded. Nothing was deployed and no production database or provider settings were changed.

## Implemented

- Additive schema version 6 migration, with new tables and backfill inside one transaction. Existing settings, display names, access grants, bookmarks, timelines and current reports remain in their original tables. Current completed reports/SBOMs are copied into durable observations, explicitly marked imported. No missing history or actor is invented.
- Stable generated project/resource IDs, explicit project membership using authenticated user IDs, environment metadata, discovery aliases, legacy-key mappings and runtime observations. New resources are unassigned; discovered groups do not become projects or grants.
- Compose project/service and Coolify UUID-based discovery keys. The existing scanner is single-host, so keys use a local installation namespace. A multi-host extension must add explicit host/instance identities before reuse. Coolify label handling is a locally tested contract, not live compatibility certification.
- Same-container identity bridges the migration to subsequently discovered stable aliases. Without a stable key or the same container ID, a replacement creates an unassigned resource. Similar names never silently join history. Old aliases and runtime observations remain stored.
- Durable reports and SBOMs for every successful scan, linked to resources observed at collection time; deleting transient image targets no longer deletes these copies. Host observations remain instance-scoped. No provider/source SHA or runtime verification is inferred.
- Administrator project create/rename/archive, membership grant/revoke, resource assignment preview and move APIs. Moves preserve effective settings unless explicitly reset. Events record the authenticated administrator and the local action, without attributing Git actions.
- `/api/data/projects` obtains its principal from the authenticated server session. Lists filter before returning data; detail reads require explicit membership or administrator access. Mutations require administrator access and same-origin requests. Responses are not cached. Existing instance inventory access stays intact and contains no private source enrichment.
- Scheduler/settings integration uses preserved effective settings for an unambiguous active stable resource. Legacy settings edits remain supported.

## Local acceptance

Tests in `test/projects.test.ts` cover identity through replacement/rename/image change, duplicate names, conservative unknown replacement handling, move/reset settings, explicit grants/revocation, guessed IDs, member writes, cross-origin requests, forged request fields, import idempotence and durable reports after inventory cleanup.

The migration rehearsal uses a populated **synthetic v5 database in a temporary directory**, not a production copy. It compares legacy tables before/after, preserves display/settings values, reopens the migrated database and retains observations after target cleanup. This is not the Phase 6 real-database upgrade/restore rehearsal.

Initial-increment validation on 2026-11-09 (superseded by the final totals in `../phase-6/acceptance.json`):

- Typecheck: passed.
- Production build: passed.
- Full tests: 97 tests, 94 passed, 3 existing integration skips, zero failures (`TERM=xterm-256color pnpm test`). This includes concurrent favourites work present in the shared workspace.
- Production smoke: 2/2 passed against a temporary copy of the built output, to avoid interference from concurrent builds.
- `git diff --check`: passed.
- The default terminal setting initially failed the existing setup TTY assertion; rerunning with a terminal type passed. An initial production run lost its shared build entry during concurrent work; the isolated build copy passed both checks.

At that initial increment, the three skips were the Compose deployment, VPS installer, and socket-proxy integration tests. Compose/installer checks were subsequently exercised with Docker enabled; the final acceptance report records the remaining skip. They are not passed release gates. No provider mock is counted as a live provider pass.

## Completed follow-up

- Managed-project UI with create/rename/archive, explicit user membership, discovered-group suggestions, assignment previews, environment/name editing, project defaults, preserve-versus-reset settings, and stable resource links.
- Assignment previews use a revision digest; stale settings/ownership previews are rejected. Inherited resources follow later project defaults; preserved resources remain pinned.
- Conflicting aliases preserve distinct resource IDs and show an identity warning. Unidentified replacements remain unassigned. Moving a resource detaches source links belonging to its previous project.
- Project-scoped retained history, exports and scan requests recheck ownership/membership, including guessed IDs and shared images. Source data is never added to legacy instance inventory/search/feed responses.
- Named resource changes propagate through unambiguous legacy aliases without rewriting original historical event rows or silently renaming separate runtime instances.
- Browser tests cover create, assignment, rename/reload and desktop/mobile layouts against a disposable database. See `browser-evidence.json`.
- A read-only SQLite online backup of the existing local version-2 database was upgraded in a disposable directory; existing tables were compared and restore verified. The original schema was unchanged. See `migration-evidence.json`. This complements the populated synthetic v5 fixture; it does not claim to be a live production upgrade.

Current application schema version is 9: v6 identity/evidence, v7 source storage, v8 settings inheritance mode, v9 explicit identity conflicts. Changes are additive and versioned. Actual deployment/production migration remains unauthorized and was not performed. Sustained retention/disk validation remains a Phase 6 gate.
