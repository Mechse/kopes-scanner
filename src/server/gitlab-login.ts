import type { BetterAuthPlugin } from 'better-auth';
import type { Config } from './config';
import type { Store } from './store';
import { authorize, callbacks, claim, connection, exchange, gitlabApp, hash } from './source/gitlab';
import { providerReader, sourcePolicy } from './source/provider';

export function verifiedProfile(store: Store, config: Config, origin: string, raw: any) {
  if (
    raw?.email_verified !== true ||
    typeof raw.email !== 'string' ||
    !/^[^\s@]+@[^\s@]+$/.test(raw.email) ||
    typeof raw.sub !== 'string' ||
    !raw.sub ||
    (raw.iss !== undefined && raw.iss !== origin)
  )
    throw new Error('GitLab must confirm a verified email address.');
  const email = raw.email.toLowerCase(),
    subject = JSON.stringify([origin, raw.sub]),
    accessId = 'gitlab:' + subject;
  const bound = store.db.prepare('SELECT accessLogin FROM user WHERE accessId=?').get(accessId);
  if (bound && bound.accessLogin !== email)
    throw new Error('GitLab verified email changed. Contact your Kopes administrator.');
  if (
    email !== config.adminEmail &&
    !store.db
      .prepare('SELECT 1 FROM allowed_users WHERE login=? AND (github_id IS NULL OR github_id=?)')
      .get(email, accessId)
  )
    throw new Error('GitLab email is not invited.');
  return {
    user: { email, emailVerified: true, name: email, accessLogin: email, accessId },
    data: { subject },
  };
}
export function gitlabLogin(
  store: Store,
  config: Config,
  read = providerReader(sourcePolicy()),
): BetterAuthPlugin[] {
  const app = gitlabApp(store);
  if (!app?.login) return [];
  const redirect = callbacks(config.origin).login;
  return [
    {
      id: 'kopes-gitlab',
      init(ctx) {
        return {
          context: {
            socialProviders: [
              ...ctx.socialProviders,
              {
                id: 'gitlab',
                name: 'GitLab',
                issuer: app.origin,
                accountSubject: ({ profile }: { profile: object }) =>
                  (profile as { subject: string }).subject,
                createAuthorizationURL({ state, codeVerifier }: { state: string; codeVerifier: string }) {
                  store.db.prepare('DELETE FROM gitlab_attempts WHERE expires<=?').run(Date.now());
                  store.db
                    .prepare('INSERT INTO gitlab_attempts VALUES (?,?,?,?,?,?)')
                    .run(hash(codeVerifier), app.revision, 'login', '', '', Date.now() + 600000);
                  return authorize(app, redirect, 'openid email', state, hash('gitlab:' + codeVerifier));
                },
                async validateAuthorizationCode({
                  code,
                  codeVerifier,
                }: {
                  code: string;
                  codeVerifier?: string;
                }) {
                  if (!codeVerifier || gitlabApp(store)?.revision !== app.revision) return null;
                  claim(store, app, codeVerifier, 'login', '');
                  const result = await exchange(
                    app,
                    config.secret,
                    {
                      grant_type: 'authorization_code',
                      code,
                      redirect_uri: redirect,
                      code_verifier: hash('gitlab:' + codeVerifier),
                    },
                    'openid email',
                    read,
                  );
                  // Consume only the protected UserInfo response, never claims from the returned ID token.
                  const profile = await read(connection(app.origin, result.access_token), '/oauth/userinfo');
                  if (gitlabApp(store)?.revision !== app.revision) return null;
                  // Better Auth persists standard token fields only. Do not retain an identity token or bearer.
                  return {
                    accessToken: undefined,
                    gitlabProfile: verifiedProfile(store, config, app.origin, profile),
                  };
                },
                async getUserInfo(tokens: object) {
                  return (
                    (tokens as { gitlabProfile?: ReturnType<typeof verifiedProfile> }).gitlabProfile ?? null
                  );
                },
              },
            ],
          },
        };
      },
    },
  ];
}
