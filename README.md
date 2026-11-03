# kopes.ai — single-host scanner

An installable TanStack Start app using Trivy, Better Auth/GitHub, SQLite, Tailwind
and shadcn-style Radix components. This repository is self-contained: it includes
its own logo and light/dark design tokens and does not require the private landing
page repository.

## License

The scanner's original code is source-available under
[PolyForm Shield 1.0.0](LICENSE), not an OSI-approved open-source license. Internal
business use is permitted; providing competing products or services is restricted,
even when they are free. The full license controls, including its exceptions.
Third-party dependencies retain their own licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Install on a Linux Docker host

Requires Docker Engine + Compose v2, a modern Linux kernel (5.12+ for recursively
read-only bind mounts), and outbound HTTPS. Start with 2 GiB available RAM and
several GiB free disk; large images and Java databases may need more. Supported
host package databases: Debian/Ubuntu dpkg, Alpine apk and RPM-based distributions
that Trivy recognizes. Docker Desktop needs the override below and supports only
container-image scans, **not** macOS/Windows or VM host-package scans. Rootless
Docker and SELinux-specific policy setup are not validated in this MVP.
The Linux root bind uses `rslave`: Docker rejects `rprivate` because `/` contains
its data root. Host mount changes can propagate inward, never back to the host;
new submounts are not guaranteed to inherit read-only restrictions.

From a checkout of this repository:

```sh
cd kopes-scanner
# Requires Node.js 24.15+; no pnpm install needed for the setup helper.
node scripts/setup.mjs
# Or: pnpm run setup

docker compose up -d --build
docker compose logs -f scanner
```

The setup helper generates a random auth secret, prints the exact GitHub callback
URL, and writes `.env` with mode 0600. It never overwrites an existing `.env`.
Without Node on the host, copy `.env.example` to `.env`, run `chmod 600 .env`,
generate a secret with `openssl rand -hex 32`, and fill in the values manually.

1. Choose the browser URL: `https://security.example.com`, or
   `http://localhost:3100` for local use/SSH forwarding.
2. Create a **GitHub OAuth App** at <https://github.com/settings/developers>.
   Homepage: your browser URL. Callback: `<browser URL>/api/auth/callback/github`.
3. Supply its client ID, client secret and a comma-separated GitHub username
   allowlist. This uses profile/email scopes, **not repository access**.
4. Open your browser URL and sign in. Only explicitly allowed accounts can access
   inventory, reports, SBOMs or scan controls. Removing a username and recreating
   the scanner revokes that user's API access, including existing sessions.

The app binds to **127.0.0.1:3100** by default. For production, configure your
existing HTTPS reverse proxy to forward to this port; set `BETTER_AUTH_URL` to
that exact public HTTPS origin. HTTP is accepted only for localhost/127.0.0.1.
For a containerized reverse proxy (including Coolify/Dokploy), attach **only the
scanner** to its ingress network and route to `scanner:3100`; do not attach the
socket proxy or publish port 2375. In that case the host-port binding can be removed.

There is no published release image yet: Compose builds locally from the repo.
The app image includes Node, the web server and the Trivy executable; it is **one
application container, not one executable**. A second, narrowly scoped HAProxy
container guards Docker's API. SQLite, SBOMs, reports and Trivy's cache live in the
`scanner-data` volume. No external database or hosted kopes service is needed.

## Local preview on Docker Desktop

After the same setup step, use Docker Compose **2.24.4+** and both files:

```sh
docker compose -f compose.yaml -f compose.desktop.yaml up -d --build
```

Keep both `-f` flags for subsequent Compose commands on Desktop. The override
removes the host root bind and supplies an empty read-only `/host`; container
inventory and image scans still use the socket proxy. **Host OS scanning is
unavailable** and its target will show “No supported host package database found.”
This is not a clean host scan. Use the base `compose.yaml` alone on a Linux VPS
for actual host-package coverage. Do not try to fix Desktop mounts by adding
privileged mode or making the bind writable.

## What it does

- Lists running containers, grouped by Coolify/Dokploy labels where present,
  falling back to Compose project or Standalone. Deduplicates scans by immutable
  image ID. Platform labels vary; generic Compose grouping is the fallback.
- Watches Docker start/lifecycle events; reconciles inventory every 30 seconds to
  recover missed events. An existing container's restart also queues a re-match.
- Generates a CycloneDX SBOM for each new image. Every six hours (configurable via
  `SCAN_INTERVAL_HOURS`, 1–168), re-matches saved image SBOMs against Trivy's
  database. Trivy manages database freshness/downloads; it is not a real-time feed.
- Copies only known OS/package-database paths from `/host` into a scratch
  directory, then scans that snapshot. Refreshes host inventory every scan.
  Does not crawl host application directories, homes or volumes. A package-manager
  update concurrent with the snapshot may require a retry.
- Shows severity, package, installed/fixed versions, package inventory, scan time,
  failed/stale scans and downloadable SBOMs. Only the latest successful result is
  stored; a failure never overwrites it with an empty/clean report.
- Runs one scan at a time, with bounded command timeouts. The first scan can take
  minutes while databases download. Host scanning works even if Docker is down.

