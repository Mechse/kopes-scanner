# Products comparable to Kopes

Research date: 8 November 2026. Scope: public documentation and pricing, not hands-on testing.

## Product baseline

The local README describes Kopes as a single-host, self-hosted Trivy application scanning Docker images and Linux host package inventories. It includes scheduled rescans, project/resource settings, SBOM downloads, change notifications in Pulse, remediation guidance and GitHub access management. Coolify and standalone VPS installs are documented. The application uses SQLite and a restricted Docker socket proxy. Multi-host operation and external notification channels are not part of this documented MVP. Original code is source-available under PolyForm Shield, not OSI open source. Source: [local README](../README.md).

## Landscape

The nearest alternatives are Arcane and Dockhand (Docker managers with integrated scanning) and DOCSEC (dedicated image vulnerability dashboard). PatchMon and Wazuh compete on host maintenance/security. Docker Scout and Snyk compete on image analysis and developer workflows. Dependency-Track and TrivyHub compete on reporting and ongoing monitoring; Trivy itself enables DIY substitutes.

| Product | Category | License / price | Profile |
|---|---|---|---|
| Arcane | Direct: Docker operators | Free, BSD-3-Clause open source. | [Details](arcane.md) |
| Dockhand | Direct: Docker operators | BSL 1.1 source-available. Free edition; commercial SMB $499 per Dockhand host/year; Enterprise $1,499 per Dockhand host/year. The vendor defines host as the machine running Dockhand. | [Details](dockhand.md) |
| DOCSEC | Direct: dedicated self-hosted scanner | Free, GPL-3.0 open source. | [Details](docsec.md) |
| PatchMon | Adjacent: host patch management | Free AGPL-3.0 self-hosting. Cloud Starter $1, Plus $2, Max $3 per host/month at monthly billing; no minimum host count. Docker monitoring starts at Plus; compliance at Max. | [Details](patchmon.md) |
| Docker Scout | Adjacent: image and software supply-chain security | Commercial service with free Personal allowance of 1 Scout-enabled repository. Docker Pro: $11/user/month monthly or $9 annual equivalent, 2 repositories. Team: $16 monthly or $15 annual equivalent, unlimited Scout repositories. | [Details](docker-scout.md) |
| Snyk Container | Adjacent: developer security | Commercial platform with free tier. Current pricing lists Team starting at $25/month; this is a platform starting price, not a verified all-inclusive Container deployment quote. Enterprise pricing is custom. | [Details](snyk.md) |
| Wazuh | Adjacent: host security platform | Free and open source self-hosting. Hosted pricing was not verified; pricing/product URL requests failed. | [Details](wazuh.md) |
| OWASP Dependency-Track | Adjacent: SBOM portfolio monitoring | Free and open source. | [Details](dependency-track.md) |
| TrivyHub | Adjacent: Trivy report dashboard | Public repository; an explicit license was not visible in the repository page reviewed. Open-source licensing status unverified. | [Details](trivyhub.md) |
| Trivy | DIY substitute and underlying engine | Free, Apache-2.0 open source. | [Details](trivy.md) |

## Positioning map

| Primary workflow | Products |
|---|---|
| Operate Docker and scan within the same tool | Arcane, Dockhand |
| Inspect local images through a dedicated security dashboard | DOCSEC; Kopes additionally documents host-package scanning |
| Maintain and secure host fleets | PatchMon, Wazuh |
| Secure images during development and delivery | Docker Scout, Snyk Container |
| Ingest reports or SBOMs and monitor a portfolio | TrivyHub, Dependency-Track |
| Compose your own scanning workflow | Trivy |

## Interpretation and opportunities

1. A Trivy dashboard is already a competitive category. Arcane documents exploitation signals and OS-package patching; DOCSEC closely overlaps the standalone dashboard concept. Kopes should benchmark these first.
2. The promising positioning hypothesis is a focused host-plus-container security view for Coolify/Compose operators who already have deployment management. This is not a proven exclusive capability or a validated willingness-to-pay finding.
3. Make findings useful: show the affected app/host, what changed, whether a fix exists and the next action. Consider KEV/EPSS prioritization, explicit dismissal history and external notifications. Arcane and Snyk provide relevant references.
4. Easy installation needs evidence. Kopes' README still notes pending fresh-VPS/live OAuth checks and no published release image. Benchmark time to first useful finding before claiming simplicity superiority.
5. Free bundled tools and PatchMon's $1–3/host/month cloud pricing constrain a basic scanning subscription. Potential paid value to validate includes consolidated multi-host oversight, team workflows and dependable notifications. No price recommendation is justified without customer research.

## Recommended hands-on shortlist

- Arcane: compare scan prioritization, ignored findings and image patching against a Coolify user's existing workflow.
- Dockhand: compare bundled security and update protection; evaluate commercial licensing units carefully.
- DOCSEC: compare dedicated dashboard UX, install requirements, SBOM navigation and change tracking.
- PatchMon: compare host remediation and willingness to pay for managed operation.

## Limits

Prices are published snapshots in USD unless otherwise specified, not quotations. Source-available is distinguished from open source. No benchmark, penetration test, adoption study or customer interviews were performed. Host-package scanning was not confirmed for the image-focused alternatives; lack of confirmation is not evidence of absence. SEO metrics were unavailable. Public repository availability alone does not establish a license (notably TrivyHub). Each profile links its primary sources and saved research excerpts.

