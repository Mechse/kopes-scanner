# Git source and application security — phased plan

Status: Phase 1 management/migration/access flows and a gated source/provenance pilot are implemented locally. Phase 2–5 reports separate implementation from live compatibility. Phase 6 local acceptance is recorded (129 regression passes, one integration skip; 13 packaged-worker cases; desktop/mobile and migration checks passed); release validation remains incomplete: private-provider, self-hosted GitLab, Coolify-to-image, and sustained operational gates remain open. Phase 7 is excluded.

Implementation/acceptance records: [Phase 1](phase-1/README.md), [Phase 2](phase-2/README.md), [Phase 3](phase-3/README.md), [Phase 4](phase-4/README.md), [Phase 5](phase-5/README.md), [Phase 6](phase-6/README.md). Operator guide: [source pilot](../source-pilot.md).

Date: 2026-11-09.

Phase 0 artifacts: [validation report](phase-0/README.md), [entity/migration/UX design](phase-0/design.md), and reproducible fixtures/evidence in `phase-0/`. Read the measured limitations before implementing: SBOM re-import loses dev labels, pnpm needs workspace-root enrichment, and empty scan results do not prove coverage.

## 1. Outcome and agreed scope

Connect application source to the resources already scanned by Kopes, explain which direct dependencies introduce vulnerable packages, and preserve evidence of how remediation reaches a running application.

Agreed product decisions:

- Providers: GitHub, GitLab.com, and self-hosted GitLab.
- Initial ecosystem: JavaScript/TypeScript dependencies.
- Projects are user-managed applications/services. Discovered groups are suggestions for organizing resources.
- Projects can contain several repositories and resources; repositories can serve several projects or resources, including monorepos.
- Primary deployment workflow: Coolify builds directly from Git.
- Initial remediation: actionable guidance. Creating pull/merge requests is a later, separately enabled capability.
- Record authorship, review, merge, deployment, and verification separately, with unknowns explicit.
- Local analysis; no private source sent to external AI services. Administrator-managed connections and explicit project access.

Release 1 excludes SAST, secret scanning, infrastructure policy scanning, exploitability/reachability analysis, automatic merging/deployment, and non-JavaScript ecosystems. The data model should allow future analyzers without committing to them now.

## 2. Current implementation and consequences

The repository uses TanStack Start, SQLite, Trivy, and a single-host worker. Preserve that deployment model initially.

| Current behavior | Consequence for this feature |
| --- | --- |
| `src/lib/model.ts` defines host/image targets and flat findings | Add source snapshots and dependency graphs without conflating source with running images. |
| `src/lib/settings.ts` keys resources by project/name | Introduce stable IDs before source mappings; renames must not break history or settings. |
| `src/server/coolify.ts` retains names and identifiers only | Add narrowly selected source/deployment metadata; do not persist raw responses or deployment logs. |
| `src/server/trivy.ts` reduces reports to flat package/finding records | Preserve dependency edges, workspace roots, analyzer coverage, and scan provenance. |
| `src/lib/pulse.ts` uses `fix` for a newly available patched version | Label this “Fix available”; introduce separate applied/verified remediation events. |
| Findings are often grouped by advisory and scans are image-centric | Preserve occurrence-level identities so one fixed dependency/resource cannot close unrelated occurrences. |
| Access checks are primarily instance-wide | Implement project authorization before exposing private source results, search, exports, or timelines. |

## 3. Product model

**Project:** a stable, user-managed application/service boundary with a name, memberships, and settings. An environment is a resource attribute, not part of project identity.

**Resource:** a stable deployed service or database, independent of container replacement and display name. Each resource belongs to one project initially. Several runtime container instances may belong to it. Unassigned discoveries remain visible; the host remains instance-scoped.

**Repository:** provider instance plus immutable provider repository ID. URLs/names are mutable metadata. Store credentials separately from repository records.

**Source binding:** a project-scoped link to a repository, tracked branch, and workspace/folder selection. A resource can have multiple source bindings if its build uses several repositories. The same repository can have independent bindings in different projects.

**Source snapshot:** an exact commit and captured dependency inputs, with content hashes, inventory, dependency edges, coverage, analyzer version, and vulnerability database identity/time. A branch is a moving pointer, never a snapshot identity.