### Verified image comparisons (deliberately bounded)

For public Docker Hub/GHCR images with numeric stable tags, examines up to **two**
newer same-major, same-tag-variant candidates. Scans immutable candidate digests
for the running image's platform, then compares advisory/package/ecosystem pairs.
The UI reports findings no longer detected, newly detected and remaining—not a
promise that an upgrade is safe or compatible. Tags can move; the checked digest
and timestamp are shown. No images are deployed or changed.

Docker Hub discovery is limited to the most recently updated 100 tags; GHCR to
the first 1,000. Moving tags (`latest`, `stable`), digest-pinned references,
unsupported tag formats and private-registry recommendations are explicitly
skipped. Private **installed** images can still be scanned through local Docker;
no private registry credentials are collected. Candidate comparison failures do
not discard the installed-image scan. Missing findings can reflect removed
packages or different scanner coverage, not necessarily a package fix.

## Security boundary

- The Docker socket is mounted only into the proxy. The scanner runs as UID/GID
  65532, with standard `/host/run`, `/host/var/run`, `/host/proc`, `/host/sys` and
  `/host/dev` paths masked by empty read-only tmpfs mounts. This matters because a
  read-only host bind **still permits Unix socket connections**. Nonstandard socket
  locations need equivalent masking; never make the Docker socket world-accessible.
  The proxy accepts only GET/HEAD on
  ping/version, running-container list, events and image metadata/export routes.
  Container exec, writes, logs, filesystem archive and secrets endpoints are denied.
  The proxy has no published port and is on an internal network.
- **Read-only does not mean harmless.** The `/host:ro` mount can expose host secrets
  if the app is compromised; read access to image layers can expose embedded secrets
  too. The app intentionally copies only package databases, but that is application
  behavior, not a filesystem sandbox. Run this only on hosts whose owner trusts it.
- The scanner is non-root, all Linux capabilities are dropped, no-new-privileges
  is enabled, and the container filesystem is read-only except its data/tmp volumes.
  Host package databases must be readable by UID 65532 (typically world-readable
  on supported distributions). Restrictive permissions produce a visible scan error;
  grant only targeted read access if needed, rather than running privileged.
  Keep Docker/kernel current: nested host mounts may not be recursively read-only
  on older kernels. A `:ro` socket mount alone does **not** make Docker API calls safe;
  the proxy's endpoint/method ACL is the enforcement boundary.
- OAuth tokens are encrypted at rest using the auth secret. SQLite still contains
  sensitive inventory/session material; protect the data volume and `.env`.
- No telemetry is added. GitHub OAuth, registry metadata/image downloads and
  Trivy database downloads require outbound requests. Public image repositories
  and tags are disclosed to their registries. SBOM/CVE matching runs locally.
- No multi-host orchestration, runtime detection, SAST, auto-patching or public
  sign-up. This is vulnerability inventory, not proof that a host is secure.

## Operate / develop

```sh
# After editing .env (including the allowlist)
docker compose up -d --force-recreate scanner

# Update source first, then rebuild without deleting the data volume
docker compose up -d --build

# Local development (Linux host + accessible socket proxy + Trivy on PATH)
pnpm install --frozen-lockfile
pnpm dev
pnpm test
pnpm typecheck
pnpm build
pnpm test:production
```

`pnpm dev` and `pnpm start` load `.env`; Compose injects it into the container. For development outside Compose,
set `DOCKER_HOST` to an accessible private HTTP socket-proxy origin, `HOST_ROOT`
to a test Linux root, and optionally `TRIVY_BIN` to a local Trivy executable.
Never expose an unauthenticated Docker API on a public interface.

`/healthz` checks app/database initialization and worker liveness; Docker/scan
failures appear in the authenticated UI instead of causing restart loops. The
Compose memory/CPU limits are intentionally modest; raise them for large images.
Monitor disk: Trivy caches are not size-capped in this MVP. Only one scanner
process may use a data directory. Do not scale replicas.

For a consistent backup, stop the scanner and copy `/data` from its stopped
container, then restart. Restore only while stopped. Keep `.env`/the auth secret
with the backup in secure storage. `docker compose down` preserves data;
`docker compose down -v` **deletes all scan and authentication state**.

### Verification status

Automated tests cover config/allowlisting, OAuth profile rejection and session
revocation, origin checks, grouping/events, queues/recovery, host snapshots,
Trivy parsing, candidate filtering and the scan pipeline. `test:production`
build-smokes the emitted server in an isolated directory. To also exercise the
proxy ACL against a local HAProxy executable, run `HAPROXY_TEST_BIN=/path/to/haproxy pnpm test`.
With Docker Compose installed, `DOCKER_TEST=1 pnpm test` also validates the Linux
mount policy and Desktop override. Desktop mounts were smoke-tested in a
non-root, read-only container; a full Desktop scan was not verified.
Manual checks passed for browser login/dashboard/themes/mobile navigation and real
Trivy SBOM/CVE matching of a Debian package fixture and a public Alpine image.
A live GitHub callback and a real Linux Docker/socket-proxy installation still
need release testing.
See `THIRD_PARTY_NOTICES.md` before distributing a commercial image.
