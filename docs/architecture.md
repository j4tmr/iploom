# Architecture

IPloom Studio is an Electron application with a React renderer, a narrow preload bridge, a local Node main process, and an optional stdio MCP surface. The design keeps story data portable and keeps the adaptation path derived rather than duplicated.

## System map

```text
React renderer
  ├─ workspace editor
  ├─ relationship graph
  ├─ manuscript editor
  ├─ export preview
  └─ MCP configuration
        │
        ▼ contextBridge / typed IPC
Electron main process
  ├─ atomic workspace store
  ├─ native folder picker
  ├─ ArcReel package writer
  └─ MCP configuration
        │
        ▼ stdio
Bundled MCP server
  ├─ seven read-only tools
  └─ export_arcreel_bundle
```

No renderer code receives Node.js primitives. IPC handlers validate their sender, payload shape, and file boundaries. The renderer is sandboxed with context isolation enabled and a restrictive Content Security Policy.

## Domain model

`StudioWorkspace` is the root aggregate:

- `universes`: the IP container. World rules, places, factions and lore belong to one universe.
- `characters`: belong to one or more universes. `reusable` marks cast intended for cross-world use.
- `relationships`: character edges scoped to a universe, with type, direction, strength and status.
- `works`: novels. A work references exactly one universe.
- `chapters`: ordered content inside a work, with planning notes, prose, cast, location and optional scenes.
- `exports`: local history of generated handoff packages.

The schema is validated at both UI and storage boundaries. Duplicate IDs, duplicate chapter numbers and dangling universe/character/location references are rejected before data is written.

## Persistence

The desktop app writes a single `workspace.json`:

1. Validate the complete workspace.
2. Serialize overlapping saves so the last accepted snapshot cannot be overtaken by an earlier write.
3. Write a temporary file with mode `0600`.
4. Copy the previous primary file to `workspace.json.bak`.
5. Atomically rename the new file into place.

The loader tries the primary file first and falls back to `.bak`. A visible banner reports recovery. This protects against truncated writes and crashes; it is not a replacement for user backups or disk encryption.

Browser preview mode uses `localStorage` and is intended only for UI development.

## ArcReel handoff

The export path takes an immutable workspace revision and produces:

```text
<novel>-<timestamp>-<hash>-arcreel/
  manifest.json
  world.json
  production-structure.json
  episodes/*.json
  storyboards/*.storyboard.json
  handoff.md
```

The package is assembled as a set of in-memory files, validated, then written into a staging directory and atomically renamed. A second export never overwrites an existing package directory.

`storyboards/*.storyboard.json` is validated against the included contract-4 subset before writing. Scene and shot sequences are generated from array position instead of parsed from user-editable IDs. This keeps exported identifiers stable even when a scene has a nonnumeric ID.

See [ArcReel handoff](arcreel-handoff.md) for the exact boundary.

## MCP

The MCP server is bundled by esbuild and run through the Electron executable with `ELECTRON_RUN_AS_NODE=1`. This matters on clean installs:

- a separate system Node.js is not required;
- Windows can spawn the `.exe` directly rather than failing on a `.cmd` shim;
- the server is bundled with its JavaScript dependencies.

The seven query tools never write. `export_arcreel_bundle` is the only tool that creates files and defaults to an `exports` directory beside the workspace.

## Security boundary

- No remote content is loaded by the renderer.
- Navigation and new-window requests are intercepted.
- Permission requests are denied.
- Only credential-free HTTP(S) links can be opened externally.
- “Open folder” is limited to workspace/export paths remembered by the main process.
- Export file paths are normalized and checked against directory traversal.
- Content, credentials and generated packages are excluded from Git.

See [SECURITY.md](../SECURITY.md) for reporting.
