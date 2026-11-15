# Private GitHub repositories: installation-owned Apps and token fallback

Status: all six implementation stages have code and documentation; automated checks run. Live GitHub and host-dependent acceptance remain pending (see section 14).
Date: 2026-11-15.

## 1. Product decisions

Each self-hosted Kopes deployment manages its own GitHub credentials. GitHub App registration through a manifest is the recommended connection; a fine-grained personal access token (PAT) is the fallback. No central Kopes authentication service is required.

Default to a private GitHub App registered under the account that owns the repositories. A private app can only be installed on its owning account; supporting both a personal account and an organization therefore means creating separate app connections. Support multiple connections in the initial data model and UI. Public app registrations, cross-owner sharing, GitHub Enterprise Server, and a central Kopes broker are outside this release. [GitHub app visibility](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/making-a-github-app-public-or-private)

Connections are administered by Kopes administrators. Repository results retain existing project membership rules; standalone repositories remain administrator-only. Connecting GitHub does not grant anyone access to Kopes. Existing GitHub, Google, and Microsoft sign-in methods remain independent.

Initial permissions: Metadata read (implicit), Contents read. Offer an explicit optional “Include pull request and review history” choice at registration that adds Pull requests read. No write, organization-member, administration, or workflow permissions. Do not advertise file-scoped GitHub access: Contents read permits repository contents even though Kopes only fetches supported dependency inputs. [GitHub permission guidance](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app)

Keep the existing default-branch scanning behavior and dependency-input collection. This feature does not introduce cloning, source execution, dependency installation, PR creation, or image access.

## 2. Existing implementation and changes required

| Area | Current behavior | Planned change |
| --- | --- | --- |
| `src/server/source/provider.ts` | GitHub API reads with an optional bearer token; safe DNS resolution and address pinning; immutable commit collection | Reuse collection; add a bounded GitHub transport and credential-aware reader |
| `src/server/source/service.ts` | Static encrypted tokens; synchronous `connectionFor`; gated pilot management | Introduce typed connections and asynchronous credential resolution; preserve legacy routes |
| `src/server/source/repositories.ts` | Normal add flow always creates anonymous public access | Add explicit connection selection and authenticated repository binding |
| `src/server/source/jobs.ts` | Polls about every 15 minutes; checks credential version before committing results | Resolve app tokens during reads; account for app/installation/repository access revisions |
| `src/server/source/webhook.ts` | Per-connection push hooks with a derived secret | Keep legacy hooks; add an app-level handler using GitHub's generated webhook secret |
| `src/server/source/schema.ts`, `store.ts` | SQLite migrations; current working tree reaches schema version 14 | Add a new migration using the next available version at implementation time |
| `src/routes/api.data.$.ts` | Authenticated API dispatcher | Add GitHub settings and repository discovery endpoints |
| `src/routes/settings.tsx` | Coolify connection and sign-in settings | Add GitHub connections panel |
| `src/components/repositories.tsx`, `project-sources.tsx` | Public repository UI and older source management | Share the new connection contract; remove conflicting public-only guidance |

There are unrelated working-tree edits, including `store.ts`. Implementation must integrate with the then-current migration chain and preserve those edits. Existing encrypted credentials must remain decryptable; changing associated-data identifiers during migration without resealing would break them.

## 3. Settings and repository experience

Settings → GitHub connections offers:

- **Connect with GitHub App**: select personal account or organization; organization login; optional PR history; webhook delivery enabled or polling-only.
- **Use personal access token**: connection name, resource owner, token, and a private repository URL for validation.
- **Reconnect an existing App**: advanced recovery using app ID, client ID, client secret, private key, and webhook secret; verify before enabling.

Each connection shows its label, owner, method, access status, last successful check, linked repository count, and capabilities. Show “App created — installation required” separately from “Connected.” For PATs, show a known expiry or “Expiry unknown”; never imply an unknown token has no expiry.

Actions: choose repositories, refresh access, test connection, manage access on GitHub, replace credentials, and disconnect. Disconnect explains that future scans stop and historical reports remain. It does not silently uninstall or delete an app on GitHub; provide the relevant GitHub management link for that separate action.

