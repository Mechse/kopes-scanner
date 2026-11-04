import crates from './inventories/garage-v2.4.1-arm64.json';
import { garageRelease } from '../lib/model';

// Docker engines identify this release by its index, selected manifest, or image config.
const imageDigests = new Set([
  'sha256:9c96caa2612d3411acc5b0e6701fb238dbfba33e533a6d7d3d811a4b12d0d020',
  'sha256:2749e37137dae41459f49955e8082951f4a1ebea4e25d153182039f20a4b5974',
  'sha256:2711bbf081dc60294f03331f5c8d2268cba6cd018d38a36a68bab0a493ea848d',
]);

export function garageSourceInventory(id: string, platform: string) {
  if (!imageDigests.has(id) || !['linux/arm64', 'linux/arm64/v8'].includes(platform)) return null;
  return JSON.stringify({
    bomFormat: 'CycloneDX', specVersion: '1.6', version: 1,
    metadata: {
      component: { type: 'application', name: 'Garage ARM64 release · source-derived Rust inventory', version: '2.4.1' },
      properties: [
        { name: 'kopes:coverage', value: 'Normal crates.io dependencies resolved from the release source' },
        { name: 'kopes:source-commit', value: garageRelease.commit },
        { name: 'kopes:release-executable-sha256', value: garageRelease.binarySha256 },
        { name: 'kopes:target', value: 'aarch64-unknown-linux-musl' },
      ],
    },
    components: crates.map(([name, version]) => {
      const purl = `pkg:cargo/${name}@${encodeURIComponent(version)}`;
      return { type: 'library', name, version, purl, 'bom-ref': purl };
    }),
  });
}
