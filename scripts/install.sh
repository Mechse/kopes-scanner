#!/usr/bin/env bash
# Run on the VPS itself. Prompts use /dev/tty so curl | sudo bash works.
set -Eeuo pipefail

REPOSITORY=https://github.com/Mechse/kopes-scanner.git
INSTALL_DIR=/opt/kopes-scanner

fail() { printf '\nError: %s\n' "$*" >&2; exit 1; }
confirm() {
  local answer
  printf '%s [y/N]: ' "$1" >&2
  IFS= read -r answer <&3
  [[ "$answer" == y || "$answer" == Y ]] || fail 'Cancelled; no further changes made.'
}

require_host() {
  [[ $(uname -s) == Linux ]] || fail 'This installer supports Linux VPSs, not Docker Desktop.'
  [[ $EUID == 0 ]] || fail 'Run this installer with sudo (or as root).'
  # os-release is supplied by the operating system, never by the checkout.
  # shellcheck source=/dev/null
  source /etc/os-release
  case "$ID" in
    ubuntu) dpkg --compare-versions "$VERSION_ID" ge 22.04 || fail 'Ubuntu 22.04+ is required.' ;;
    debian) dpkg --compare-versions "$VERSION_ID" ge 12 || fail 'Debian 12+ is required.' ;;
    *) fail 'Automatic installation supports Ubuntu and Debian only.' ;;
  esac
  local kernel
  kernel=$(uname -r)
  dpkg --compare-versions "${kernel%%-*}" ge 5.12 || fail 'Kernel 5.12+ is required for read-only host mounts.'
  [[ $(dpkg --print-architecture) == amd64 || $(dpkg --print-architecture) == arm64 ]] || fail 'This installer supports amd64 and arm64.'
  # Never silently deploy to a remote daemon or a rootless user context.
  unset DOCKER_CONTEXT
  export DOCKER_HOST=unix:///var/run/docker.sock
}