Add repository offers “Public repository” and a selected GitHub connection. App connections provide a paginated repository picker. PAT connections initially accept an explicit repository URL, avoiding the implication that a list of public repositories proves private access. Resolve repository IDs on the server and validate access again when saving.

Repository details show the connection, owner, latest successful scan, and connection errors separately from scan findings. Switching an existing binding to another connection requires an administrator and a successful read of the same immutable repository ID; preserve its history and project assignment.

## 4. Manifest registration flow

Use three distinct callbacks: manifest conversion, installation setup, and GitHub user authorization. None reuse Better Auth's sign-in callback.

Proposed manifest, with all URLs generated from the configured canonical Kopes origin and a server-generated local app UUID:

```json
{
  "name": "Kopes Scanner <short-instance-id>",
  "url": "https://scanner.example.com",
  "description": "Read repository dependency inputs for this Kopes installation.",
  "public": false,
  "redirect_url": "https://scanner.example.com/api/github/manifest/callback",
  "setup_url": "https://scanner.example.com/api/github/install/callback",
  "callback_urls": ["https://scanner.example.com/api/github/authorize/callback"],
  "setup_on_update": true,
  "request_oauth_on_install": false,
  "hook_attributes": {
    "url": "https://scanner.example.com/api/github/webhooks/<local-app-id>",
    "active": true
  },
  "default_permissions": { "contents": "read" },
  "default_events": ["push"]
}
```

Add `pull_requests: read` only when the history option is chosen. Polling-only mode sets webhook delivery inactive and omits push subscription. Installation lifecycle events are handled separately from explicitly subscribed push events; confirm delivery semantics during live acceptance.

Implementation sequence:

1. An authenticated administrator submits a same-origin setup request. Validate the chosen owner and canonical URL; never derive callback origins from arbitrary request headers. Allocate a pending app record and a random, single-use setup state.
2. Bind state to the initiating Kopes user, session, app record, intended owner, and step. Store a state hash with a 30-minute expiry; state values contain no secrets. Allow one active attempt per pending app.
3. Return an escaped form that POSTs JSON in `manifest` to GitHub's personal or organization registration endpoint, with state. The browser submits only public configuration.
4. On the manifest callback, require the matching active administrator/session and valid state. Atomically claim the attempt before exchanging the code server-side at `POST /app-manifests/{code}/conversions`.
5. Validate the response schema; encrypt and save the private key, webhook secret, and client secret immediately. Store app ID, client ID, slug, and registration metadata. Verify the app through `GET /app` with its private key and compare owner and permissions to the intended configuration.
6. Mark it “installation required”; send the administrator through the app's GitHub installation flow using a fresh state. Offer resume after interruption without creating another app.

GitHub's manifest handshake supplies generated app credentials and must complete within one hour. Kopes uses a shorter local state window. Registration is distinct from installation. [Manifest specification](https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest)

Do not blindly retry a manifest conversion after an ambiguous network failure: GitHub may already have consumed the code. Show a recovery path to import the created app or remove it and restart. Persist a successfully returned credential bundle before subsequent API verification so a transient verification failure does not lose it. Failed verification leaves the app quarantined, with no repository access enabled.

Callbacks send `Cache-Control: no-store` and `Referrer-Policy: no-referrer`, render no third-party resources, and redirect to a clean Settings URL. Exclude codes, state values, request bodies, and credentials from application/proxy diagnostics where configurable. Document proxy query-log handling.

## 5. Installation verification and completion

Treat `installation_id` and `setup_action` in a callback as untrusted hints. A setup callback alone must never create an authorized connection. GitHub explicitly recommends verifying the installation against a user access token. [Setup URL guidance](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/about-the-setup-url)

