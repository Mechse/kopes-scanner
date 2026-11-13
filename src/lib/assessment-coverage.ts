import type { Report } from './model';

export type CoverageArea = { label: string; status: 'complete' | 'partial' | 'unavailable'; statusLabel?: string; detail: string };
type SourceCoverage = { nodes: unknown[]; coverage: { inputs: string; inventory: string; graph: string } };

export function repositoryCoverageAreas(analysis?: SourceCoverage): CoverageArea[] {
  return [
    { label: 'Dependencies', key: 'inventory', detail: 'Coverage of resolved dependency versions in repository metadata.' },
    { label: 'Declarations', key: 'inputs', detail: 'Verification of dependency declarations against supported dependency files.' },
    { label: 'Dependency paths', key: 'graph', detail: 'Coverage of the relationships between resolved dependencies.' },
  ].map(({ label, key, detail }) => ({ label, detail: `${detail} See Scan details for limitations.`,
    statusLabel: key === 'inputs' && analysis && analysis.coverage.inputs !== 'complete' && analysis.nodes.length ? 'Partially verified' : undefined,
    status: !analysis ? 'unavailable' : analysis.coverage[key as keyof SourceCoverage['coverage']] === 'complete' ? 'complete' : analysis.nodes.length ? 'partial' : 'unavailable',
  }));
}

export function containerCoverageAreas(report?: Report | null): CoverageArea[] {
  return [
    { label: 'Installed packages', status: !report?.packages.length ? 'unavailable' : report.coverage === 'release-source' ? 'partial' : 'complete',
      detail: report?.coverage === 'release-source' ? 'Only release-source dependencies were assessed; a full installed-image inventory is unavailable.' : 'Assessment covers detected installed packages. Undetected software is not quantified.' },
    { label: 'OS support', status: !report || report.coverage === 'release-source' || !report.os ? 'unavailable' : report.eol ? 'partial' : 'complete',
      detail: !report || report.coverage === 'release-source' || !report.os ? 'OS vulnerability support could not be established from this scan.' : report.eol ? 'The OS is end-of-life; vulnerability coverage may be incomplete.' : `The detected OS (${report.os}) is not reported as end-of-life.` },
  ];
}
