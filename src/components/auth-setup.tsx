import { useState } from 'react';

export const providerNames = { github: 'GitHub', google: 'Google', microsoft: 'Microsoft' };
export type AuthProvider = keyof typeof providerNames;
export type AuthSettings = { providers: AuthProvider[]; origin: string };

export function AuthSetup({ origin }: { origin: string }) {
  const [provider, setProvider] = useState<AuthProvider>('github');
  const prefix = provider.toUpperCase();
  const callback = `${origin}/api/auth/callback/${provider}`;
  return <section className="rounded-[10px] border border-border bg-raised p-8 mobile:p-6">
    <h1>Set up sign-in</h1>
    <p className="mt-3 text-muted-foreground">Your installation is running. Configure a sign-in provider to open your workspace. Only your administrator and people they add will have access.</p>
    <label className="mt-6 block text-sm font-medium" htmlFor="auth-provider">Sign-in provider</label>
    <select id="auth-provider" className="mt-2 w-full rounded-md border border-border bg-background p-3" value={provider} onChange={event => setProvider(event.target.value as AuthProvider)}>
      {Object.entries(providerNames).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
    </select>
    <ol className="mt-6 list-decimal space-y-4 pl-5 text-sm leading-relaxed">
      <li>{provider === 'github' ? <>Open <a className="underline" href="https://github.com/settings/developers" target="_blank" rel="noreferrer">GitHub developer settings</a> and create an OAuth App. Set its homepage URL to <code className="break-all">{origin}</code>. No repository access is needed.</>
        : provider === 'google' ? <>Open <a className="underline" href="https://console.cloud.google.com/auth/overview" target="_blank" rel="noreferrer">Google Auth Platform</a>, select or create a project, and configure Branding and Audience. Create a Web application OAuth client under Clients. While in testing, add your users as test users; publish the app when ready.</>
        : <>Open <a className="underline" href="https://entra.microsoft.com/" target="_blank" rel="noreferrer">Microsoft Entra</a> → App registrations → New registration. Select accounts in any organizational directory and personal Microsoft accounts. Add a Web redirect URI, then create a client secret under Certificates &amp; secrets. Copy the secret value, not its ID.</>}</li>
      <li>Set the {provider === 'github' ? 'authorization callback URL' : 'redirect URI'} to:<code className="mt-2 block break-all rounded bg-sunken p-3">{callback}</code></li>
      <li>Add these environment variables in your hosting dashboard or <code>.env</code>:<pre className="mt-2 overflow-x-auto rounded bg-sunken p-3 text-xs">{`${prefix}_CLIENT_ID=your-client-id\n${prefix}_CLIENT_SECRET=your-client-secret\n${provider === 'github' ? 'GITHUB_ADMIN_USER=your-github-username' : 'AUTH_ADMIN_EMAIL=you@example.com'}`}</pre>
        {provider === 'microsoft' && <><p className="mt-3">Configure an SMTP mail server to verify email ownership. Microsoft supports both personal and organization accounts; users must verify their email before their first sign-in.</p><pre className="mt-2 overflow-x-auto rounded bg-sunken p-3 text-xs">{'SMTP_URL=smtps://username:password@mail.example.com:465\nAUTH_EMAIL_FROM=security@example.com'}</pre><p className="mt-2">Use your mail service’s SMTP credentials, URL-encode special characters in them, and use a sender address approved by that service.</p></>}
      </li>
      <li>Keep <code>BETTER_AUTH_URL</code> set to <code className="break-all">{origin}</code> and preserve your <code>BETTER_AUTH_SECRET</code>. Restart or redeploy the application, then refresh this page. Your configured sign-in buttons will appear.</li>
    </ol>
    <p className="mt-5 text-xs text-muted-foreground">You can configure more than one provider. Each needs both credentials and its administrator setting; Microsoft also needs email delivery. Existing accounts stay tied to their original sign-in provider.</p>
  </section>;
}