1. Validate the outstanding setup attempt and local administrator. An unsolicited callback from “Manage installation” can show a resume screen, but must not activate access by itself.
2. Start a separate GitHub App user-authorization flow using the app's client ID, exact registered callback, fresh state, and S256 PKCE. This proves GitHub access for connection setup; it is not Kopes sign-in or account linking.
3. Exchange the authorization code server-side. Use the resulting user token to check `/user`, `/user/installations`, and, where needed, the installation's user-visible repositories. Paginate the results. Separately query the installation using app authentication to verify it belongs to this app, has the intended owner, is not suspended, and has required permissions.
4. Only after both checks, create/activate the source connection. Present the owner and available repositories; selecting repositories to scan remains an explicit Kopes action.
5. Do not retain the user token or refresh token after verification. If requests must span a browser round-trip, keep them encrypted in the short-lived setup record and purge on completion or timeout. Scans subsequently use installation credentials only.

GitHub App user tokens reflect the intersection of app and user access and can verify accessible installations. [User authorization documentation](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app)

State transitions: `pending-registration → registered → pending-installation → pending-verification → connected`. Include `expired`, `verification-failed`, and `cancelled` attempt outcomes. Approval pending is not a successful connection. Resume creates fresh state, rechecks local admin access, and does not reuse an expired authorization code.

## 6. Data model and migration

Use SQLite and the existing deployment secret; no new service or external database.

| Record | Proposed fields / constraints |
| --- | --- |
| `github_apps` | Local UUID, GitHub app ID (unique), client ID, slug, owner ID/login/type, canonical origin, encrypted private key/client secret/webhook secret, credential revision, permission profile, webhook mode, status, timestamps |
| `github_installations` | App FK, GitHub installation ID, owner metadata, granted permissions, repository-selection mode, status, access revision, last reconciled timestamp; unique app + installation |
| `source_connections` additions | `auth_kind` (`anonymous`, `pat`, `github_app`, legacy-compatible token kind), label, installation FK, owner metadata, known expiry, typed health/reason, last successful validation; preserve credential/version fields |
| `github_installation_repositories` | Installation FK + immutable GitHub repository ID, current name, private flag, access status, access revision, observed generation/time; unique pair |
| `github_setup_attempts` | State hash, app FK, initiating user/session binding, purpose, owner, status, expires/claimed/completed timestamps, optional encrypted temporary authorization material |
| `github_webhook_deliveries` | App FK + delivery ID, event/action, bounded minimal metadata, received/processed timestamps, processing state; unique pair |

Keep repository IDs, names, and connections distinct. GitHub IDs are stored consistently as validated decimal strings; do not rely on names as identity. Never expose raw database rows that include secrets.

Migration backfills empty credentials as anonymous, existing GitHub credentials as legacy PAT-compatible but unvalidated, and GitLab credentials without changing their behavior. No existing binding is automatically moved to an App. Update public-binding queries to test `auth_kind='anonymous'`; an App's empty static credential must not make it anonymous. Audit all positional `INSERT ... VALUES` statements affected by new columns.

Use a dedicated, versioned encryption context for new App secrets, with app ID and secret type as associated data. Preserve old token decryption. Require stable `BETTER_AUTH_SECRET`; on mismatch, report credentials unavailable without overwriting them. Database backups and the deployment secret are both needed for recovery.

## 7. GitHub transport and token resolution

Introduce a bounded JSON request transport that preserves the current DNS/address policy, HTTPS requirement, timeouts, response limits, and redirect refusal. Allow only explicit API and OAuth endpoints on `api.github.com` and `github.com`; never accept a user-supplied API origin for this feature. Separate API bearer auth, app JWT auth, and OAuth code-exchange bodies so credentials cannot cross hosts accidentally. Pin a documented GitHub API version and test it against every endpoint used.

Use Node's built-in crypto for RS256 app JWT signing, with injected clock and request functions for tests. Set `iss` to the client ID, `iat` to now minus 60 seconds, and `exp` to now plus 9 minutes; an invalid system clock should produce an actionable error. Follow GitHub's JWT requirements. [App JWT documentation](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-json-web-token-jwt-for-a-github-app)

Replace static connection resolution for App-backed reads with an asynchronous credential-aware reader. Before each request, recheck local connection/installation status and obtain a cached or newly minted token. For scan reads, scope the token to the bound repository ID and required permissions. Repository discovery may use an installation-wide read token accessible only to administrator operations.

