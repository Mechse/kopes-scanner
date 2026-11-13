# Phase 0 design decisions for implementation planning

Status: design only. See the validation report for measured behavior and open gates.

## Entity contracts

| Entity | Identity / uniqueness | Important relationships |
| --- | --- | --- |
| Project | Generated stable ID | Name mutable; memberships explicit; legacy groups not identities |
| Resource | Generated stable ID | One owning project initially, nullable while unassigned; environment attribute |
| Discovery alias | Scanner host + manager + stable external resource/service key | Maps observations to resource; ambiguous collisions require assignment |
| Runtime instance | Host + container ID + observation interval | Resource and immutable image reference; replacement closes interval |
| Image observation | Host + Docker image ID; registry digest stored separately | Retained independently of current `targets` |
| Connection | Provider instance + generated connection ID | Encrypted credential version; administrator managed |
| Repository | Provider instance + provider numeric/stable ID | Name/URL mutable; connections grant access, not identity |
| Source binding | Generated ID; project + repository + ref + folder selection | Project authorization boundary; resource links many-to-many within owning project |
| Snapshot | Repository + full commit SHA + input-bundle hash + analyzer configuration | Immutable input provenance; binding-specific scope is separate |
| Package node/edge | Snapshot + analyzer target + package instance/context | Workspace roots and edge scope recorded separately; not name-only identity |
| Scan | Snapshot/image + analyzer/version + DB identity + attempt ID | Immutable results and coverage; independent attempt/completion timestamps |
| Finding observation | Scan + normalized advisory + package occurrence | Retains aliases, state and resolution reason; projects aggregate authorized observations |
| Deployment | Provider instance + deployment ID | Resource/env, source SHA(s), image links, status/evidence strength |
| Event | Provider + delivery/event ID, or deterministic local observation key | Append-only fact, actor role, source time, observed time, evidence refs |
| Membership | Project + user ID | Explicit source access; legacy inventory access remains a separate policy |

For Coolify aliases use instance + resource kind + UUID + service identity. Compose-only aliases need host + compose project + service; a renamed compose project without a stable manager ID is ambiguous. A container name alone is insufficient to silently merge resources. Archive old aliases instead of reusing their history.

Persist occurrence lineage across scans separately from package-version identity, so an upgrade can resolve an occurrence without losing the original vulnerable version. Affected paths in different workspaces/resources remain separate even when they share an advisory. Shared caches are internal; every result path is authorized through a binding/resource.

## Migration design

1. Back up the stopped scanner database/data and encryption secret. Record schema version; current store expects up to version 5.
2. Introduce a transactional, versioned additive migration. Do not migrate directly on the live database during development. Keep old fields until all reads are adapted.
3. Create stable resources and discovery aliases for current inventory. Preserve discovered groups as legacy organizational records/suggestions, without guessing their application ownership.
4. Add explicit legacy-key mappings for `(project string, container name)`. Copy display names/settings; retain unresolved historical keys in a legacy history view instead of attaching them by similar names.
5. Materialize effective settings when a user moves/adopts a resource, while retaining which values were inherited. Offer an explicit reset to the new project's inheritance.
6. Backfill available current scan results into durable observations, labelling them as imported. Do not backfill nonexistent deployment SHAs, fixing actors, or historical scans already deleted by inventory cleanup.
7. Keep existing instance-wide inventory access for current users. New private source bindings require explicit project grants. Do not expose source-derived totals, repo URLs, actors, or enriched text through legacy inventory access.
8. Switch inventory ingestion to stable resource observations and durable image references; retain transient targets as worker scheduling state if useful. Remove destructive history coupling before enabling source/deployment events.
9. Verify row counts, settings equivalence, current findings, bookmark identifiers, and history before switching reads. Old advisory bookmarks may remain advisory-scoped; do not reinterpret them as package-occurrence IDs.
10. Bump schema version only within the successful transaction. A feature flag can stop new work; binary downgrade requires restoring the pre-upgrade backup, not simply turning off the flag.

