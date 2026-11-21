# GitLab: one application, personal repository access

## Register the deployment

1. Sign in as an existing Kopes administrator **through a different provider**. Keep that login configured and test it in a second browser before changing authentication. GitLab is optional; it is not a bootstrap or recovery provider.
2. Open **Settings → Integrations → GitLab**. Use `https://gitlab.com` (default) or the HTTPS origin of one approved self-managed instance. Do not include `/api/v4`, a relative installation path, or credentials. For a self-managed host, configure `KOPES_GITLAB_ORIGINS` on the Kopes server (comma-separated exact origins). If it resolves to private addresses, also explicitly authorize its origin in `KOPES_GITLAB_PRIVATE_ORIGINS`. Supply the trust chain in `KOPES_GITLAB_CA_PEM` for private PKI. Keep hostname and certificate validation on; loopback/link-local endpoints and redirects are not supported. The browser and Kopes must both reach the instance.
3. In GitLab's Applications settings register **one confidential application**. Enter both redirect URIs from Kopes, one per line. They are derived from `BETTER_AUTH_URL`, not the incoming Host header:
   - `<Kopes origin>/api/auth/callback/gitlab` — identity
   - `<Kopes origin>/api/data/gitlab/callback` — personal repositories
4. Enable exactly `openid`, `email`, and `read_api` on the registration. Do not mark the application trusted or add write scopes. Enter its Application ID and client secret in Kopes. Leave sign-in unchecked for repositories-only operation. Saving the app imports nothing; there is no shared repository credential. Keep `BETTER_AUTH_SECRET` stable and protect it separately from database backups. Do not record token exchanges, authorization headers, callback query strings or form bodies in proxy/debug logs.

## Identity and repository access are different

**Sign in with GitLab** requests `openid email` only. Invite the verified email address through the normal Kopes allowlist. Kopes reads the issuer's authenticated UserInfo endpoint and requires `email_verified: true` and a stable subject; it does not consume the ID token, send email, or require SMTP. A matching email does not merge an existing account. If the instance omits verification or doesn't release the email, keep GitLab sign-in off and use another provider. Microsoft and other existing login methods retain their own requirements.

**Repositories → Browse repositories** (administrators: **Add repository**) → **Connect my GitLab account** requests only `read_api`. Consent using the account whose projects you want to see. The connected username appears above the picker. Searching returns projects visible to *that* account (including public and subgroup projects). There is no PAT entry and no use of a login token for discovery. Any authorized Kopes user may browse; only an administrator may import. Connecting does not create a login or change Kopes roles.

Before confirming **Import**, choose the destination carefully. Administrators can view administrator-only scans; container members can see that container's repository and scan history even without access to the original GitLab project. Import independently reads the project's metadata and branch head and checks destination authorization. Bindings use the GitLab origin and numeric project ID, not the namespace string.

## Scans and recovery

Use the existing [isolated source worker and storage prerequisites](source-pilot.md): dedicated `KOPES_SOURCE_SPOOL`, worker with its scanner database and storage budget, and both `KOPES_SOURCE_PILOT=1` and `KOPES_SOURCE_SCAN_PILOT=1` on the approved scanning deployment. Consent and browsing do not require enabling those flags. The server polls the default branch (15-minute schedule), collects inputs at the immutable commit, and sends a bundle, not the token, to the worker. No webhook is needed.

- **Reauthorization required**: check membership first. Restore access, reconnect the same personal account if needed, then explicitly import the same project into the same destination to verify it and resume the paused binding. Reconnecting alone does not resume scans.
- **Disconnect account** discards that user's stored tokens and stops dependent work, not other users' scans. To revoke the grant on GitLab too, remove the application under the user's authorized applications. Do not delete a repository to disconnect it: deletion removes history.
- **Importer leaves**: remove their Kopes access. Keep the old paused binding and its history. A remaining administrator with GitLab access can connect their own account and explicitly import into the intended destination, creating a new binding rather than transferring tokens or silently inheriting scans.
- **Change instance or application ID**: use the independent admin login and **Disconnect deployment** first. This discards every personal grant and pauses all affected bindings. Register the new callbacks and repeat personal consent. Equal numeric IDs on two hosts are unrelated.

## Disposable smoke check — repeat for GitLab.com and self-managed

Use only an explicitly authorized test deployment, test users and disposable repositories. Provision secrets through a secret manager or the settings UI, never chat or command history. Do not enable production pilots.

1. Register both callbacks, leave GitLab login disabled, sign in via the recovery provider, and complete repository consent. Verify the screen asks for `read_api` only.
2. Enable identity sign-in, sign in with an invited verified address without SMTP, and check that consent requests `openid email` only. Try an uninvited user and a test issuer with missing/false verification; neither should get a session.
3. Give A private subgroup access that B lacks. Use separate browser profiles and personal consents. Search and page through projects as both. B cannot list A's private result, use A's connection ID, or import A's project by ID. A non-admin can browse but cannot submit an import.
4. Import as an administrator into a test container, verify result visibility as a member and an outsider, and record the scan commit. Push one disposable change; after polling verify the new commit and that the original history remains.
5. Remove only one GitLab project's access and confirm only its binding pauses. Revoke or disconnect A and confirm A-backed scans stop while B continues. Restore access and reselect projects deliberately. Remove an importing user and test the replacement administrator procedure.
6. Test both the private-origin deny case and a trusted private-CA connection on self-managed. Try changing hosts without disconnecting; then reset and register a different authorized test host. Verify no old token, login state, or project binding carries across. Clean up test grants and app registrations.
