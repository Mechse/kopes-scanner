# Private GitHub repository connections

Implementation is available for installation-level validation. **Live personal-account and organization acceptance is not yet complete.** The automated tests use injected provider responses; they are not evidence of live GitHub registration or a private repository scan. See the [implementation evidence](plans/github-private-repositories.md#14-implementation-status-and-validation-evidence).

## Choose the repository owner

An administrator opens **Settings → GitHub connections**. Use **Connect with GitHub App** for the recommended connection. The self-hosted installation owns and encrypts its credentials; there is no Kopes broker. Choose the personal account or organization **that owns the repositories**. The person registering the App needs the relevant GitHub privileges; an organization may require approval. Create separate connections for separate owners. This release targets github.com private Apps, not GitHub Enterprise Server or public multi-owner Apps.

The manifest requests Contents read and implicit Metadata read. Opt into Pull requests read only if PR/review history is needed. Contents read permits repository contents generally; GitHub does not restrict this permission to dependency files. Kopes reads supported dependency inputs, never clones, executes source, installs dependencies, or obtains container-image access through these credentials.

GitHub App setup is independent of **Settings → Sign-in methods** and `/api/auth/callback/github`. GitHub, Google and Microsoft sign-in configuration is unchanged. Connecting a repository grants nobody access to Kopes.

## Register and verify an App

1. Set a stable `BETTER_AUTH_SECRET` and canonical `BETTER_AUTH_URL`. Callback URLs are generated from this configured origin, not incoming proxy headers.
2. Select owner/type, optional history, and polling or webhook mode. **Prepare registration**, then **Continue on GitHub**. The submitted form contains public configuration only.
3. Return in the same signed-in administrator browser session within 30 minutes. Kopes claims the hashed state once and exchanges the manifest code on the server. Successfully returned credentials are encrypted before the next verification request.
4. Complete installation for that owner. **App created — installation required** is not a connected installation.
5. Authorize the App when redirected to GitHub. Kopes uses fresh state and S256 PKCE, checks the GitHub user and their paginated visible installations/repositories, and independently queries the installation with App authentication. The installation ID in a callback is only a hint. Approval-pending and forged callbacks never activate access. User and refresh tokens are discarded; scans use installation tokens.
6. After reconciliation, open **Repositories → Add repository**, select the connection explicitly, and choose an accessible repository. Saving resolves and verifies the immutable repository ID again. Only selected Kopes bindings are scanned; granting additional repositories on GitHub does not add scans automatically.

Callbacks require the initiating local session and current administrator status, including after external requests. They have no third-party content and send `Cache-Control: private, no-store` and `Referrer-Policy: no-referrer`. Completion and failures return to Settings without OAuth codes or state. Failure redirects carry only an allowlisted notice identifying the failed phase, displayed in the Integrations tab. Expired/interrupted setup can be resumed with fresh state; restarting the server invalidates all pending attempts.

**Prepare registration fails:** this step runs locally, before any request to GitHub. Enter only the GitHub username or organization login as Resource owner, without `@` or a URL; surrounding whitespace is ignored. For `http://localhost` or `http://127.0.0.1`, select **Polling only**. Webhook mode requires HTTPS. Errors now identify invalid fields, an expired administrator session, a read-only/busy/full database, or an incomplete schema with a safe error code. The previous generic permissions/credentials message did not establish a GitHub permissions problem. Rebuild/restart the updated application using the existing data volume and secret to get the specific diagnostic; do not delete data or create another App to troubleshoot this local step. If it still fails, report the displayed message/code without credentials.

**GitHub rejects a localhost hook URL:** older builds included a webhook URL even with polling selected and the hook marked inactive. GitHub still validates that URL. Polling manifests now omit `hook_attributes` entirely and subscribe to no events; browser callback URLs still use your configured origin. After rebuilding/restarting, return to Settings and prepare a fresh registration in **Polling only** mode, then continue to GitHub. Resubmitting the old GitHub form reuses the invalid manifest. Webhook mode continues to require a publicly reachable HTTPS endpoint. The [GitHub manifest reference](https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest) lists webhook configuration separately from browser callbacks.

**Interrupted manifest exchange:** do not retry the same conversion code. If credentials arrived, **Finish installation** uses them. If the response was lost after GitHub created the App, use **Reconnect an existing App** to import its App ID, client ID, private key, client secret and (for webhook mode) webhook secret. Alternatively, remove that App on GitHub and restart registration. Failed verification does not grant repository access.

**Created on GitHub, then redirected to Settings with no Resume button:** `verification-failed` without a Resume button means Kopes did not save the credential bundle. An earlier build required a nonempty webhook secret even for Apps created without a webhook. Polling registration now accepts a null, omitted or empty webhook secret; it saves the private key and client secret encrypted and continues to installation verification. Webhook mode still requires a secret, and webhook requests cannot authenticate with an empty secret. The old callback response is not recoverable from Kopes. After updating, import the existing App using **Reconnect an existing App**, select **Polling only**, supply its App ID/Client ID, generate a private key and client secret in that App's GitHub settings, and leave Webhook secret blank. Verify its callback URLs against the values shown in Kopes, then save and resume installation. If you prefer a new registration, delete only the unused failed App on GitHub yourself before starting again. Do not reset the Kopes database or deployment secret.

## Personal access token fallback

Choose **Use personal access token**. The link opens GitHub's fine-grained token form with owner, Contents read, optional Pull requests read and a suggested 90-day expiry. Select only the required repositories. Legacy GitHub connections are removed on upgrade. To resume scanning an affected repository, select a GitHub App or fine-grained PAT in its settings. Existing scan history is retained.

Enter a connection name, owner, masked token and an actual **private** repository URL. **Test connection** reads metadata, default branch, the recursive tree and supported dependency inputs. It does not save credentials. **Save connection** repeats the reads with exactly the submitted token before encrypting it. Public-only access cannot pass private-access validation. Empty repositories are reported separately and cannot pass this gate; a nonempty repository without supported dependency inputs can prove private Contents access but is not scan-ready. Optional history failure does not block dependency scans.

Successful reads do not prove that the token lacks write permissions. Configure a fine-grained read-only token yourself. Organization approval, SSO, expiration and membership can affect access. Kopes does not infer approval/SSO status from a generic 403. Expiry is **unknown** unless you provide a date, which is labeled user supplied. PATs are never automatically renewed.

Replacement is validated before swapping. Failed validation leaves existing credentials intact. A blank token/key/secret field retains the existing value. Successful changes increment revisions, cancel current work and schedule fresh polling. Each PAT connection is tied to one owner.

## Polling, webhooks and revocation

**Polling only** needs outbound HTTPS to `api.github.com` and `github.com`; GitHub does not need inbound access to Kopes. The administrator's browser must reach the canonical callback URLs. Localhost HTTP is supported only for polling setup. App and PAT access is reconciled at startup and periodically, independently of scan-execution flags. App polling targets 15 minutes plus jitter, with retry backoff on provider failures. Selected PAT bindings are checked individually. Default-branch scan polling continues to use the existing source-worker flags and spool configuration.

**Webhooks** additionally require publicly reachable HTTPS. Configure the exact App webhook URL shown in Settings. Signatures use the generated App secret and exact request bytes. Receipts store bounded event/action, installation/repository IDs and branch metadata, never complete payloads or commit messages. Receipt deduplication and restrictive effects are transactional; durable reconciliation also recovers missed events. Push events request an authoritative head read, not the webhook's claimed commit. Repository additions update choices only. Unsuspension/restoration requires authoritative reads; a delayed event cannot directly restore access.

Settings shows the latest verified webhook receipt separately from repository access health. Absence of delivery does not imply lack of repository access. Lifecycle delivery semantics and externally reachable webhook behavior still require live acceptance for your deployment.

App tokens stay in process memory, renew before their returned expiry and are scoped to one repository and read permissions during scans. Discovery tokens are metadata-only and restricted to administrator operations. Concurrent refreshes coalesce; a 401 permits one fresh-token retry. No code falls back to another connection, a PAT or anonymous access.

Jobs check connection, App credential, installation/access and binding revisions before collecting inputs, dispatching the worker and publishing. Disconnect, key/token replacement, suspension and repository removal cancel publication even if analysis is running. Polling bounds detection latency for external changes; instant revocation is not promised when webhooks cannot arrive. Worker input contains dependency data, never provider credentials. Private dependency data uses the existing protected spool and cleanup/retention paths.

## Access and history

In GitHub settings, search by app name, connection name, or owner. Open an App to manage its registration. Under **Repository access**, select an installation to check or disconnect its access. Personal access tokens open directly from the connections list. Each detail page can be bookmarked.

**“Repository access failed” before a scan:** this older message covers credential loading, repository metadata, the default-branch head and local scan-history reads, before the isolated dependency worker is dispatched. It does not establish that the worker is broken or that GitHub denied access. Updated builds report the failed stage and fixed diagnostic codes for credential decryption, App keys/token expiry, incomplete metadata, changed repository identity and missing branch commits. If a numeric-ID lookup omits the default branch, Kopes now reads full metadata by the returned repository name with the same credentials and verifies that the immutable ID still matches. Restart the updated application and retry the scan; if it still fails, report the new stage/code without credentials. This path is covered by simulated private-scan regression tests; the exact cause in a live installation still requires its retry result. Existing scan history is retained.

Connection settings, discovery, credential updates and switching connections require a current administrator. Same-origin checks protect mutations; external callbacks use session-bound state instead. Standalone repositories remain administrator-only. Project repository lists, scan details, packages, exports and history continue to use project membership, including shared snapshots.

Public access is always explicit and anonymous. It never borrows a saved credential. A public repository that becomes private reports an access error until an administrator selects an authorized connection. Changing an existing binding to another connection requires a successful read of the same immutable repository ID, preserving project assignment and history.

**Disconnect** cancels future/in-flight work, clears a saved PAT and invalidates cached tokens/setup attempts, while retaining reports. It does not uninstall an App on GitHub. **Remove local App registration** shows the affected repository count, disables connections and deletes all local App secrets while retaining non-secret identifiers/history. Importing that same App later reuses its local identity and still requires fresh installation verification. GitHub removal/uninstallation is a separate action via the management links.

## Rotation, domain changes, backup and rollback

- **Private key rotation:** generate a replacement on GitHub and use **Replace credentials**. Kopes verifies it against the same App before storing it, increments the revision and invalidates running work/tokens. Remove the old key on GitHub after verification.
- **Client/webhook secrets:** update the matching field; blank fields retain their saved values. These secrets cannot be validated from GitHub's masked configuration response: authorization and a signed delivery prove them respectively. Webhook rotation switches immediately (no overlap); polling covers missed events. Keep their remote and local values in sync.
- **Domain change:** existing outbound scanning can continue. Setup refuses a retained App whose stored origin differs from the configured origin. Update GitHub's homepage, manifest redirect, setup URL, authorization callback and webhook URL to the exact Settings values. Re-import/update the existing App with confirmation of its URL configuration and complete fresh authorization. The App identity/key and homepage origin are verified remotely; webhook-mode resume also checks the exact webhook URL, JSON content type and TLS verification. GitHub does not expose all registered callback URLs in its App metadata API. Successful callback traversal must be verified live. Do not create a second App to work around a domain change.
- **Backup:** back up the database together with the matching `BETTER_AUTH_SECRET`. Restore both. Startup invalidates pending attempts and reconciles access before scanning resumes. A secret mismatch reports unavailable credentials without resealing or overwriting them. Old backups can contain previously disconnected secrets; disconnect is not backup erasure.
- **Rollback:** take a backup before migrating. The connection foundation uses schema **15**; schema **16** repairs early version-15 databases missing the PAT polling schedule column (`source_connections.next_check`). Both retain existing credentials and scan history. Old versions may refuse the newer schema. Use a compatible application version or restore the pre-migration backup, accepting loss of subsequent data. Disabling scan flags does not reverse migrations.

Do not log authorization headers, request bodies, App PEMs, OAuth codes, state, conversion responses or raw private API responses. At your reverse proxy, suppress query strings for `/api/github/*/callback` (for example, log the Nginx `$uri` rather than `$request`/`$request_uri`), suppress request bodies and redact sensitive headers. Apply equivalent rules to upstream load balancers and APM. No application logger is added to these routes.

## Validation on an authorized host

Run `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm test:production` and the applicable source-worker/browser validation scripts. If the `tsx` CLI IPC socket is unavailable, the same test files can run with `node --import tsx --test test/*.test.ts`. Loopback, browser tooling, Docker and the worker fixtures are still needed for their respective acceptance tests.

For a read-only **live PAT probe**, provide `KOPES_TEST_GITHUB_PAT`, `KOPES_TEST_GITHUB_OWNER` and `KOPES_TEST_GITHUB_REPOSITORY` in your shell or a protected local environment file, then run:

```sh
node --import tsx scripts/validate-github-private.ts
```

Set `KOPES_TEST_GITHUB_HISTORY=1` to test optional history. The probe outputs sanitized identity/readiness evidence, never the token. It does not register an App or validate the scan worker, and refuses to claim private success for public/empty repositories. Do not paste credentials into chat or commit environment files.

Complete the plan's live matrix using disposable personal and organization repositories: manifest registration, allowed/excluded repositories, successful private worker scan, actual token expiry/renewal, restart, removal/addition, suspension/uninstall, key rotation, PAT replacement/revocation, polling-only detection and missed-webhook recovery. Record observations with timestamps and distinguish dependency read support, PR history, webhook delivery and polling outcomes. Until these pass, do not describe the feature as live-validated.


## Startup errors after updating

An early development build could mark the database as version 15 before the PAT polling schedule column was included. Later builds queried that missing column during startup, and the old startup handler displayed the misleading “Installation not configured” message. Migration 16 adds the missing column without changing credentials or historical scans; it is also safe on complete version-15 databases. Restart/rebuild with the updated application using the same data volume and deployment secret. Do not rerun setup or delete the data volume to repair this issue.

Startup failures now report a sanitized stage (configuration, database, filesystem, authentication or source recovery), without exposing credentials or raw exception details. If startup still fails after the update, use the new stage/reason to diagnose the actual deployment; the old message alone does not establish that environment variables were missing.