Tokens come from `POST /app/installations/{id}/access_tokens`; use the returned expiry, refresh early, and keep them only in memory. GitHub currently gives these tokens a one-hour lifetime and allows narrower repository and permission scopes. Cache by app credential revision, installation/access revision, repository scope, and permissions. Coalesce concurrent refreshes; purge caches on access changes. Treat token strings as opaque. [Installation token documentation](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app)

A 401 permits one fresh App token and one retry; no infinite loop. Distinguish permission failures, missing/unavailable repositories, rate limits, and temporary provider failures. Honor rate-limit/reset/Retry-After signals with bounded backoff, including GitHub's 403 rate-limit responses. A 404 does not prove deletion; it may mean missing access. Never fall back from an App to a PAT, another connection, or anonymous access automatically.

Private keys and tokens stay in the main server process and encrypted database records. The isolated source worker receives dependency inputs only, never GitHub credentials. Avoid authenticated URL query parameters and credential-bearing clone URLs.

## 8. PAT fallback

Offer a link to GitHub's fine-grained token creation page, prefilled where supported with a readable name, owner, Contents read, optional Pull requests read, and a suggested 90-day expiry. The administrator selects repositories and creates the token on GitHub, then pastes it into a masked field. One connection corresponds to one resource owner.

“Test connection” performs real reads of the supplied repository's metadata, default branch, tree, and a supported dependency input where present. An empty repository or missing lockfile is a separate scan-readiness result. Metadata access alone is not enough. Verify PR reads only when requested, and allow dependency scanning without that optional capability.

Test credentials in memory without persisting them. Save retests the exact submitted token and repository before encryption. Return only sanitized status and identity. If the repository is public, explicitly state that private access has not been verified and require a private repository to pass the private-access acceptance gate.

Do not claim that successful reads prove a PAT lacks write permissions: API capability checks are not a complete permission inventory. Guide users to fine-grained read-only tokens; do not support classic PAT onboarding in the new UI. Preserve existing legacy tokens as unvalidated until replaced. Do not reject tokens based on an exact length or hard-coded prefix.

Organization approval and membership changes may affect PAT access. Show specific approval/SSO messages only when supported by the response; otherwise report access unavailable without guessing. Use provider expiry information when available, or an optional user-entered date labeled as such. Never renew a PAT automatically. [PAT configuration and limitations](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)

Token replacement validates before swapping; a failed replacement retains the working token. Increment the credential version and cancel/requeue affected work after a successful swap. A blank field means retain the existing secret, never clear it. Disconnect clears the saved token and stops future access while keeping historical reports.

PAT connections use polling. Do not request hook-management permissions merely to install a webhook. Retain existing manually configured legacy hooks where applicable.

## 9. Webhooks, polling, and access removal

Add `/api/github/webhooks/<local-app-id>` with raw-body HMAC-SHA256 verification against the stored App webhook secret, constant-time comparison, strict body limits, and payload shape validation. The local UUID routes the request; it is not authentication. Validate app/installation/repository relationships after signature verification. [Webhook validation](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries)

Persist a deduplicated receipt and minimal durable work item before returning success. Process asynchronously; transactionally record completion and effects so crashes can resume without losing events. Do not persist complete webhook bodies, which can include private commit messages and identities. Reuse the existing job loop or a small in-process database-backed reconciler; do not add a queue service.

| Event | Effect |
| --- | --- |
| `push` | Queue a poll for explicitly bound repositories and matching tracked branches; fetch the actual head from GitHub |
| `installation` created/updated | Reconcile metadata; never activate a new connection solely from a webhook |
| installation deleted/suspended | Pause affected connections, invalidate tokens, cancel pending/in-flight publication |
| installation unsuspended | Reconcile current access before resuming previously selected bindings |
| `installation_repositories` removed | Immediately block affected repository bindings, invalidate scoped tokens, and reconcile |
| repositories added | Update available choices; never automatically start scanning them |
| `ping` / unrelated events | Verify and acknowledge without scanning |

