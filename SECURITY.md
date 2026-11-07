# Security policy

## Supported versions

Security fixes target the latest public release and the main branch.

## Reporting a vulnerability

Use GitHub's **Report a vulnerability** private security advisory flow for this repository. Do not open a public issue containing:

- an exploit or proof of concept;
- private workspace content;
- credentials, signing material or tokens;
- a path to a user's manuscript or production assets.

Include the affected version, platform, impact, reproduction and suggested mitigation. Maintainers will acknowledge the report as capacity permits. This is a volunteer open-source project; no response-time guarantee is implied.

## Threat model

IPloom Studio is a trusted-local-content application, not a sandbox for hostile manuscripts or MCP clients.

The application:

- loads only bundled renderer content;
- uses context isolation, renderer sandboxing and a restrictive CSP;
- validates IPC senders and payloads;
- denies browser permission requests;
- opens only credential-free HTTP(S) links externally;
- limits “open folder” to locations the main process created (the workspace directory and its `snapshots` directory), resolving real paths so symlinks cannot escape, and refuses application bundles such as `.app`, `.pkg` and `.bundle`;
- never derives “open folder” locations from renderer-writable export records, which a compromised renderer could otherwise turn into an arbitrary-path or app-launch primitive;
- confines MCP exports to the workspace `exports` directory plus explicit `--export-root` arguments, compared by real path;
- validates every ArcReel bundle — identifiers, timestamp, SHA-256 digest, file paths, media types, file count and total size — before the first filesystem write, and requires the package directory to sit exactly one level below the selected destination;
- checks export package paths against traversal;
- packages the app in an ASAR archive, loads the application only from that archive in packaged builds, and disables the `NODE_OPTIONS` and CLI inspect-argument escape hatches;
- keeps `RunAsNode` enabled only because the bundled MCP server is launched through the Electron binary with a fixed script path and workspace argument, and exposes no developer tools in packaged builds.

The application does not:

- encrypt `workspace.json`;
- isolate different workspaces by operating-system user;
- inspect MCP clients for malicious intent;
- protect against a compromised local account, malicious Electron binary or modified app package;
- guarantee that user-authored prose or imported data is safe for every downstream tool.

Use full-disk encryption, maintain backups, connect only trusted MCP clients and verify release checksums.

## Release integrity

The initial release is unsigned. The project publishes SHA-256 checksums, but unsigned builds cannot provide operating-system publisher authentication. Treat a checksum from the same compromised channel as insufficient evidence.

Release workflows attach Sigstore build provenance to every `.dmg`, `.zip` and `.exe`. Verify a downloaded file with the GitHub CLI:

```sh
gh attestation verify IPloom-Studio-0.3.0-darwin-universal.dmg --repo j4tmr/iploom
```

An attestation binds the file to the workflow run, repository and source commit that produced it. It does not authenticate the publisher the way platform code signing does, and it cannot help if the repository or a maintainer account is compromised.

Signing can be added without a format change. Never commit certificates or signing credentials.

## Dependency and report handling

Security fixes may update Electron, Chromium, Node or JavaScript dependencies. Maintainers should review advisories, rebuild both platforms and disclose material behavior changes in release notes.