**Deployment observation:** provider deployment ID, resource/environment, source SHA(s), observed image ID/digest, status, timestamps, actor where known, and evidence strength. A successful deployment and the current running resource are separate facts.

**Finding occurrence:** advisory identity/aliases plus package identity, dependency location/context, and source or runtime observation. Persist recurring observations and resolution reasons. Cross-link matching source/runtime occurrences without collapsing them into one record.

**Remediation event:** an append-only observation with provider event ID, actor identity/type, source time, collection time, evidence references, and confidence. Corrections add new events rather than silently rewriting history.

Proposed storage groups: projects/memberships; resources/runtime instances/discovery aliases; provider connections; repositories/source bindings; snapshots/dependency nodes/edges; jobs/scans/coverage; finding occurrences/observations; deployments/source-image links; remediation events/provider delivery receipts. Exact table design belongs to Phase 0.

## 4. Evidence and status rules

Avoid a single linear status: source and runtime can disagree, and production and staging can differ.

| User-visible fact | Required evidence |
| --- | --- |
| Fix available | Advisory reports a patched package version; says nothing about application changes. |
| No longer vulnerable in source | Comparable scan of a specific commit with supported coverage; record update, removal, or advisory change as the reason. |
| Merged | Provider identifies the merged PR/MR and resulting commit on the tracked branch. Direct pushes are recorded separately. |
| Deployed | Evidence links a deployment and source commit to the resource; show whether this is provider-reported or confirmed against runtime identity. |
| Verified in running resource | Successful scan of the currently observed immutable image with sufficient relevant package coverage and evidence that the affected occurrence is no longer vulnerable. |
| Verification unavailable | Bundled/minified output, missing dependency metadata, ambiguous image linkage, unsupported input, or failed scan prevents verification. |
| Reopened | Rollback, reintroduction, or updated vulnerability intelligence makes the resource affected again. |

Package disappearance alone is “no longer detected,” not proof of a patched package. Uninstallation/removal can be a valid remediation, but requires a distinct reason. Source manifests do not prove runtime reachability. Development dependencies remain visible because they may affect builds, without automatically being called production exposure.

Commit author, committer, PR/MR author, reviewer, merger, deployment initiator, and bot are distinct roles. Git author text is not authenticated identity. Do not infer a fixer from the last commit, assign a person solely by email, or manufacture historical resolution dates. If scans bracket a change, report the observation interval unless the exact fixing commit is established.

## 5. Phased delivery

### Phase 0 — Validate contracts and settle technical design

Deliver a short architecture decision record, migration design, provider permission matrix, fixture set, and screen sketches. This is the first implementation-stage milestone, before production feature work.

- Validate dependency graphs against the bundled Trivy 0.76.1, not only latest documentation. Test npm package-lock v2/v3, pnpm lockfile v9, and representative workspaces first.
- Evaluate Yarn Classic/Berry fixtures and specify exact supported formats; Bun and legacy lockfile formats remain explicitly deferred unless added to the validated matrix.
- Verify preserving graph detail through direct filesystem JSON output versus SBOM export/re-import. Prefer Trivy inventory/matching and a normalized graph adapter; avoid writing a second vulnerability engine.
- Inspect representative, sanitized Coolify application/deployment responses for the supported deployed version: source URL, branch, base directory, commit, deployment status, and links to runtime image identity.
- Test a normal deployment, failed build, rebuild of the same SHA, and rollback. Decide which evidence can support each status.
- Validate GitHub/GitLab endpoint permissions for repository reads, commit history, PR/MR metadata, and event delivery. Define supported self-hosted GitLab versions and private-network connectivity.
- Produce sketches for project organization, adding source, dependency detail, source/runtime comparison, and remediation history. Connection setup uses our own design; copying Coolify's source-management UX is not a requirement.

Exit gate: a documented coverage/provenance matrix with honest fallbacks, agreed entity boundaries, and no unresolved assumption that could falsely mark a deployed resource fixed. Actual account-based validation will need administrator-provided test access if unavailable.

### Phase 1 — Stable projects, resources, and access

