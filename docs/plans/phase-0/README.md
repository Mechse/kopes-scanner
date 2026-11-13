# Phase 0 — technical validation

Date: 2026-11-09. Scope: experiments and design only; application code, production database, deployments, and provider settings have not been changed.

**Decision: the source-analysis approach is viable, with changes below. Phase 0 is not fully closed: live least-privilege GitHub App testing, GitLab testing, and Coolify deployment-to-image validation remain outstanding. Do not treat this report as permission to begin Phase 1.**

## Evidence and results

The actual local scanner image reports Trivy **0.76.1**, matching the Dockerfile. Experiments ran in disposable containers with no network, read-only fixture/database mounts, dropped capabilities, and no Docker socket/host mounts. The public vulnerability database was copied from the existing scanner; its update time is recorded in `evidence.json`. No packages were installed and no repository scripts were invoked.

The final matrix contains **44 invocations across 11 fixtures**, with **43 assertions** over the results. Four additional in-memory assertions characterize current application behavior. These counts describe focused contract checks, not exhaustive compatibility certification.

| Experiment | Observed result | Design consequence |
| --- | --- | --- |
| npm lock v2/v3 | Both synthetic direct parents point to vulnerable lodash; dev package appears only when requested | Suitable for the first supported formats |
| npm workspace lock v3 | Workspace nodes and two lodash versions are retained | Keep workspace and package-instance identities |
| pnpm lock v9 | Transitive edges and explicit dev package survive direct JSON analysis | Suitable for the first supported format |
| pnpm workspace with two importers | Both lodash versions retained, but no workspace-root nodes in the analyzer graph | Reconstruct importer-to-direct-package edges from lockfile/manifests |
| Yarn Classic and Berry metadata v8 | Correctly formatted synthetic files yield both introduction paths and dev scope | Candidate support; needs generated real-world workspace/peer fixtures before release |
| Real Kopes pnpm lockfile | 263 packages by default; 292 including dev; 976 dependency edges with dev | Real-size smoke check supports the chosen approach; not a performance benchmark |
| SBOM export/re-import | Package edges retained in the representative fixtures, but `Dev` labels lost; real Kopes 29 dev flags become zero | Keep normalized source graph/scope as authoritative metadata alongside SBOM |
| Missing or malformed lockfile | Trivy exits 0 with no result inventory | Exit success and zero findings must not mean clean coverage |
| Manifest changed, lockfile stale | Old lockfile package version still reported without invalidating scan | Validate manifest/lock consistency before presenting an authoritative source result |
| Current Kopes report parser | Drops graph, scope, and relationships; accepts `Results: []` | Source pipeline requires a distinct richer parser and coverage contract |
| Current inventory refresh | Deletes an old image target after it disappears | Deployment evidence must not depend on ephemeral target rows |
| Current project rename | Example inherited interval resets from 24h to 168h | Stable identity and settings migration are required first |

The synthetic vulnerable version is a matching/graph fixture, not an instruction to install it. Vulnerability counts can change with the database; assertions use a known advisory and graph relationships rather than an exact total.

The first Yarn drafts were incorrectly formatted and produced incomplete/empty inventories. Correcting record spacing and the Berry generated header fixed them. Final evidence reflects the corrected fixtures. This reinforces the need for input/coverage checks; it does not establish how every malformed lockfile is handled.

## Architecture decisions

### ADR-01: Keep direct source inventory and SBOM as complementary records

Use static filesystem analysis of a commit-addressed dependency-input bundle. Persist package IDs, purls, dependency edges, dev/production context, workspace roots, file locations when available, and analyzer/version provenance from direct JSON. An SBOM remains useful for exports and daily vulnerability matching, but its re-import must not replace the authoritative source graph or scope annotations.

Join rematched vulnerabilities back to the saved inventory using tested package identity mappings. Never join solely by package name; multiple versions/contexts must remain distinct. If the mapping is ambiguous, show partial attribution. Keep raw analyzer IDs scoped to a snapshot/target rather than assuming they are globally stable.

