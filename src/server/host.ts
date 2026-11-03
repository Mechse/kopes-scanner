import { lstat, readdir, readFile, readlink, realpath, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';

// Copy only OS package databases: never crawl host homes, secrets, volumes or application files.
const paths = ['etc/os-release', 'usr/lib/os-release', 'etc/alpine-release', 'etc/debian_version', 'etc/redhat-release',
  'var/lib/dpkg/status', 'var/lib/dpkg/status.d', 'lib/apk/db/installed', 'var/lib/rpm', 'usr/lib/sysimage/rpm'];
export async function snapshotHost(root: string, destination: string) {
  root = await realpath(root);
  const inside = (path: string) => path === root || path.startsWith(root + sep);
  let packageFiles = 0;
  async function copy(source: string, target: string, depth = 0): Promise<void> {
    if (!inside(source) || depth > 16) throw new Error('Unsafe symlink in host package database.');
    let stat;
    try { stat = await lstat(source); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    if (stat.isSymbolicLink()) {
      const link = await readlink(source);
      return copy(link.startsWith('/') ? resolve(root, '.' + link) : resolve(dirname(source), link), target, depth + 1);
    }
    if (!inside(await realpath(source))) throw new Error('Host path escapes the read-only mount.');
    if (stat.isDirectory()) {
      for (const entry of await readdir(source)) await copy(join(source, entry), join(target, entry), depth + 1);
    } else if (stat.isFile()) {
      if (stat.size > 256 * 1024 * 1024) throw new Error('Host package database exceeds the 256 MiB per-file limit.');
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, await readFile(source), { mode: 0o600 });
      if (/^(var\/lib|usr\/lib\/sysimage|lib\/apk)\//.test(relative(root, source))) packageFiles++;
    }
  }
  for (const path of paths) await copy(join(root, path), join(destination, path));
  if (!packageFiles) throw new Error('No supported host package database found. Mount a Linux host root at /host (Debian/Ubuntu, Alpine, or RPM-based).');
}