- Add stable project/resource IDs and environment metadata; preserve discovered identifiers as aliases.
- Provide create/rename/archive project, assign/move resource, and suggested groups. A rename never changes identity.
- Preserve existing groups as legacy/unassigned discovery views until an administrator adopts them. Show a migration preview when adoption changes settings inheritance.
- Migrate existing settings, display names, and historical references transactionally. Preserve effective resource settings when moving resources unless explicitly reset to inheritance.
- Define administrators as connection/project managers; project members can view assigned project data and request scans. Add later roles only if needed.
- Keep existing members' current inventory access during migration, but require explicit grants for new private source data. Do not let those inventory permissions reveal repository details indirectly.
- Apply authorization to every read/write/export/search/feed endpoint. Filter before aggregation, including shared image/repository results and global counts.

Exit gate: renaming and recreating containers preserves mappings/history; duplicate names remain distinct; access cannot leak between projects; legacy scanning continues unchanged. An ambiguous discovery match asks for assignment rather than silently joining resources.

### Phase 2 — Read-only provider connections and source bindings

- GitHub: prefer a repository-selected GitHub App, separate from sign-in OAuth, with minimum read permissions for contents, metadata, and PR history.
- GitLab.com/self-hosted: start with a suitable read-only access token and project selection. Validate available token types/scopes per supported instance; do not assume a repository-read token can also read all MR metadata.
- Add test connection, repository selection, branch/folder selection, health/expiry state, credential rotation, disconnect, and audit events.
- Encrypt stored credentials; never return them to browsers or expose them in clone URLs, process arguments, logs, or saved API payloads.
- Fetch dependency inputs at immutable commits using provider APIs where practical. Include root/workspace manifests and lockfiles needed to interpret a selected subfolder.
- Separate project-visible bindings from shared internal snapshots. Sharing a scan cache grants no additional access. Credentials from one binding must not silently authorize another project.
- Allow source-only projects, and resource bindings to repositories already connected to that project.
- Set up push hooks when supported, without requiring write/admin permissions just to start reading. Provide documented manual webhook registration and polling fallback.

Exit gate: all three providers work with private repositories; revoked/expired access produces a useful stale/error state while retaining historical results; rename/transfer and branch deletion are handled without linking to the wrong repository.

### Phase 3 — JavaScript dependency analysis

- First vertical slice: npm package-lock v2/v3 and pnpm v9, including workspaces. Add validated Yarn formats before declaring full npm/pnpm/Yarn support; publish the exact matrix.
- Scan runtime, development, optional, and peer contexts when determinable. Keep unknown scope explicit.
- Record graph paths from workspace direct dependencies to vulnerable package instances, including multiple introduction paths and versions.
- Detect missing/out-of-date lockfiles, unsupported formats, local/Git dependencies, aliases, workspace references, overrides, and incomplete graph data. Never infer installed versions from unresolved manifest ranges.
- Perform static parsing only: no dependency installation, lifecycle scripts, builds, repository hooks, or execution of repository-controlled package managers.
- Reuse immutable inventories for daily vulnerability rematching, while retaining new scan timestamps and database versions. Newly disclosed vulnerabilities must appear even without a Git change.
- Implement persistent jobs with deduplication, time/size limits, retries/backoff, cancellation, restart recovery, and fair scheduling with host/image scans. Start with one expensive analysis job at a time.
- Default triggers: initial connection, relevant tracked-branch changes, daily rematching, and manual scan. Poll tracked branches every 15 minutes when hooks are unavailable, with rate-limit backoff. Shared lockfile/workspace changes invalidate affected bindings.
- Track both selected development/deployment branches and exact deployed SHAs once known. Historical deployed commits remain assessable even after the branch moves.

Exit gate: known vulnerable fixtures show the correct direct dependency paths; duplicate paths are bounded but not silently dropped; partial/failed analysis never becomes a clean result; a source scan cannot starve runtime scans.

### Phase 4 — Findings and actionable remediation

- Extend project/resource screens with source health and clear “Source” and “Running resource” views.
- Show advisory, exact resolved package version, dependency scope, repository/commit, workspace, manifest/lockfile path, and expandable introduction paths.
- Explain whether to update a direct dependency, update the parent introducing a transitive dependency, remove a package, or wait for upstream support.
- Distinguish a patched transitive version from a verified parent upgrade. Do not invent a compatible parent release when dependency constraints have not been checked.
- Provide package-manager-specific inspection/update guidance and a checklist to regenerate the lockfile, test, commit, and deploy. Commands are reviewable instructions, not executed by Kopes.
- Support “no fixed version” and uncertain graph cases with appropriate guidance. Do not make blanket override/force-update recommendations.
- Correlate source/runtime findings using package identity/version, advisory aliases, binding, and deployment evidence. A common advisory ID alone is insufficient.
- Separate unique advisory counts from affected occurrences/resources; a shared repository must not inflate project totals.