Disable implicit repository-supplied Trivy config and ignore files (`--config=`, `--ignorefile=`), enable only the intended scanners, explicitly include dev dependencies, and disable outbound telemetry/version checking. Enforce the input bundle allowlist rather than scanning an arbitrary checkout. The experiment runner demonstrates those settings; it is not a production worker.

### ADR-02: Add a small workspace/coverage adapter, not a vulnerability engine

Read supported manifest/lockfile structures to attach workspace importers and declared direct dependencies to analyzer package nodes. Validate version constraints, aliases, local/workspace references and lockfile specifiers. Report unsupported/ambiguous inputs rather than guessing. Initial confirmed parser targets are npm lock v2/v3 and pnpm v9; Yarn is provisional until real generated fixtures pass. No Bun or legacy-lock support claim is made.

Coverage needs separate dimensions: input completeness, inventory extraction, graph completeness, scope classification, and runtime comparability. An empty legitimate dependency set must be distinguished from failed recognition. Partial results may be displayed but cannot automatically resolve old findings. Stale inputs get a clear warning and do not prove the deployed dependency state.

### ADR-03: Durable observations independent of current inventory

Retain immutable scan/deployment observations after container or image removal. Current inventory is a projection of active resources, not the historical source of truth. New observation tables must not cascade from `targets`. Keep historical event actor names and evidence snapshots with their original IDs, while rendering current display names separately.

Use distinct source-remediated, merged, provider-deployed, runtime-linked, runtime-verified, and reopened facts. Verification needs relevant package coverage and a current image match. A provider's successful deployment record alone is insufficient.

### ADR-04: Separate credentialed fetching from source parsing

Use a predefined source-analysis worker service on the same host, without host mounts, Docker proxy, application secrets, provider credentials, or database access. The application fetches allowlisted dependency files at a pinned SHA and places a bounded job bundle in a spool; the worker reads it and writes a bounded result. No dynamic Docker provisioning by the application is required.

Use a private, bounded work volume, separate input/output directories, atomic handoff, per-job ownership/IDs, and strict result validation. Supply a read-only public vulnerability DB snapshot; update it outside active analysis. Do not share the application's full data directory. The experiment proved Trivy can analyze offline; production spool permissions, cancellation, and resource limits still need implementation tests.

This preserves the single-host deployment model while preventing source parsers from inheriting the runtime scanner's host access. Phase 0 does not claim the production isolation mechanism has been implemented or penetration-tested.

### ADR-05: Read-only credentials, polling as reconciliation

GitHub uses a dedicated App with selected repositories, not sign-in OAuth. GitLab uses a project-scoped read token where available and a dedicated restricted user's read token as fallback. Store provider host and immutable repository ID together. Repository/project selection in Kopes is not a reduction in the upstream token's privileges.

Use hooks for prompt delivery and periodic branch reconciliation even when hooks are enabled. Events may be dropped, duplicated or out of order. Fetch authoritative API state by immutable identifiers before changing lifecycle facts. Manual GitLab hook setup avoids requiring write/admin API access for basic scanning.

## Provider permission and endpoint matrix

The following is documentation-validated; authenticated minimum-scope tests remain distinct from endpoint-shape probes.

| Capability | GitHub proposed endpoint/permission | GitLab proposed endpoint/scope |
| --- | --- | --- |
| Repository identity | `GET /repos/{owner}/{repo}`; metadata read | `GET /projects/{id}`; `read_api` |
| Branch to SHA | `GET /repos/{owner}/{repo}/branches/{branch}`; contents read | `GET /projects/{id}/repository/branches/{branch}`; `read_api` |
| Tree/files at SHA | Git trees and contents/blob reads; contents read | Repository tree/files reads; `read_api` (repository-only reads can also use `read_repository`) |
| Commit/change metadata | Commit and comparison reads; contents read | Repository commit/diff reads; `read_api` |
| Commit → PR/MR | `GET /repos/{owner}/{repo}/commits/{sha}/pulls`; pull requests read | `GET /projects/{id}/repository/commits/{sha}/merge_requests`; `read_api` |
| Merge evidence | PR detail; pull requests read | MR detail; `read_api` |
| Review evidence | PR reviews; pull requests read | MR reviewers do not prove review; approvals/notes are capability-dependent and need separate validation |
| Hooks | App subscribes to push, pull_request, pull_request_review, installation changes | Project hook configured by maintainer/owner; read-only scan token does not create hooks |

