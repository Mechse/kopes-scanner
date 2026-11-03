# Bundled scanner

This application invokes the unmodified Trivy executable, version 0.76.1,
from the `aquasec/trivy:0.76.1` container image.

- Project: https://github.com/aquasecurity/trivy
- Copyright: Aqua Security Software Ltd. and Trivy contributors
- License: Apache License 2.0, reproduced in `licenses/Trivy-LICENSE.txt`
- Source for the bundled version: https://github.com/aquasecurity/trivy/tree/v0.76.1

Trivy downloads vulnerability and language databases on demand. No database is
pre-bundled in this image. Those databases aggregate third-party advisories;
their respective licenses, attribution requirements and service limits still
apply. This application is not affiliated with or endorsed by Aqua Security.

The runtime also includes Node.js and npm packages under their respective
licenses. Before publishing a commercial image, generate and review its complete
third-party license/SBOM inventory, including transitive Go and npm dependencies,
and the terms for any vulnerability data you redistribute. This notice is not
a complete distribution-license audit.
