# Phase 2 — read-only source pilot

Implementation: `src/server/source/provider.ts`, `service.ts`, `webhook.ts`, and the managed-project source UI. All pilots default off. No upstream settings or repository writes have been made.

Implemented: separate administrator-managed source credentials (not sign-in OAuth), public access without credentials, encrypted token rotation/disconnect, immutable repository identity, branch/folder/resource selection, project-scoped bindings, bounded dependency-input collection at full SHAs, redirect rejection, DNS address pinning and revalidation, approved self-hosted origins/custom CA support, sanitized health states, authenticated push-hook delivery deduplication, and polling reconciliation. Actions use the authenticated administrator ID. Disconnect cancels work and keeps historical evidence.

GitHub accepts an administrator-supplied repository-selected App installation read token; automatic App private-key token issuance/renewal is not implemented. Expired tokens surface as stale/error and can be replaced. GitLab accepts a read-only API-capable token. Entering a repository path selects a repository explicitly; the UI does not enumerate everything a broad token can access.

Measured public adapter checks: see `github-public.json` and `gitlab-public.json`. GitHub includes immutable dependency-input fetching. GitLab.com includes repository identity and branch SHA resolution using the actual adapter; earlier Phase 0 evidence also exercises immutable manifest reads. Public endpoint success does not establish private permissions.

Tests cover authenticated encryption bound to connection/origin, rejected network destinations, unsafe paths, symlinks, truncated trees, immutable addressing, project isolation, hook authentication, replay deduplication and disconnected hooks.

## Open gates

- Private GitHub App least-privilege, expiry/revocation and installation lifecycle checks.
- GitLab.com private access and a versioned self-hosted instance, including custom CA/private routing, pagination and hook delivery.
- Real minimum-scope PR/MR/review permissions. History reads are bounded; unavailable history never assigns a fixer.
- Full private-provider release certification. No self-hosted version is certified.

Manual hook contracts follow [GitHub signature validation](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries) and [GitLab webhook headers](https://docs.gitlab.com/user/project/integrations/webhooks/). These references were checked on 2026-11-09; locally simulated hook tests are distinct from live delivery validation. GitLab's token-header contract is implemented, not its newer optional signing-token feature. Without tested delivery identity headers, keep polling.
