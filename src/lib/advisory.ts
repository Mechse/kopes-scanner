export const isCve = (id: string) => /^CVE-\d{4}-\d{4,19}$/.test(id);
export function safeUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2048) return false;
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password; }
  catch { return false; }
}
export type Advisory = {
  status: 'available' | 'unavailable' | 'not-found' | 'rejected';
  source: string; fetchedAt: number; publisher?: string; description?: string;
  published?: string; modified?: string; vector?: string; weaknesses: string[];
  solutions: string[]; workarounds: string[]; references: string[];
};
export function explainVector(vector?: string): string[] {
  if (!vector?.startsWith('CVSS:3.')) return [];
  const values = Object.fromEntries(vector.split('/').slice(1).map(part => part.split(':')));
  const explanations: Record<string, Record<string, string>> = {
    AV: { N: 'An attack can originate over a network.', A: 'An attacker needs access to an adjacent network.', L: 'An attacker needs local access.', P: 'An attacker needs physical access.' },
    AC: { L: 'The attack does not require special conditions beyond the other requirements listed.', H: 'Successful exploitation depends on additional conditions outside the attacker’s control.' },
    PR: { N: 'No prior account privileges are required.', L: 'Some account privileges are required.', H: 'High privileges are required.' },
    UI: { N: 'No user interaction is required.', R: 'A user must take an action for an attack to succeed.' },
    C: { H: 'Sensitive information could be extensively exposed.', L: 'Some information could be exposed.' },
    I: { H: 'Data or system behavior could be extensively altered.', L: 'Some data could be altered.' },
    A: { H: 'The affected service could become unavailable.', L: 'Service availability could be reduced.' },
  };
  return Object.entries(explanations).flatMap(([key, options]) => options[values[key]] ? [options[values[key]]] : []);
}