Exit gate: a user can identify the editable direct dependency and affected resource, or see a precise reason why that relationship is unknown. OS/base-image findings remain distinguishable from application dependencies.

### Phase 5 — Coolify provenance and remediation history

- Extend the existing Coolify adapter with allowlisted metadata and paginated application deployment history. Preserve manual source binding; automatic source discovery is optional future convenience.
- Match resources by stable Coolify identifiers and service/environment, not display names. Poll relevant deployment history and reconcile when runtime inventory changes.
- Link source SHA → build/deployment → immutable image → running instances wherever evidence supports it. Keep local Docker image IDs and registry manifest digests as different identifier types.
- Show mismatches, missing provenance, mixed old/new replicas, and provider outages explicitly. Do not use current branch HEAD or an image tag as proof of the deployed SHA.
- Read PR/MR and commit metadata to attribute confirmed dependency changes. Bound history queries; if several commits separate scans, label candidate changes rather than selecting a fixer without evidence.
- Add separate events for fix available, source remediation observed, merge/direct push, deployment observed, runtime verification, and reopening.
- Preserve original source and observation timestamps. Deduplicate repeated provider events and reconcile out-of-order delivery. A late scan of an old image cannot resolve the current deployment.

Exit gate: an end-to-end fixture starts vulnerable, receives a dependency update, merges, deploys, and verifies; staging can be fixed while production remains affected; rollback reopens production; missing image coverage never produces false verification. Bot and human actions are attributed separately.

### Phase 6 — Pilot, migration rehearsal, and release

- Pilot one npm application, one pnpm workspace, and a multi-repository project. Exercise GitHub, GitLab.com, and a supported self-hosted GitLab instance.
- Rehearse upgrade on a copied existing database. Check reports, settings, display names, bookmarks, and timeline preservation.
- Validate connection revocation, network loss, webhook duplication, force-pushes, repository transfer, partial scans, restart recovery, disk limits, and project access changes.
- Validate browser flows on desktop/mobile, empty/error states, evidence labels, and notification wording. “Fix available” and “Verified in running resource” must be unmistakably different.
- Document permissions, supported lockfiles/versions, local processing, retention, provider setup, recovery, and provenance limitations.
- Release behind independent flags for source connections/scanning and provenance display. Start with administrator-enabled pilot projects, then enable generally once release gates pass.

Exit gate: all release scenarios pass, bounded resource usage is demonstrated on the existing deployment footprint, and documented restore procedures work. No claim of production readiness based solely on mocked providers.

### Phase 7 — Optional PR/MR creation, separately scoped

After the read-only release is stable, add explicit per-repository opt-in and separately requested write permissions.

- Preview intended manifest/lockfile changes before creating a branch and PR/MR.
- Generate updates in an isolated worker without host mounts or Docker socket access. No production secrets; narrowly scoped, short-lived credentials; controlled network access and disabled lifecycle scripts.
- Regenerate lockfiles with validated tooling, scan the candidate, and report both removed and introduced findings. Rely on normal CI for application validation.
- Deduplicate existing remediation requests and recheck the base SHA before writing.
- Record Kopes/bot authorship and human review/merge separately. Do not auto-merge, deploy, or bypass branch protection.

Exit gate: one explicit user action creates one reviewable request with reproducible changes and evidence; disabling write access leaves read-only analysis working.

## 6. Operational and security requirements

These requirements follow directly from processing private, potentially hostile repository content.

