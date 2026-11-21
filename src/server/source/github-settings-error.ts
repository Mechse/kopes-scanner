import { z } from 'zod';

const messages = {
  'canonical-origin': 'Set BETTER_AUTH_URL to the canonical HTTPS origin. Local HTTP is supported only on localhost or 127.0.0.1 with polling.',
  'webhook-origin': 'Webhooks require a public HTTPS URL. For local HTTP, select Polling only and prepare registration again.',
  'webhook-secret': 'A webhook secret is required in webhook mode. Set the same secret in GitHub and Replace credentials, or select Polling only.',
  'app-identity': 'The GitHub App ID, Client ID or owner does not match. Check the App owner and account type.',
  'app-homepage': 'Update the App homepage and callback URLs for the canonical Kopes origin.',
  'app-hook': 'Update the GitHub App webhook URL, JSON content type and TLS verification.',
} as const;

/** Only fixed, reviewed messages may reach the browser; never expose raw exception text. */
export class GithubSettingsError extends Error {
  constructor(public reason: keyof typeof messages) { super(messages[reason]); }
}

const fields: Record<string, string> = {
  owner: 'Enter the GitHub username or organization login only, without @, spaces or a URL.',
  ownerType: 'Select Personal account or Organization.',
  webhookMode: 'Select Polling only or Webhooks with polling recovery.',
  history: 'Choose whether to include pull request history.',
  label: 'Enter a connection name of 1–120 characters.',
  token: 'Enter a token without line breaks, up to 20,000 characters.',
  repository: 'Enter a GitHub repository URL or owner/repository, up to 300 characters.',
  expiresAt: 'Enter a valid expiry date or leave it blank.',
  githubId: 'Enter the numeric GitHub App ID, not its name or Client ID.',
  clientId: 'Enter the GitHub App Client ID.',
  privateKey: 'Enter a PEM private key, up to 20,000 characters.',
  clientSecret: 'Enter the client secret without line breaks.',
  webhookSecret: 'Enter the webhook secret without line breaks.',
  urlsConfirmed: 'Confirm that you checked the App owner, permissions and callback URLs.',
  appId: 'Refresh Settings and select the App again.',
  connectionId: 'Refresh Settings and select the connection again.',
};

export function githubSettingsFailure(error: unknown, stage: string) {
  let reason = 'unexpected', message = 'The operation could not complete. Retry after refreshing Settings; if it persists, report this error code.', status = 400;
  if (error instanceof GithubSettingsError) {
    reason = error.reason; message = error.message;
  } else if (stage === 'request' && error instanceof z.ZodError) {
    reason = 'invalid-input';
    message = [...new Set(error.issues.map(issue => fields[String(issue.path[0])] ?? 'Invalid settings request. Refresh Settings and try again.'))].join(' ');
  } else if (stage === 'request' && error instanceof SyntaxError) {
    reason = 'invalid-json'; message = 'Invalid settings request. Refresh Settings and try again.';
  } else if (error instanceof Response && [401,403].includes(error.status)) {
    reason = 'administrator-session'; message = 'Your administrator session is no longer valid. Sign in again and restart this setup step.'; status = error.status;
  } else {
    const e = error as {code?: unknown; errcode?: unknown; message?: unknown} | null;
    const code = typeof e?.code === 'string' ? e.code : '';
    // node:sqlite uses ERR_SQLITE_ERROR plus a numeric (possibly extended) result code.
    const sqlite = code === 'ERR_SQLITE_ERROR' && typeof e?.errcode === 'number' ? e.errcode & 255 : 0;
    if (sqlite === 8 || ['SQLITE_READONLY','EACCES','EPERM'].includes(code)) {
      reason = 'database-write'; message = 'Kopes cannot write setup state. Check database and data-volume write permissions, then retry.'; status = 500;
    } else if ([5,6].includes(sqlite) || ['SQLITE_BUSY','SQLITE_LOCKED'].includes(code)) {
      reason = 'database-busy'; message = 'The database is busy. Retry shortly and check for another process using this data volume.'; status = 503;
    } else if (sqlite === 13 || ['SQLITE_FULL','ENOSPC'].includes(code)) {
      reason = 'storage-full'; message = 'Storage is full. Free space on the data volume, then retry.'; status = 500;
    } else if ((code === 'ERR_SQLITE_ERROR' || code === 'SQLITE_ERROR') && typeof e?.message === 'string' && /no such (table|column)|has no column named/.test(e.message)) {
      reason = 'database-schema'; message = 'The GitHub setup database schema is incomplete. Rebuild/restart with the current application and the same data volume to apply migrations.'; status = 500;
    }
  }
  return {status, body:{error:`${message} [${stage}:${reason}]`,reason}};
}
