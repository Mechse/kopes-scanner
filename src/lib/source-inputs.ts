/** Shared by collection, the isolated worker, and result presentation. */
export function pythonDependencyInput(path: string) {
  const name = path.split('/').at(-1)!;
  return /^requirements[-_][A-Za-z0-9._-]+\.txt$/.test(name) || ['requirements.txt', 'Pipfile.lock', 'poetry.lock', 'uv.lock', 'pylock.toml'].includes(name)
    || /^pylock\.[\w-]+\.toml$/.test(name);
}
export function sourceInput(path: string) {
  return pythonDependencyInput(path) || ['package.json', 'package-lock.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'yarn.lock',
    'pyproject.toml', 'Pipfile', 'setup.py', 'setup.cfg'].includes(path.split('/').at(-1)!);
}
export function sourcePackageType(file: string) { return pythonDependencyInput(file) ? 'python-pkg' : 'npm'; }

export const pythonFilePattern = 'pip:(^|/)requirements[-_][A-Za-z0-9._-]+\\.txt$';
