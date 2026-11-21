const messages = {
  'credentials-unavailable': 'Credentials unavailable. Check the connection settings and restore the matching BETTER_AUTH_SECRET.',
  'app-private-key': 'App private key unavailable or invalid. Replace it in GitHub connection settings.',
  'server-clock': 'Check the server clock before authenticating with GitHub.',
  'installation-token': 'Invalid or expired installation token. Check the server clock and retry the GitHub connection.',
  'repository-response': 'The provider returned incomplete repository metadata. Refresh repository access and retry.',
  'repository-identity': 'Repository identity changed or is invalid. Refresh repository access before retrying.',
  'default-branch': 'The repository has no available default branch. Push a commit and select a default branch on the provider, then retry.',
  'branch-head': 'The provider did not return an immutable commit for the default branch. Check that the branch exists and contains a commit.',
} as const;

/** Fixed diagnostics only: provider payloads and raw credential exceptions must stay private. */
export class SourceError extends Error {
  constructor(public reason: keyof typeof messages) { super(messages[reason]); }
}
export function sourceErrorMessage(error: SourceError) { return `${messages[error.reason]} [${error.reason}]`; }
