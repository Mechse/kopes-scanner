export function remediationGuidance(manager: string, dependency: string | undefined, affected: string, fixed: string, direct: boolean) {
  const safe = (value: string | undefined) => value && !value.startsWith('-') && /^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(value) ? value : undefined;
  const name = safe(dependency), packageName = safe(affected);
  const inspect = manager === 'pnpm' ? `pnpm why ${packageName ?? '<package>'}` : manager === 'npm' ? `npm explain ${packageName ?? '<package>'}` : 'Inspect the dependency tree with your package manager.';
  return {
    summary: !name ? 'The editable dependency is unknown because no complete introduction path was established.'
      : !fixed ? `No fixed version is reported. Review upstream guidance for ${name}, or consider removing the dependency if it is not needed.`
      : direct ? `Review a patched release of ${name} and its compatibility with your application.`
      : `Review an upgrade of ${name}, which introduces the vulnerable package. A compatible parent release has not been verified.`,
    fixed: fixed || 'No fixed version reported', compatibleParent: 'Unverified',
    commands: [inspect, ...(name && fixed ? [manager === 'pnpm' ? `pnpm update ${name}` : `npm update ${name}`] : [])],
    checklist: ['Review the release and dependency constraints.', 'Regenerate the lockfile with the project’s package manager; review the diff.', 'Run your application tests and commit the change.', 'Merge and deploy through your normal workflow.', 'Scan the current immutable runtime image; source results do not prove runtime remediation.'],
    note: 'These are reviewable instructions, never commands executed by Kopes. Updating within current ranges may not select a patched release. No force update or override is recommended.',
  };
}

/** A local workspace link changes the editable manifest; package edges retain each introducing parent. */
export function editableDependencies(
  graph: {nodes:{id:string;name:string}[];roots:{id:string;manifest:string}[]}, paths: string[][],
) {
  const targets=new Map<string,{manifest:string;dependency:string;direct:boolean}>();
  for(const path of paths){
    let rootIndex=-1;
    path.forEach((id,index)=>{if(graph.roots.some(r=>r.id===id))rootIndex=index;});
    const root=graph.roots.find(r=>r.id===path[rootIndex]),dependency=graph.nodes.find(n=>n.id===path[rootIndex+1]);
    if(!root||!dependency)continue;
    const target={manifest:root.manifest,dependency:dependency.name,direct:rootIndex+2===path.length};
    targets.set(JSON.stringify([target.manifest,target.dependency]),target);
  }
  return [...targets.values()];
}