install_dependencies() {
  local missing=() package
  command -v curl >/dev/null || missing+=(curl)
  command -v git >/dev/null || missing+=(git)
  command -v ss >/dev/null || missing+=(iproute2)
  [[ -f /etc/ssl/certs/ca-certificates.crt ]] || missing+=(ca-certificates)
  if ! command -v docker >/dev/null; then
    # Do not replace another container runtime or remove distro packages automatically.
    for package in docker.io docker-compose docker-compose-v2 docker-doc docker-buildx podman-docker containerd runc; do
      if [[ $(dpkg-query -W -f='${Status}' "$package" 2>/dev/null || true) == 'install ok installed' ]]; then
        fail "Existing $package package found. Install Docker Engine + Compose v2 manually, then rerun. No runtime packages were removed."
      fi
    done
    [[ ! -e /etc/apt/sources.list.d/docker.sources && ! -e /etc/apt/sources.list.d/docker.list && ! -e /etc/apt/keyrings/docker.asc ]] || fail 'An existing Docker apt configuration was found. Finish installing Docker manually, then rerun.'
    confirm "Install Docker Engine, Compose and build plugins from Docker's apt repository, plus curl/git/iproute2/CA certificates? This enables the Docker system service."
    apt-get update
    apt-get install -y --no-install-recommends ca-certificates curl git iproute2
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL --retry 3 "https://download.docker.com/linux/$ID/gpg" -o /etc/apt/keyrings/docker.asc
    chmod 0644 /etc/apt/keyrings/docker.asc
    printf 'Types: deb\nURIs: https://download.docker.com/linux/%s\nSuites: %s\nComponents: stable\nArchitectures: %s\nSigned-By: /etc/apt/keyrings/docker.asc\n' \
      "$ID" "$VERSION_CODENAME" "$(dpkg --print-architecture)" > /etc/apt/sources.list.d/docker.sources
    chmod 0644 /etc/apt/sources.list.d/docker.sources
    apt-get update
    apt-get install -y --no-install-recommends docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    systemctl enable --now docker
  elif ((${#missing[@]})); then
    confirm "Install missing system packages: ${missing[*]}?"
    apt-get update
    apt-get install -y --no-install-recommends "${missing[@]}"
  fi
  docker compose version >/dev/null 2>&1 || fail 'Install the Docker Compose v2 plugin, then rerun. Existing Docker was left unchanged.'
  docker buildx version >/dev/null 2>&1 || fail 'Install the Docker Buildx plugin, then rerun. Existing Docker was left unchanged.'
  docker info >/dev/null 2>&1 || fail 'Docker is not reachable at /var/run/docker.sock. Start the system Docker service, then rerun.'
  local server_version
  server_version=$(docker version --format '{{.Server.Version}}')
  # Older engines can expose localhost-published ports to neighboring hosts.
  dpkg --compare-versions "$server_version" ge 28.0.0 || fail 'Docker Engine 28+ is required for safe localhost port publishing. Upgrade Docker manually, then rerun.'
  docker compose up --help | grep -- --wait-timeout >/dev/null || fail 'Upgrade Docker Compose: --wait and --wait-timeout support are required.'
}

prepare_checkout() {
  if [[ -e "$INSTALL_DIR" || -L "$INSTALL_DIR" ]]; then
    [[ -d "$INSTALL_DIR/.git" && ! -L "$INSTALL_DIR" && $(stat -c %u "$INSTALL_DIR") == 0 ]] || fail "$INSTALL_DIR already exists and is not a root-owned installer checkout. Move it aside or use the manual installation."
    [[ $(git -C "$INSTALL_DIR" remote get-url origin) == "$REPOSITORY" ]] || fail 'Existing checkout has a different origin; refusing to change it.'
    printf '\nUsing existing checkout without pulling updates or overwriting credentials.\n'
  else
    local containers volumes staging
    containers=$(docker ps -aq --filter label=com.docker.compose.project=kopes)
    volumes=$(docker volume ls -q --filter label=com.docker.compose.project=kopes)
    [[ -z "$containers" && -z "$volumes" ]] || fail 'A Compose project or saved volumes named kopes already exist. Restore/use the existing installation and .env; this installer will not replace them.'
    staging=$(mktemp -d /opt/.kopes-scanner.XXXXXX)
    if ! git clone --depth 1 --branch main "$REPOSITORY" "$staging/repo"; then
      rm -rf "$staging"
      fail 'Repository download failed; rerun the installer to retry.'
    fi
    mv "$staging/repo" "$INSTALL_DIR"
    rmdir "$staging"
  fi
  cd "$INSTALL_DIR"
}

check_ports() {
  local ports containers
  containers=$(docker compose ps -q)
  if grep -qx "COMPOSE_FILE='compose.yaml:compose.https.yaml'" .env; then
    ports=$(ss -H -ltn '( sport = :80 or sport = :443 )')
  else
    ports=$(ss -H -ltn '( sport = :3100 )')
  fi
  # On a retry, our own containers may already own the ports; Compose checks conflicts.
  if [[ -n "$ports" && -z "$containers" ]]; then
    fail 'A required port is already in use. Free ports 80/443 (automatic HTTPS) or 3100 (proxy/SSH), or edit .env to select the other Compose override. No existing service was stopped.'
  fi
}

print_commands() {
  printf '\nMaintenance (run as root, or prefix docker with sudo):\n  cd %s\n  docker compose ps\n  docker compose logs --tail=100 -f scanner\n  docker compose down  # keeps data\n  git pull --ff-only && docker compose up -d --build --wait --wait-timeout 180\n\nKeep .env and all data volumes. Never use docker compose down -v unless you intend to delete data.\n' "$INSTALL_DIR"
}

main() {
  require_host
  exec 3<>/dev/tty || fail 'An interactive terminal is required. Run this command in an SSH session.'
  umask 077
  printf '\nkopes.dev — standalone VPS installation\n\nNeeds at least 2 GiB available RAM, several GiB free disk and outbound HTTPS.\nThis scanner reads host package databases and Docker image layers, which may contain secrets.\nIt installs into /opt/kopes-scanner. It does not modify your firewall or any Coolify deployment.\n'
  confirm 'Install the scanner on this host?'
  trap 'printf "\nInstallation did not finish. Existing credentials and data were kept. Fix the error above and rerun this installer.\n" >&2' ERR
  install_dependencies
  prepare_checkout
  if [[ ! -e .env && ! -L .env ]]; then
    local volumes
    volumes=$(docker volume ls -q --filter label=com.docker.compose.project=kopes)
    [[ -z "$volumes" ]] || fail 'Saved kopes volumes exist but .env is missing. Restore .env from your backup instead of generating a new auth secret.'
    docker run --rm -it --network none --cap-drop ALL --security-opt no-new-privileges:true --read-only \
      --mount "type=bind,src=$INSTALL_DIR,dst=/repo" --workdir /repo \
      node:24.17.0-bookworm-slim node scripts/setup.mjs --vps <&3 >&3 2>&3
  else
    printf '\nKeeping existing .env unchanged.\n'
  fi
  [[ -f .env && ! -L .env ]] || fail '.env must be a regular file, not a symlink.'
  [[ $(stat -c %a .env) == 600 && $(stat -c %u .env) == 0 ]] || fail '.env must be owned by root with mode 0600. Fix its permissions and rerun.'
  grep -Fxq -e "COMPOSE_FILE='compose.yaml:compose.https.yaml'" -e "COMPOSE_FILE='compose.yaml:compose.local.yaml'" .env || fail 'Existing .env is not configured for this installer. Use manual Compose commands; credentials were not changed.'
  # Always use the saved settings, not credentials or Compose options inherited through sudo.
  unset COMPOSE_FILE COMPOSE_PROJECT_NAME BETTER_AUTH_URL BETTER_AUTH_SECRET GITHUB_CLIENT_ID GITHUB_CLIENT_SECRET GITHUB_ADMIN_USER SCAN_INTERVAL_HOURS CADDY_DOMAIN
  docker compose config --quiet
  local containers container working_dir
  containers=$(docker ps -aq --filter label=com.docker.compose.project=kopes)
  for container in $containers; do
    working_dir=$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$container")
    [[ "$working_dir" == "$INSTALL_DIR" ]] || fail 'Another installation owns the kopes Compose project. No containers were changed.'
  done
  check_ports
  printf '\nBuilding and starting the app. The first build may take several minutes.\n'
  print_commands
  if ! docker compose up -d --build --wait --wait-timeout 180; then
    docker compose ps
    fail 'Services did not become ready. Inspect docker compose logs, resolve the error and rerun. Credentials and volumes were preserved.'
  fi
  local origin
  origin=$(docker compose exec -T scanner node -p 'process.env.BETTER_AUTH_URL')
  printf '\nScanner is healthy. Browser URL: %s\n' "$origin"
  if [[ "$origin" == http://localhost:3100 ]]; then
    printf '\nFrom your computer: ssh -N -L 3100:127.0.0.1:3100 <user>@<vps-address>\nThen open http://localhost:3100 and sign in with GitHub.\n'
  else
    if grep -qx "COMPOSE_FILE='compose.yaml:compose.local.yaml'" .env; then
      printf '\nConfigure your existing HTTPS proxy to forward %s to http://127.0.0.1:3100.\n' "$origin"
    fi
    if curl --fail --silent --show-error --output /dev/null --max-time 10 --retry 5 --retry-delay 5 --retry-all-errors "$origin/healthz"; then
      printf '\nPublic HTTPS health check passed. Open %s and sign in with GitHub.\n' "$origin"
    else
      fail 'Scanner is healthy internally, but public HTTPS is not ready. Check DNS (including AAAA), TCP 80/443, and reverse-proxy logs/configuration. Rerun after fixing; no data was removed.'
    fi
  fi
}

if [[ -z ${BASH_SOURCE[0]:-} || ${BASH_SOURCE[0]} == "$0" ]]; then
  main "$@"
fi