Reconcile installations and selected repositories at startup, on admin refresh, and periodically (target 15 minutes with jitter/backoff). Stage paginated repository lists and publish them only after a complete successful traversal; an interrupted listing must not mark unseen repositories removed. Process restrictive webhook changes immediately; use authoritative reads before restoring access after delayed/out-of-order events.

Process lifecycle events even when scan execution is disabled. The existing combined connection/scanning pilot check is unsuitable for an App lifecycle endpoint. A server not reachable by GitHub operates in polling-only mode; browser callbacks still need to be reachable by the administrator and outbound GitHub HTTPS must work. In webhook mode, the configured HTTPS endpoint must be reachable by GitHub; surface delivery health separately from repository access.

Every job captures connection and relevant access revisions. Check them before collection, worker dispatch, and result publication. Local disconnect/revocation or repository removal cancels publication even if analysis is already running. Periodic reconciliation bounds detection latency for externally changed access; do not promise instantaneous revocation when webhooks are unavailable. A 401/403/404 during a read triggers appropriate revalidation and pauses affected work without deleting historical scans.

## 10. Authorization and private-data handling

Settings, installation discovery, repository pickers, credential updates, and connection switching require current administrator authorization. Mutations require same-origin/CSRF checks; external callbacks instead require single-use state bound to an authenticated session. Validate administrator status again after external awaits before committing mutations.

Repository results, SBOM exports, package views, search, and history must all continue to authorize through the binding's project. Provider repository visibility does not grant Kopes membership. The same repository can exist in multiple projects; filtering must occur before returning names, counts, paths, or results. Review shared snapshot reads for authorization through the requesting binding.

Audit connection creation, installation verification, credential replacement, access loss/restoration, binding changes, and disconnect using non-secret identifiers. Do not log authorization headers, PEMs, codes, tokens, manifest conversion responses, or raw private provider responses. All authenticated responses use private/no-store caching. Existing temporary-file cleanup and retention rules also apply to private dependency inputs.

Keep original public access explicit. Do not automatically upgrade a public binding to a private connection, or expose an inaccessible private repository through public discovery. A change from public to private becomes an access error until an administrator selects a valid connection.

## 11. Proposed routes and modules

| Route | Responsibility |
| --- | --- |
| `GET /api/data/github` | Sanitized connection and setup status |
| `POST /api/data/github` | Discriminated admin actions: start/resume setup, test/save PAT, import/rotate App credentials, refresh, disconnect |
| `GET /api/data/github-repositories` | Paginated admin-only choices for an explicitly selected connection |
| `GET /api/github/manifest/callback` | Claim manifest state and exchange registration code |
| `GET /api/github/install/callback` | Validate setup hint and initiate verified completion |
| `GET /api/github/authorize/callback` | State/PKCE validation and installation association |
| `POST /api/github/webhooks/$appId` | Signed App events |
| Existing `/api/data/repositories` | Add/switch a binding with explicit connection, server-resolved ID, and project authorization |

New server modules: `source/github-http.ts`, `github-app.ts`, `github-setup.ts`, `github-connections.ts`, `github-reconcile.ts`, and `github-webhook.ts`. Keep `GitProvider` focused on repository reads and file collection. New UI: `components/github-settings.tsx` and a shared repository connection selector. Add schemas/types to keep settings secrets separate from browser response types.

Do not duplicate authentication logic in each route; use the existing runtime/session/admin helpers. Replace production uses of synchronous `connectionFor` with the credential-aware reader, including older source-management operations. Update generated route definitions through the normal build tooling.

## 12. Delivery sequence and acceptance

