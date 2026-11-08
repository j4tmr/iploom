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
- validates the IPC sender against the trusted renderer URL, and validates model configuration, model requests and ArcReel bundles with strict schemas at the IPC boundary; `iploom:save` forwards the workspace to the main-process store, which validates the complete workspace — schema and referential checks — before writing, rather than duplicating that schema at IPC;
- denies browser permission requests;
- opens only credential-free HTTP(S) links externally;
- limits “open folder” to locations the main process created (the workspace directory and its `snapshots` directory), resolving real paths so symlinks cannot escape, and refuses application bundles such as `.app`, `.pkg` and `.bundle`;
- never derives “open folder” locations from renderer-writable export records, which a compromised renderer could otherwise turn into an arbitrary-path or app-launch primitive;
- confines MCP exports to the workspace `exports` directory plus explicit `--export-root` arguments, compared by real path;
- validates the complete ArcReel bundle schema — identifiers, timestamp, SHA-256 digest, media types, file count and total size — before the first filesystem write; normalizes each file path and checks it for traversal and destination escape while writing into a temporary staging directory, and renames the package into place only after every file is written; requires the package directory to sit exactly one level below the selected destination;
- packages the app in an ASAR archive, loads the application only from that archive in packaged builds, and disables the `NODE_OPTIONS` and CLI inspect-argument escape hatches;
- keeps `RunAsNode` enabled only because the bundled MCP server is launched through the Electron binary with a fixed script path and workspace argument, and exposes no developer tools in packaged builds.

### Model API

Model features are opt-in and user-triggered. The application contacts the configured Chat Completions endpoint only when the author runs a production task or confirms manuscript analysis. It never calls the endpoint on launch, load, save, import without analysis or export, and it does not retry a failed request automatically (the sole exception is one resend without `stream_options` after a 400/422 that names that parameter). Requests originate in the main process; browser previews cannot send them.

What is sent is the composed prompt. Depending on the task, it can include chapter prose (including imported prose), world rules and asset records, relationships, locations, factions, lore, timeline context, foundation standards, results of dependency tasks marked done, and the task's instructions and scope. The production desk shows the exact prompt and lets the author edit it before sending; manuscript analysis sends bounded source segments together with its extraction instructions. Before sending, the production desk asks for confirmation naming the endpoint and model and warning that provider charges may apply. The import confirmation names the endpoint, model and request count, caps an import at 40 analysis requests, and writes nothing to the workspace until the reviewed result is confirmed.

The API key is held in a main-process module variable for the current application session only. It is never written to `workspace.json`, export packages or any other file, and it is never returned to the renderer: the configuration IPC returns only the endpoint, model and a configured flag. Restarting the application clears the key. The `Authorization` header is built in the main process.

The endpoint must use HTTPS, except for plain HTTP on `localhost`, `127.0.0.1` or `[::1]` for a local model. URLs containing credentials, a query string or a fragment are rejected. Requests use `redirect: "error"`, so an HTTP redirect cannot forward the prompt or bearer token to another origin. Requests go directly from the local main process to the configured endpoint; the endpoint operator receives the text under its own retention, logging and training policy, which IPloom neither controls nor can enforce. Review the provider's terms, and use a local model when the manuscript must not leave the machine.

### Imported and third-party text

Imported manuscripts, lore, names and notes are untrusted input even when the author chose the file. The application includes imported text verbatim in model prompts, and exposes full chapter prose, lore and asset text to MCP clients. Text that contains instructions aimed at a model — “ignore previous instructions”, hidden markup, fabricated system messages — is therefore a prompt-injection surface for both the model client and any MCP agent reading the workspace. Delimiting source text and instructing the model to treat it as data reduces this risk but does not remove it, and upstream model output remains a proposal until the author reviews it. Do not treat imported content, generated drafts or MCP tool output as trusted instructions; review imported analysis and production drafts before applying them, and connect only MCP clients you trust.

The application does not:

- encrypt `workspace.json`;
- isolate different workspaces by operating-system user;
- inspect MCP clients for malicious intent;
- protect against a compromised local account, malicious Electron binary or modified app package;
- control the retention, logging or training policy of the configured model endpoint;
- guarantee that user-authored prose or imported data is safe — or free of prompt-injection instructions — for every model endpoint, MCP client or downstream tool.

Use full-disk encryption, maintain backups, connect only trusted MCP clients and verify release checksums.

## Release integrity

The initial release is unsigned. The project publishes SHA-256 checksums, but unsigned builds cannot provide operating-system publisher authentication. Treat a checksum from the same compromised channel as insufficient evidence.

Release workflows attach Sigstore build provenance to every `.dmg`, `.zip` and `.exe`. Verify a downloaded file with the GitHub CLI:

```sh
gh attestation verify IPloom-Studio-0.4.0-darwin-universal.dmg --repo j4tmr/iploom
```

An attestation binds the file to the workflow run, repository and source commit that produced it. It does not authenticate the publisher the way platform code signing does, and it cannot help if the repository or a maintainer account is compromised.

Signing can be added without a format change. Never commit certificates or signing credentials.

## Dependency and report handling

Security fixes may update Electron, Chromium, Node or JavaScript dependencies. Maintainers should review advisories, rebuild both platforms and disclose material behavior changes in release notes.