GitHub contents/tree APIs support immutable addressing. Recursive trees can be truncated: detect this and fetch bounded subtrees or report incomplete input coverage. Source: [GitHub trees API](https://docs.github.com/en/rest/git/trees).

Commit metadata is distinct from provider actor identity; associated PRs are evidence of association, not automatic proof that a particular dependency change fixed a finding. Sources: [GitHub commits](https://docs.github.com/en/rest/commits/commits), [PR details](https://docs.github.com/en/rest/pulls/pulls), [reviews](https://docs.github.com/en/rest/pulls/reviews).

For GitLab API-based fetching, start with `read_api` and a Reporter-level test user/token, then verify every endpoint. Do not request `api` write access. GitLab.com project tokens require a paid tier, so they cannot be the only onboarding option. Self-managed project tokens are more broadly available. Sources: [GitLab token scopes](https://docs.gitlab.com/security/tokens/access_token_scopes/), [project tokens](https://docs.gitlab.com/user/project/settings/project_access_tokens/), [repository files](https://docs.gitlab.com/api/repository_files/), [commits](https://docs.gitlab.com/api/commits/), [merge requests](https://docs.gitlab.com/api/merge_requests/).

GitHub hook signatures use HMAC over the received body. GitLab webhook verification must follow the capabilities of the tested server version; do not assume GitHub's scheme applies. Both require delivery deduplication and bounded requests. GitLab documents cases where pushes do not generate hooks, supporting periodic reconciliation. Sources: [GitHub validation](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries), [GitLab webhooks](https://docs.gitlab.com/user/project/integrations/webhooks/).

No self-hosted GitLab version range is certified by this exercise. Set the initial supported baseline to the actual pilot version after endpoint/auth/hook validation; then add versioned fixtures. Do not invent a minimum version based on latest docs.

## Live integration status

**GitHub:** the user selected `ADT-App-Dev-Team/kopes.dev`, which the authenticated API confirms is private. The read-only probe uses the existing CLI login, checks branch/tree/file addressing and PR metadata, and saves only hashes/counts/field presence in `github-evidence.json`. No source contents are retained by the probe. This login has admin rights, so success cannot certify minimum App permissions or installation lifecycle behavior.

Measured: branch resolution returned a full SHA; the recursive tree was not truncated; `package.json` and `pnpm-lock.yaml` were read at that SHA and both blob IDs matched the tree. The commit-associated PR query and all-state PR list returned empty arrays. Consequently no review/detail/merger payload was exercised; review and merge attribution remain unvalidated, rather than being counted as a successful empty-history test.

**Coolify:** an existing saved connection was found. A read-only application request failed with `ERR_SSL_WRONG_VERSION_NUMBER`. No application/deployment body was received; no connection settings were changed, and TLS checks were not bypassed. The installed Coolify version and real deployment fields remain unvalidated.

The documented history endpoint is `GET /deployments/applications/{uuid}` with `skip`/`take`; `/deployments` lists currently running deployments and is not a substitute for history. Source: [Coolify deployment history](https://coolify.io/docs/api/endpoints/deployments/list-deployments-by-app-uuid), [active deployments](https://coolify.io/docs/api/endpoints/deployments/list-deployments).

**GitLab.com/self-hosted:** no test repositories/instance were supplied. Permission choices above are proposed contracts, not live pass results.

The currently allowed Docker endpoints already include running-container listing and immutable image inspection. The existing adapter discards most labels and image metadata. A future adapter can capture allowlisted revision/source labels without broadening Docker proxy permissions. A revision label is producer-reported provenance, not cryptographic proof; a label's absence or inconsistency must stay visible.

## Coolify live acceptance matrix — pending

| Scenario | Required observations | Expected result |
| --- | --- | --- |
| Normal deploy | Application identity, SHA, completed deployment, current image identity, revision link | Link only where identifiers agree |
| Failed build | Failure record and unchanged running image | No deployed/verified fix |
| Same-SHA rebuild | Same source SHA with new image ID | New runtime observation and rescan |
| Rollback | Previously vulnerable image becomes current | Reopen runtime occurrence; preserve source state |
| Mixed instances | Old and new image both active | Resource remains partly affected |
| Missing revision/digest evidence | Successful provider record only | Provider-reported deployment; runtime source link unknown |

These are acceptance scenarios, not fabricated test results. Run on a disposable application with explicit deployment authorization; current work only authorized read-only provider probes.

## Remaining gates and next step

1. GitHub App installed on a private test repository with metadata/contents/pull-request read only: repeat reads, verify hook signatures, denied writes, token expiry/revocation, and installation changes.
2. Working read-only Coolify connection and identified disposable app: collect sanitized application/deployment/image observations for the matrix above. Creating deployments remains a separate authorized test activity.
3. GitLab.com and self-hosted pilot access/version: validate token scope, endpoint shapes, pagination, custom CA/private-network behavior, hooks, and MR attribution.
4. Real generated Yarn/workspace/peer/alias fixtures: finish compatibility validation before declaring Yarn supported. npm/pnpm advanced contexts also need Phase 3 acceptance coverage.

Local feasibility and design artifacts are ready for review. The full cross-provider/provenance gate remains open. No production schema migration or feature implementation has begun.

## Reproduction and artifacts

- `make-fixtures.py`: generates synthetic inputs plus an ignored copy of this repository's manifest/lockfile for the larger smoke check.
- `run-scans.py`: runs isolated offline scans using the local `kopes-scanner` image; requires a copied Trivy database at `/tmp/kopes-phase0/db`. Outputs remain in `/tmp/kopes-phase0/results`.
- `check-results.py`: asserts contracts and writes compact, hashed evidence. Requires the complete matrix from `run-scans.py` without case filters.
- `probe-model.ts`: in-memory characterization; run `node --import tsx docs/plans/phase-0/probe-model.ts`.
- `probe-github.py OWNER/REPO`: read-only API probe using an existing `gh` login, writes sanitized evidence only.
- `evidence.json`, `model-evidence.json`, `coolify-evidence.json`, `github-evidence.json`: measured results. The database itself and raw reports are not checked in.
- `design.md`: proposed entities, migration sequence, UX sketches, and estimates.

The initial runner attempt failed because the image's inherited TMPDIR pointed to `/data/tmp`; the corrected runner explicitly uses its isolated `/tmp`. Final evidence is from the corrected run. This was an experiment setup issue, not a source-scanner limitation.

## Implementation follow-up (2026-11-09)

The user subsequently authorized Phase 1 implementation and independent local work while external gates remain open; this supersedes the original instruction above to await authorization. It does not mark those gates passed. See [Phase 1 increment](../phase-1/README.md).

At the user's suggestion, `probe-public.py` performed unauthenticated read-only API checks against public `npm/cli` on GitHub and `gitlab-org/gitlab` on GitLab.com. Both returned stable repository IDs, branch commit IDs, a package manifest addressed at that commit, and one PR/MR list entry. Results and observation time are in `public-evidence.json`; no manifest content or credentials are retained. These measured endpoint reads expand public-contract coverage only. They do not validate minimum permissions, private repositories, expiry/revocation, review attribution, hooks, self-hosted GitLab versions, or Coolify provenance. The original evidence files remain unchanged.