| Stage | Deliverables | Exit condition |
| --- | --- | --- |
| 1. Connection foundation | Schema migration, typed public/PAT/App connections, transport, encrypted storage, explicit binding selection | Existing public and GitLab tests pass; old credentials/history survive migration |
| 2. PAT vertical slice | Settings test/save/replace/disconnect, private repository input, authenticated jobs | Real private repo scan and restart succeed; token loss blocks future access |
| 3. App registration | Manifest generation, state machine, callback exchange, encrypted App records, recovery | Personal and organization registration succeed; failed/replayed state cannot activate access |
| 4. Installation and scanning | Temporary user verification, repository picker, scoped token cache, job revisions | Real private repository scan works after token renewal without a user session |
| 5. Lifecycle | Signed events, durable receipts, reconciliation, suspension/removal/disconnect, polling-only mode | Removed access blocks publication; missed events recover through polling |
| 6. Release validation | UI/access review, documentation, production build and smoke check | Live acceptance evidence recorded; feature advertised only for validated paths |

These are implementation slices, not a reason to expose an incomplete App setup flow. Ship the full App experience once its lifecycle handling passes acceptance. PAT may be exposed earlier if independently validated.

Required automated coverage:

- Migration from current and older supported schemas; idempotent reopen; FK checks; no secret loss; App rows not mistaken for anonymous connections.
- State expiry/replay, wrong session/user/owner/app, revoked local admin, missing/forged installation ID, tampered callbacks, PKCE failure, pending approval, interrupted conversion, and restart/resume.
- App JWT claims, clock skew, token scope/cache isolation, refresh coalescing, expiry/401 retry, opaque long tokens, rate limits, redirect refusal, and secrets absent from errors.
- PAT read validation, public-only validation warning, missing optional permissions, failed replacement preserving credentials, expiry/unknown expiry, disconnect, and cross-connection switching by immutable repository ID.
- Webhook signature failures, malformed/oversized payloads, duplicate/out-of-order delivery, persistence/restart, incomplete pagination, repository removal, suspension, and reconciliation recovery.
- Revocation/disconnect races at input collection, worker dispatch, and final commit; credential refresh must not conceal a changed connection revision.
- Member/outsider/administrator access across repository list, detail, packages, exports, history, and shared snapshots; no private names or counts leak through pickers.
- Existing public repository flow, GitLab source connections, and all sign-in providers continue working.

Run `pnpm typecheck`, `pnpm test`, `pnpm build`, and the applicable existing production/source-worker validation scripts. Use focused new tests for authentication and lifecycle behavior rather than tests that merely mirror UI markup.

Live acceptance uses disposable private repositories in a personal account and a test organization: register via manifest; select one allowed and one excluded repository; verify private dependency scanning; reject excluded access; renew an expired installation token; restart the server; add/remove a repo; suspend/uninstall the App; rotate a key; replace/revoke a PAT; test polling-only operation and missed webhook recovery. Verify optional PR history separately. Record actual observations, timestamps, and limitations without secrets; mocks do not count as private-provider validation.

## 13. Operations, recovery, and documentation

Document account ownership selection before registration, required GitHub privileges/organization approval, permission choices, webhook versus polling requirements, and why GitHub sign-in is separate. Link Settings errors to the relevant recovery step.

Disconnecting an App connection disables its bindings and purges cached tokens and pending setup state. Removing the local App registration additionally deletes its stored private key, client secret, and webhook secret after disabling all associated connections; keep only non-secret identifiers needed by historical records. Show affected repository counts before the administrator initiates removal. Reconnecting a retained registration requires fresh verification.

For key rotation: verify a replacement private key against the same App before saving; bump revision, invalidate tokens, and requeue work. Handle client-secret and webhook-secret updates independently. Webhook secret rotation may use an explicitly short overlap window followed by removal of the old value; periodic reconciliation covers missed events.

For a domain change: block setup using stale registered URLs, show the exact manifest/setup/authorization/webhook URLs to update on GitHub, and verify the new configuration before resuming onboarding. Existing outbound scans may continue if credentials remain valid. Do not silently create a second app.

For restoring backups: restore the database with the matching deployment secret, invalidate all pending setup attempts, and reconcile before resuming scans. Document that old backups can contain previously disconnected credentials; disconnect is not secure erasure of historical backups.

For rollback: take a backup before migration. Older application versions may refuse a newer database; use a compatible application version or restore the matching pre-migration backup, accepting loss of subsequent data. Do not imply that toggling a feature flag reverses schema changes.

