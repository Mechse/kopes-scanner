import { severities, type Finding, type Report } from './model';

export type PulseKind = 'discovered' | 'fix' | 'resolved' | 'changed' | 'failure' | 'recovered' | 'coverage';
export type PulseChange = { project?: string | null; resource?: string; resourceName?: string; issue: string; kind: PulseKind; finding?: Finding; detail?: string };
export type PulseEvent = PulseChange & { seq: number; target: string; name: string; time: number };
export type PulseItem = { id: string; seq: number; time: number; events: PulseEvent[]; read: boolean; dismissed: boolean; bookmarked: boolean };
export type PulseState = { seen: number; dismissed: number; bookmarked: boolean };

// Compare advisory groups, rather than individual paths or duplicate package rows.
export function pulseChanges(previous: Report | null, current: Report): PulseChange[] {
  const group = (report: Report | null) => {
    const result = new Map<string, Finding[]>();
    for (const finding of report?.findings ?? []) result.set(finding.id, [...(result.get(finding.id) ?? []), finding]);
    return result;
  };
  const before = group(previous);
  const after = group(current);
  const changes: PulseChange[] = [];
  const signature = (findings: Finding[]) => JSON.stringify(findings.map(f => [f.package, f.type, f.installed, f.fixed, f.severity]).sort());
  const representative = (findings: Finding[]) => [...findings].sort((a, b) => severities.indexOf(a.severity) - severities.indexOf(b.severity))[0];
  for (const [issue, findings] of after) {
    const old = before.get(issue);
    const finding = { ...representative(findings), fixed: [...new Set(findings.map(f => f.fixed).filter(Boolean))].join(', ') };
    if (!old) changes.push({ issue, finding, kind: 'discovered' });
    const fixedBefore = new Set(old?.filter(f => f.fixed.trim()).map(f => JSON.stringify([f.package, f.type, f.path])));
    const newFix = findings.some(f => f.fixed.trim() && !fixedBefore.has(JSON.stringify([f.package, f.type, f.path])));
    if (newFix) changes.push({ issue, finding, kind: 'fix' });
    else if (old && signature(old) !== signature(findings)) changes.push({ issue, finding, kind: 'changed' });
  }
  for (const [issue, findings] of before) if (!after.has(issue)) changes.push({ issue, kind: 'resolved', finding: representative(findings) });
  return changes;
}

export function groupPulse(events: PulseEvent[], states: Record<string, PulseState>): PulseItem[] {
  const groups = new Map<string, PulseEvent[]>();
  // Input is newest first. Keep the latest state for each affected target.
  for (const event of [...events].sort((a, b) => b.seq - a.seq)) {
    // Pulse is globally grouped by vulnerability; project metadata stays on each resource.
    const key = event.issue;
    const group = groups.get(key) ?? [];
    if (!group.some(e => (e.resource ?? e.target) === (event.resource ?? event.target))) group.push(event);
    groups.set(key, group);
  }
  return [...groups].map(([id, events]) => {
    const seq = Math.max(...events.map(e => e.seq));
    const state = states[id];
    return { id, seq, time: Math.max(...events.map(e => e.time)), events,
      read: (state?.seen ?? 0) >= seq, dismissed: (state?.dismissed ?? 0) >= seq, bookmarked: !!state?.bookmarked };
  });
}
export const hasPulseFix = (item: PulseItem) => item.events.some(e => e.kind !== 'resolved' && !!e.finding?.fixed);
export function pulseRank(item: PulseItem) {
  const severity = Math.min(...item.events.filter(e => e.kind !== 'resolved').map(e => e.finding ? severities.indexOf(e.finding.severity) : 5), 5);
  return (item.read ? 100 : 0) + severity * 10 - (hasPulseFix(item) ? 5 : 0);
}

export type PulseBatch = { key: string; time: number; items: PulseItem[]; resource: string };
// Fold bursts only for identical affected resources, within one local day and ten minutes.
export function batchPulse(items: PulseItem[]): PulseBatch[] {
  const candidates: PulseBatch[] = [];
  const membership = new Map<string, PulseBatch>();
  for (const item of [...items].sort((a, b) => b.time - a.time)) {
    const resources = JSON.stringify([...new Set(item.events.map(e => e.resource ?? e.target))].sort());
    let batch = candidates.find(b => b.resource === resources && b.time - item.time <= 600_000 && new Date(b.time).toDateString() === new Date(item.time).toDateString());
    if (!batch) { batch = { key: item.id, time: item.time, items: [], resource: resources }; candidates.push(batch); }
    batch.items.push(item); membership.set(item.id, batch);
  }
  const emitted = new Set<PulseBatch>();
  const result: PulseBatch[] = [];
  for (const item of items) {
    const batch = membership.get(item.id)!;
    if (batch.items.length < 5) result.push({ key: item.id, time: item.time, items: [item], resource: batch.resource });
    else if (!emitted.has(batch)) {
      emitted.add(batch);
      result.push({ ...batch, items: items.filter(i => membership.get(i.id) === batch) });
    }
  }
  return result;
}
