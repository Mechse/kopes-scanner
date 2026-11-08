import type { Container, Finding, Target } from './model';
export type FixStep = { title: string; detail: string; command?: string };
const quote = (value: string) => `'${value.replace(/'/g, `'"'"'`)}'`;
const packageName = /^[a-zA-Z0-9@][a-zA-Z0-9@/._+:-]*$/;
export function remediation(f: Finding, kind: Target['kind'], container?: Container, locked = false): FixStep[] {
  const steps: FixStep[] = [];
  const name = packageName.test(f.package) ? quote(f.package) : undefined;
  if (!f.fixed.trim()) return [{ title: 'Check the maintainer’s guidance', detail: 'The scan reports no patched version for this package. Review the documented workarounds below and confirm that they apply to your version and configuration.' },
    { title: 'Assess exposure while waiting for a patch', detail: 'Compare the attack conditions with how this resource is used. If the affected feature is reachable, consider restricting access or disabling that feature after checking the advisory. These are exposure-reduction options, not a verified fix.' },
    { title: 'Monitor and rescan', detail: 'Follow the linked vendor advisory for a release. Scan again after updating; an unchanged finding means remediation still needs review.' }];
  if (kind === 'image') {
    steps.push({ title: 'Update the image or its build', detail: `Choose a maintainer release containing a fixed version of ${f.package}. If you build this image, update its base image or dependency manifest and rebuild. The package fixed version is not a container image tag.${locked ? ' This finding comes from release source metadata; verify the rebuilt executable’s dependency versions.' : ''}` });
    if (container?.manager === 'Compose' && /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(container.service)) {
      steps.push({ title: 'Redeploy the updated service', detail: `After testing and updating the image reference in the Compose file, run this from the directory for project ${container.project}. For a locally built service, rebuild it first.`, command: `docker compose pull ${quote(container.service)}\ndocker compose up -d --no-deps ${quote(container.service)}` });
    } else steps.push({ title: 'Redeploy through your container manager', detail: `Update the image reference in ${container?.manager ?? 'your deployment configuration'} and recreate the affected container with its existing volumes, network and environment settings. Test compatibility before rollout.` });
  } else {
    const commands: Record<string, string> = {
      debian: `sudo apt-get update\nsudo apt-get install --only-upgrade -- ${name}`,
      ubuntu: `sudo apt-get update\nsudo apt-get install --only-upgrade -- ${name}`,
      alpine: `sudo apk update\nsudo apk upgrade -- ${name}`,
      redhat: `sudo dnf upgrade -- ${name}`, rocky: `sudo dnf upgrade -- ${name}`, alma: `sudo dnf upgrade -- ${name}`, fedora: `sudo dnf upgrade -- ${name}`,
    };
    steps.push({ title: 'Upgrade the affected package', detail: `Use your operating system’s supported repositories. Confirm that the available version includes the reported fix (${f.fixed}); this command installs the repository candidate, which may not yet contain it.`, command: name ? commands[f.type] : undefined });
    steps.push({ title: 'Restart affected workloads', detail: 'Restart services using the updated library. Follow the vendor’s reboot instructions for kernel or core system updates.' });
  }
  if (['gobinary', 'gomod'].includes(f.type) && f.package === 'stdlib') {
    steps.splice(1, 0, { title: 'Rebuild with a patched Go toolchain', detail: `The affected code is part of Go’s standard library in ${f.path || 'the scanned executable'}. Select a patched Go release for your supported branch, update the build toolchain, and rebuild the executable and container image. Updating go.mod dependencies alone does not replace the embedded standard library. Check the build environment with:`, command: 'go version' });
  } else if (name && ['npm', 'node-pkg', 'pip', 'python-pkg', 'cargo', 'rust', 'gobinary', 'gomod'].includes(f.type)) {
    const inspection: Record<string, string> = { npm: `npm explain ${name}`, 'node-pkg': `npm explain ${name}`, pip: `python -m pip show ${name}`, 'python-pkg': `python -m pip show ${name}`, cargo: `cargo tree --invert ${name}`, rust: `cargo tree --invert ${name}`, gomod: 'go mod graph', gobinary: 'go mod graph' };
    steps.splice(1, 0, { title: 'Trace the dependency in the source project', detail: 'Run this in the matching source checkout and package environment. Update the direct dependency in the manifest, or upgrade the parent that brings it in. Regenerate the lockfile, test, then rebuild the application. Choose the fixed version for your release branch; do not edit a deployed container’s lockfile.', command: inspection[f.type] });
  }
  steps.push({ title: 'Verify with a new scan', detail: 'After deployment, open the updated resource in Projects and scan it. Check that this advisory/package pair is gone and review new findings. A replacement image appears as a new scan target.' });
  return steps;
}
