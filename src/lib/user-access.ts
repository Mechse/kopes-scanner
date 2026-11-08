import { z } from 'zod';

export function accessIdentifier(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const input = value.trim().replace(/^@/, '').toLowerCase();
  return /^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(input) || z.email().safeParse(input).success ? input : null;
}
export type AccessPerson = {
  identifier: string; login: string | null; name: string | null; email: string | null;
  image: string | null; lastSignIn: number | null; role: 'Administrator' | 'Member';
};
export type AccessData = { people: AccessPerson[]; history: { seq: number; actor: string; action: string; identifier: string; time: number }[] };
