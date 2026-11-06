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
- limits “open folder” to known workspace/export paths;
- checks export package paths against traversal.

The application does not:

- encrypt `workspace.json`;
- isolate different workspaces by operating-system user;
- inspect MCP clients for malicious intent;
- protect against a compromised local account, malicious Electron binary or modified app package;
- guarantee that user-authored prose or imported data is safe for every downstream tool.

Use full-disk encryption, maintain backups, connect only trusted MCP clients and verify release checksums.

## Release integrity

The initial release is unsigned. The project publishes SHA-256 checksums, but unsigned builds cannot provide operating-system publisher authentication. Treat a checksum from the same compromised channel as insufficient evidence.

Signing can be added without a format change. Never commit certificates or signing credentials.

## Dependency and report handling

Security fixes may update Electron, Chromium, Node or JavaScript dependencies. Maintainers should review advisories, rebuild both platforms and disclose material behavior changes in release notes.
