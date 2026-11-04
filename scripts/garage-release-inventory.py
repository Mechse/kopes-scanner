"""Reproduce the v2.4.1 inventory with Cargo 1.95.0 in the official release checkout.

In the release checkout, pipe the following command into this script and redirect
its output to src/server/inventories/garage-v2.4.1-arm64.json in the scanner:

cargo tree --locked --target aarch64-unknown-linux-musl -p garage --features bundled-libs,lmdb,sqlite,fjall,k2v,consul-discovery,kubernetes-discovery,metrics,telemetry-otlp,syslog,journald --edges normal,no-proc-macro --prefix none --format '{p}'
"""
import hashlib
import json
from pathlib import Path
import sys
import tomllib

lock = Path("Cargo.lock").read_bytes()
if hashlib.sha256(lock).hexdigest() != "02ed5aba4ef8644207309f16e808abf17bcee6423efb7ae91341916e9a3598aa":
    raise SystemExit("Expected the official Garage v2.4.1 Cargo.lock")

registry = {(p["name"], p["version"]) for p in tomllib.loads(lock.decode())["package"]
            if p.get("source") == "registry+https://github.com/rust-lang/crates.io-index"}
packages = set()
for line in sys.stdin:
    name, version, *rest = line.split()
    if rest and rest[0].startswith("(") and rest[0] != "(*)":  # Local workspace crate.
        continue
    key = name, version.removeprefix("v")
    if key not in registry:
        raise ValueError(f"Unrecognized dependency {line}")
    packages.add(key)
if not packages:
    raise ValueError("Cargo returned no registry dependencies")
print("[\n" + ",\n".join("  " + json.dumps(pair) for pair in sorted(packages)) + "\n]")