Release notes should distinguish App/PAT read support, optional history, webhook delivery, and polling validation. Keep GitHub Enterprise Server and public multi-owner App registrations explicitly outside the initial compatibility claim.


## 14. Implementation status and validation evidence

Updated: 2026-11-15 (validation session approximately 11:00–12:15 UTC). No deployment, commit, push, App registration or remote repository mutation was performed.

The working tree was inspected before editing. It already contained unrelated container/image work and schema migration 14. Those edits were preserved; this implementation adds **migration 15** rather than reusing 14. Existing encrypted token associated-data identities are unchanged. Generated route definitions were updated by the normal Vite build, retaining the pre-existing image route.

### Stage status

| Stage | Implemented | Acceptance status |
| --- | --- | --- |
| 1. Connection foundation | Migration 15, anonymous/legacy/PAT/App kinds, separate encrypted App contexts, bounded fixed-host API/OAuth transport, explicit connection selection, immutable-ID switching | Automated migration, legacy/public/GitLab regression, project authorization and token-preservation checks pass. Read-only migration rehearsal from the available version 2 database reaches 15 and verifies restore. |
| 2. PAT vertical slice | Masked test/save/replace/disconnect UI, real metadata/branch/tree/input validation, separate readiness/optional history results, expiry labeling, per-binding polling and credential-aware jobs | Automated private/public/empty/input-denial/replacement/disconnect tests pass. No live private PAT or worker scan is claimed. |
| 3. App registration | Installation-owned private manifest, distinct callbacks, session/user/owner/step-bound single-use state, 30-minute expiry, PKCE material encryption, conversion quarantine/resume/import and clean redirects | Automated replay, expiry, wrong session/user/owner/App, revoked admin, missing/forged ID, pending approval, interrupted conversion and restart tests pass. Personal/org manifest registration still requires live acceptance. |
| 4. Installation and scanning | Independent user-visible installation and App-authenticated verification, paginated picker, metadata-only discovery tokens, repository-scoped scan tokens, coalesced renewal/one 401 retry, job revision fences | Automated verification, scope/cache/expiry, failed replacement, explicit selection/switching and worker-protocol publication-race tests pass. Actual GitHub-issued token expiry and private worker scans remain unverified. |
| 5. Lifecycle | Exact-byte HMAC, durable deduplicated minimal receipts, transactional restrictions, background reconciliation independent of scanning, complete-list publication, suspension/removal/restoration, PAT checks, disconnect and key rotation | Automated invalid signatures/body limits, duplicate/out-of-order effects, durable recovery, incomplete lists, stale responses and polling tests pass. Live webhook delivery and missed-delivery recovery remain unverified. |
| 6. Release validation | Operator/recovery docs, browser contracts, settings/repository details, live PAT probe, production route/auth smoke assertions and this evidence record | Typecheck/build and executable automated checks pass. Host restrictions prevent production/browser/Docker acceptance; live GitHub release acceptance remains open. Do not advertise live-validated compatibility. |

### Validation results

These observations describe this checkout; provider fixtures and simulated worker outputs are deliberately labeled and do not count as live acceptance.

