export type StartupStage = 'configuration' | 'database' | 'filesystem' | 'authentication' | 'source-recovery';

/** Only fixed diagnostics leave startup: never log raw errors, paths, URLs or credential data. */
export class StartupFailure extends Error {
  constructor(public stage: StartupStage, public reason: string) {
    super(`Application startup failed [${stage}]: ${reason}`);
  }
}
export function startupFailure(stage: StartupStage, error: unknown): StartupFailure {
  if (error instanceof StartupFailure) return error;
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
  const message = error instanceof Error ? error.message : '';
  let reason = 'Initialization failed. Check the deployment configuration and restart.';
  if (['EACCES','EPERM','SQLITE_READONLY','SQLITE_CANTOPEN'].includes(String(code))) reason = 'Database or filesystem access was denied. Check volume ownership and write permissions.';
  else if (code === 'ENOSPC' || code === 'SQLITE_FULL') reason = 'Storage is full. Free disk space before restarting.';
  else if (code === 'SQLITE_BUSY') reason = 'The database is busy. Check for another process using the same data volume.';
  else if (/no such (column|table):/.test(message)) reason = 'The database schema is incomplete. Apply the latest migration and restart.';
  else if (message === 'Database is newer than this application. Refusing to downgrade.') reason = 'The database requires a newer application version. Do not reset the data volume.';
  else if (stage === 'configuration') {
    const missing = /^Set (BETTER_AUTH_URL|BETTER_AUTH_SECRET) in your deployment environment/.exec(message);
    reason = missing ? `Set ${missing[1]} in the deployment environment.` : 'Check the canonical URL, deployment secret and enabled integration settings.';
  } else if (stage === 'authentication') reason = 'Sign-in initialization failed. Verify database access and the original BETTER_AUTH_SECRET.';
  return new StartupFailure(stage,reason);
}