Use foreign keys for ownership and immutable references; no cascade from ephemeral containers/targets to scans/events. Index binding/project authorization joins, repository/SHA lookups, event deduplication, job state/time, and resource/current-image lookups. Retention deletes must exclude active/deployed/unresolved evidence and shared snapshots still referenced elsewhere.

## Screen sketches

These are information-layout sketches, not approved visual design or working UI.

### Project organization

```text
Projects                                    [Create project]
Customer Portal                 Members: 3   [Manage access]
  Production · API              Source linked · Scan current
  Staging · API                 Source linked · Scan current
  Database                      No source required

Unassigned resources                        [Review suggestions]
  Discovered group: portal-production       [Assign to project]
```

Assignment preview shows current → proposed project, effective scan settings, access implications, and conflicting identities. Discovery does not automatically grant repository access.

### Add source to a project

```text
Project → Sources → Add source
Provider connection     [GitHub / GitLab / self-hosted GitLab]
Repository              [Select an accessible repository]
Tracked branch          [main]
Workspace               [Detected folders / whole repository]
Resources               [API production] [API staging]

Access                  Project members only
Checks                  Read access · Inputs recognized · Coverage
                                            [Connect and scan]
```

An administrator creates/chooses the connection; ordinary project members do not see stored credentials or unrelated accessible repository names. Show unsupported/missing inputs before presenting an empty findings state. Polling works before a webhook is configured.

### Finding detail

```text
Vulnerable package · advisory               [Source] [Running]
Repository / commit / workspace / file
Introduced through
  Direct dependency A → vulnerable package
  Direct dependency B → vulnerable package

What to change
  Update the introducing dependency; regenerate lockfile; test.
  Patched package version: known
  Compatible parent release: unverified

Source: no longer vulnerable at commit …
Production: affected at image …
Coverage: complete input · partial runtime package visibility
```

Do not show a source finding as “affects production” merely because a resource is bound to the repository. Use confirmed matching runtime finding, deployed-source inference, or unknown relationship as distinct labels.

### Remediation history

```text
Fix available             Advisory update            time
Dependency change         Commit author / bot         time
Merged                    Merger + PR/MR              time
Deployment reported       Coolify deployment          time
Running image observed    Immutable image             time
Verified                  Scan + relevant coverage    time
```

Missing steps show “Not observed” or “Unknown”; reviewers are shown only with review evidence. Direct pushes do not fabricate a PR/MR. Source timestamps and observation timestamps are available in evidence detail. A rollback adds a reopening event and changes current runtime status without erasing the earlier successful fix.

## Implementation sizing after local validation

These are provisional engineering effort ranges for one developer familiar with the app, including tests/review, not calendar commitments. External access delays and unvalidated provider behaviors are excluded; revise after live gates close.

| Phase | Effort | Main uncertainty |
| --- | --- | --- |
| 1: identity/access/migration | 5–8 working days | Legacy history ambiguity and authorization across shared images |
| 2: three provider environments | 6–10 days | GitLab permission/version differences and installation setup |
| 3: npm/pnpm analysis and worker | 7–12 days | Workspace adapter, isolation, graph edge cases; Yarn adds 2–4 days |
| 4: guidance and comparisons | 4–7 days | Honest parent-upgrade guidance and source/runtime correlation |
| 5: evidence/history | 6–10 days | Coolify image linkage and attribution gaps |
| 6: pilot/hardening | 4–7 days | Live fixtures, upgrade rehearsal and operational limits |

Indicative total for Phases 1–6: 32–54 working days, plus 2–4 if validated Yarn support joins the first release. Phase 7 is intentionally not estimated before the read-only workflow is piloted. The current evidence does not justify shortening the plan to a simple repository settings form.

## Open decisions with owners

- Engineering, after live access: certify GitLab version and endpoint/token matrix.
- Engineering, with deployment owner: establish the strongest Coolify/image evidence available; keep the conservative fallback if no exact link exists.
- Engineering, Phase 3: select maintained parsers for supported input formats and validate aliases, peers, overrides, shared production/dev paths, and stale lockfiles without installing packages.
- Product review before implementation: accept the proposed entity/access/migration behavior and provisional scope boundary. No further product answer is required to continue the pending Phase 0 read-only checks.
