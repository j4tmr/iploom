# Releasing

## Version source

`package.json.version` is the single application version. The UI, MCP server and handoff manifest read it through `apps/studio/src/core/version.ts`.

Before a release:

1. Update `package.json.version`.
2. Update the release notes under `docs/release-notes/`.
3. Run `bun install` if dependencies changed.
4. Run the complete checks.
5. Commit and merge through a pull request.
6. Create `studio-v<version>` on the merged commit.

The release workflow rejects a tag that does not exactly match `studio-v${package.version}`.

## Local preflight

```sh
bun install --frozen-lockfile
bun run check
bun run studio:smoke
bun run studio:package
bun run studio:smoke:package
shasum -a 256 release/IPloom-Studio-* > /tmp/iploom-sha256.txt
```

On Windows use `Get-FileHash -Algorithm SHA256`.

## GitHub Actions

`.github/workflows/studio-ci.yml` runs on pull requests and main:

- type checking;
- domain and real stdio MCP tests;
- release-input build;
- bundled MCP through the Electron runtime;
- macOS and Windows packaging;
- packaged application smoke;
- artifact presence checks.

`.github/workflows/studio-release.yml` runs on `studio-v*` tags:

- validates tag/version identity;
- repeats the checks;
- builds macOS universal DMG/ZIP and Windows NSIS;
- starts each packaged executable in smoke mode;
- uploads checksums;
- creates the public GitHub Release.

## Signing

The current workflow supports unsigned artifacts and labels them explicitly. It does not pretend that an unsigned build passes Gatekeeper or SmartScreen.

To add signing later:

- macOS: provide a Developer ID Application certificate through GitHub secrets, enable hardened runtime and notarization, then add `codesign --verify`, `spctl --assess` and `xcrun stapler validate`.
- Windows: provide an Authenticode code-signing certificate and verify the signature with `Get-AuthenticodeSignature`.

Never commit certificates, passwords, API tokens or provisioning profiles.

## Verification after publishing

Use the GitHub API rather than the web UI for a reproducible receipt:

```sh
gh release view studio-v0.3.0 --json tagName,isDraft,isPrerelease,assets,body
gh release download studio-v0.3.0 --pattern SHA256SUMS.txt
```

Download at least one asset per platform, recompute its SHA-256, and compare it with the release checksum file. A tag, a green build or an uploaded artifact alone does not prove the downloaded file is intact.
