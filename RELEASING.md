# Release checklist

The 1.2.1 candidate raises the MCP SDK minimum to 1.31.0 to address
https://github.com/advisories/GHSA-6qxp-vccf-f47h.
The existing BUSL-1.1 package metadata and LICENSE are unchanged.

1. Run `npm ci --ignore-scripts`, `npm run build`, `npm test` and
   `npm audit --omit=dev`.
2. Create and inspect `npm pack --ignore-scripts`; verify dist, README and LICENSE.
3. Install the archive in a clean directory and verify its entry point.
4. Create a new immutable v1.2.1 tag only after review. Attach the archive
   and SHA-256 checksums; never replace the 1.2.0 release with new code.
5. npm publication is separate from a GitHub release. After the npm version
   exists, update server.json's package reference and README installation version.

server.json deliberately continues to advertise npm 1.2.0 until the new
version is actually published there. A passing hop-gate suite is not a full
cryptographic or production security audit.