| Check | Observed result |
| --- | --- |
| `pnpm typecheck` | Passed. |
| `pnpm build` | Passed; includes generated `/api/github/$` route and settings/picker UI. |
| `pnpm test` | Attempted; `tsx` CLI fails before running tests because the sandbox denies its IPC listener (`listen EPERM .../tsx-501/...pipe`). |
| `node --import tsx --test test/*.test.ts` | **304 tests: 300 passed, 3 skipped, 1 failed.** The only failure is existing “Docker events preserve starts…” because the sandbox denies `listen 127.0.0.1`. No assertion failure caused by these changes remains. |
| `node --import tsx --test test/github-connections.test.ts` | **49 passed.** Injected-provider/HTTPS-wire and worker-protocol simulations, not live GitHub/Trivy. |
| Focused GitHub/public/GitLab/project/source regressions | Previous focused run: 86 passed; subsequent full run includes the additional recovery/configuration/race tests. |
| `pnpm test:production` | Attempted; same `tsx` IPC restriction. |
| `node --import tsx --test test/production.smoke.ts` | Attempted; blocked at the initial loopback fixture listener (`EPERM`), before server assertions. New GitHub route/auth smoke assertions are included for an unrestricted rerun. |
| `node scripts/build-source-worker.mjs` | Passed. |
| `python3 scripts/validate-source-worker.py` | Worker bundle built, then Docker execution denied by sandbox socket policy. No packaged-worker acceptance result. |
| `node --import tsx scripts/validate-source-retention.ts` | Blocked by missing `/tmp/kopes-public-npm.json`; Docker is also inaccessible. |
| `python3 scripts/validate-source-resources.py` | Blocked by missing saved public input bundle; no soak result. |
| `node --import tsx scripts/validate-repositories-ui.ts` | Blocked by absent `/tmp/kopes-browser-tools/node_modules/playwright-core/index.mjs`; no browser acceptance result. |
| `node --import tsx scripts/rehearse-project-migration.ts` | Passed against read-only source database: schema **2 → 15**, retained tables matched, backup restore verified, source schema unchanged. Only disposable copies were migrated. |
| `git diff --check` | Passed. |
| Existing GitHub CLI resource | `gh auth status` reported the cached account login invalid. No token value was read or printed. Outbound DNS is also unavailable, so this is not independent evidence that the remote credential was revoked. |
| Anonymous live provider probe | Attempted; host DNS returned `ENOTFOUND api.github.com`. No new public or private live validation is claimed. |
| `node --import tsx scripts/validate-github-private.ts` | Correctly refused to run without explicitly provided test PAT/owner/private repository. No credentials or disposable private test resources were supplied. |

The security suite covers authenticated encryption/reopen, migration FK checks, JWT signatures/clock bounds, DNS pinning/redirect refusal/size limits/rate-limit classification, secret-free errors, token scope/cache isolation and automatic early renewal, single-use state and PKCE association, PAT contents reads, incomplete pagination, lifecycle handling, private binding switching, credential/disconnect races at collection/dispatch/analysis/publication, and late failures not disabling replacement credentials. Existing project/shared-snapshot tests continue covering list/detail/history/export authorization. Sign-in implementation is unchanged and its existing tests run in the full suite.

### Remaining operator actions (after independent implementation)

1. On a host with outbound GitHub DNS/HTTPS, loopback listeners, browser driver and Docker access, rerun the commands above using the required existing worker fixtures. Restore/generate the saved public bundles before retention/soak checks. Existing retention scripts may also need their older container-association fixtures adapted to the repository-independent schema introduced before this feature; they did not reach that step in this environment.
2. Sign in to Kopes as an administrator. In **Settings → GitHub connections**, register a disposable private App for your personal account, then separately for a test organization. Approve organization installation when GitHub requests it. Select an allowed repository and leave another excluded. No central Kopes App or sign-in scope changes are needed.
3. Run the section 12 live acceptance matrix: private dependency worker scans, excluded-access rejection, real token expiry/renewal, restart, add/remove repository, suspension/uninstall, key rotation, PAT replace/revoke, polling-only changes, missed-webhook recovery and optional PR/review reads. Record actual timestamps/outcomes without secrets.
4. Create a fine-grained read-only PAT for a disposable **nonempty private repository**, and test/save it through the masked Settings form. For a separate read-only probe, set `KOPES_TEST_GITHUB_PAT`, `KOPES_TEST_GITHUB_OWNER`, and `KOPES_TEST_GITHUB_REPOSITORY` locally and run `scripts/validate-github-private.ts`. Do not paste credentials into chat. This probe validates provider reads only, not App registration or the source worker.

Operational details are in [GitHub connection setup and recovery](../github-connections.md). Callback URLs not exposed by GitHub's metadata API require operator confirmation and live callback traversal; homepage and webhook configuration are checked remotely before setup resumes. New App/PAT paths are described as requiring installation validation until the live matrix passes.