- Self-hosted GitLab must support administrator-approved private endpoints and custom CA bundles. Restrict outbound requests to configured origins/ports, revalidate resolved addresses, reject credential-bearing redirects, and block metadata/link-local destinations. Never disable TLS verification globally.
- Fetch only needed files where practical. Enforce file/count/total-size/depth limits; reject traversal and symlink escapes. Do not fetch submodules or LFS objects by default. Unsupported input is a visible coverage limitation.
- Workers processing source inputs must not gain host filesystem or Docker proxy access. Keep source fetching credentials separate from parser processes; use a restricted source worker/service within the same single-host installation if needed.
- Verify provider-specific webhook authentication, apply payload limits and replay/delivery deduplication, acknowledge quickly, and enqueue work. Webhook routes use their own authentication; they do not rely on browser sessions.
- Source/provider failures do not interrupt runtime inventory or erase the last successful report. Show stale timestamps and connection health.
- Proposed retention defaults: discard fetched raw source inputs after processing; retain normalized inventories/graphs for tracked heads, currently deployed SHAs, and unresolved findings; retain other scan details for 90 days and compact remediation evidence for one year. Make limits configurable and validate storage during pilot. Historical replay becomes limited after pruning and must be labelled accordingly.
- Disconnect removes credentials, cancels pending work, and retains authorized historical evidence. Purging repository data is a separate explicit action; shared snapshots can only be removed when no authorized binding still needs them.
- Collect local operational metrics for job duration, queue age, scan failures, provider throttling, coverage, cache size, and provenance gaps. Do not add outbound telemetry.

## 7. Validation and rollout sequence

Recommended order is Phase 0 → 1 → 2 → 3 → 4 → 5 → 6. Provider adapters can be delivered incrementally behind the same interface, but Release 1 includes all three agreed provider environments. Phase 7 is a separate release.

Each implementation slice includes focused tests and the repository's applicable typecheck, test, build, and production smoke checks. Meaningful coverage includes:

| Area | Required scenarios |
| --- | --- |
| Migration/identity | Legacy data, rename, recreation, move, duplicate names, settings inheritance, backup restore |
| Authorization | Guessed IDs, search/count leakage, exports, shared repos/images, revoked memberships |
| Provider access | Expiry, revocation, pagination, rate limits, branch deletion, renamed repositories, private GitLab |
| Dependency graph | Multiple versions/paths, monorepos, dev/prod overlap, aliases/peers/optional dependencies, missing/stale lockfiles |
| Evidence | Squash/rebase/direct push, bot updates, observation gaps, failed deployments, rollback, same-SHA rebuild, missing metadata |
| Worker safety | Malicious paths, oversized inputs, repository scripts never run, timeouts, interrupted scans, queue fairness |
| Lifecycle | New advisory without code changes, stale report, partial coverage, late events, advisory withdrawal, package removal |

Before a schema upgrade, take a consistent backup and preserve the authentication encryption secret. Feature flags disable new work but do not downgrade the database. Older binaries must reject newer schemas; rollback requires restoring the pre-upgrade backup and matching application version.

Release acceptance scenario: an administrator creates a project, assigns a Coolify resource, connects its private repository, and sees a vulnerable transitive dependency traced to a direct dependency. A developer follows guidance and merges a fix. Kopes records evidence and actors, observes deployment, verifies the running image when coverage permits, and reopens the finding after rollback. Another project member cannot see any of this without access.

No calendar estimate is committed yet. Phase 0 should produce estimates per remaining phase using measured provider/provenance and parser complexity. The highest risks are stable-identity migration, graph fidelity across lockfiles, and proving the deployed commit; provider CRUD screens are not the critical path.

## 8. Documentation checked and remaining uncertainties

The following documentation was checked on 2026-11-09. These are capability references, not substitutes for testing the bundled tools and the user's deployed versions.

- [Trivy Node.js coverage](https://trivy.dev/docs/latest/coverage/language/nodejs/): documents npm/pnpm/Yarn dependency graphs and package-manager-specific differences. Development dependencies require explicit inclusion; pnpm position information is limited. Validate these behaviors against bundled 0.76.1 and preserve missing information honestly.
- [GitHub App permissions](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app): supports selecting permissions for API/webhook capabilities. Final endpoint-by-endpoint scope mapping remains a Phase 0 deliverable.
- [GitLab repository files API](https://docs.gitlab.com/api/repository_files/): supports commit-addressed file reads and documents read scopes. This does not establish permission coverage for every required history/MR endpoint.
- [Coolify application deployment history](https://coolify.io/docs/api/endpoints/deployments/list-deployments-by-app-uuid) and [running deployments](https://coolify.io/docs/api/endpoints/deployments/list-deployments): history and active deployment listing are distinct. Actual completeness and correspondence with the running image must be tested.

Remaining technical decisions are assigned to Phase 0, rather than additional product questions: exact supported lockfile/GitLab versions, GitLab token type and permission matrix, source-worker isolation mechanism, and the strength of Coolify-to-image evidence available on the installed version.
