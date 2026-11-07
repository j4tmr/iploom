# Architecture

IPloom Studio is an Electron application with a React renderer, a narrow preload bridge, a local Node main process, and an optional stdio MCP surface. The design keeps story data portable and keeps the adaptation path derived rather than duplicated.

## System map

```text
React renderer
  ├─ workspace editor
  ├─ relationship graph
  ├─ AI workflow and scoped briefs
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
  ├─ eleven read-only tools
  ├─ create_standard / update_standard
  └─ export_arcreel_bundle
     (14 tools total, from core/mcp-tools.ts)
```

No renderer code receives Node.js primitives. IPC handlers validate their sender, payload shape, and file boundaries. The renderer is sandboxed with context isolation enabled and a restrictive Content Security Policy.

## Domain model

`StudioWorkspace` is the root aggregate:

- `universes`: the IP container. World rules, places, factions and lore belong to one universe.
- `characters`: belong to one or more universes. `reusable` marks cast intended for cross-world use.
- `relationships`: character edges scoped to a universe, with type, direction, strength and status.
- `works`: novels. A work references exactly one universe.
- `chapters`: ordered content inside a work, with planning notes, prose, cast, location and optional scenes.
- `workflowTasks`: hierarchical AI-authoring work items with explicit dependencies, readiness, scope references and reviewable results.
- `standards`: project foundation rules (language, format, naming, numeric, entity-prompt and continuity). Active rules are injected into production prompts and workflow briefs; each task pins the id and version it started from.
- `exports`: local history of generated handoff packages.

The schema is validated at both UI and storage boundaries. Duplicate IDs, duplicate chapter numbers, dangling universe/character/location references, task cycles and invalid task scope are rejected before data is written. Migration runs on load as a chain: v1 adds the workflow collection (v2), v2 adds story objects and timeline events (v3), and v3 adds foundation standards with empty task pins (v4). Every step bumps the revision.

## Persistence

The desktop app writes a single `workspace.json`:

1. Validate the complete workspace.
2. Serialize overlapping saves so the last accepted snapshot cannot be overtaken by an earlier write.
3. Write a temporary file with mode `0600`.
4. Copy the previous primary file to `workspace.json.bak`.
5. Atomically rename the new file into place.

The loader tries the primary file first and falls back to `.bak`. A visible banner reports recovery. When the window or application closes, the main process requests a final renderer save and waits for an explicit completion acknowledgement before closing. This protects against truncated writes, crashes and closing during the debounce window; it is not a replacement for user backups or disk encryption.

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

## AI workflow

Workflow tasks form a separate tree from the story hierarchy. A task can point at a universe, work, chapter and reusable cast, while `parentId` expresses decomposition and `dependsOnIds` expresses readiness. Dependencies are validated against cycles and missing tasks.

Each task can produce a deterministic Markdown brief. The brief includes only the selected task's scope: objective, deliverable, parent/children, dependency state, the referenced world, novel, chapter, cast, lore, places, factions and relationships. It also carries the project's stylized 3D animation boundary when adaptation work is in scope. The same generator powers the copy action in the app and the `get_workflow_brief` MCP tool.

## MCP

The MCP server is bundled by esbuild and run through the Electron executable with `ELECTRON_RUN_AS_NODE=1`. This matters on clean installs:

- a separate system Node.js is not required;
- Windows can spawn the `.exe` directly rather than failing on a `.cmd` shim;
- the server is bundled with its JavaScript dependencies.

The eleven read-only tools, including workflow listing, brief generation and foundation-standard reads, never write. `create_standard` and `update_standard` only change foundation standards inside the workspace; `export_arcreel_bundle` is the only tool that creates files and defaults to an `exports` directory beside the workspace. Its `output_dir` is confined to that directory plus any explicit `--export-root` arguments, and each bundle is fully validated before the first write.

All 14 tool names and access levels live in `apps/studio/src/core/mcp-tools.ts`; the server asserts its registration order against that list, so the settings copy, the docs and the verification script cannot drift apart. Collection responses are paged (`total`, `offset`, `count`, `next_offset`, `truncated`, `items`) under a per-response byte budget, and large prose or rule bodies are returned as reassemblable character windows. `search_ip` filters by world and kind before ranking. Invalid arguments and unknown ids return parseable `{ "error": { "code", "message", "issues?" } }` payloads rather than killing the stdio connection.

## Security boundary

Desktop policy lives in `apps/studio/src/node/desktop-guards.ts`, which imports no Electron API so the main process, the MCP server and tests all exercise the same code.

- No remote content is loaded by the renderer.
- Navigation and new-window requests are intercepted.
- Permission requests are denied.
- Only credential-free HTTP(S) links can be opened externally.
- “Open folder” reveals a file or directory only when its real path stays inside a location the main process created (the workspace directory and its `snapshots` directory), refuses application bundles, and never derives locations from renderer-writable export records.
- Export file paths are normalized and checked against directory traversal; the package directory must sit exactly one level below the selected destination.
- ArcReel bundles arriving over IPC or MCP are schema-validated in full — identifiers, timestamp, SHA-256 digest, media types, file count and total size — before any filesystem write.
- Content, credentials and generated packages are excluded from Git.

See [SECURITY.md](../SECURITY.md) for reporting.

## Coverage

`bun run test:coverage` enforces `coverageThreshold` from [bunfig.toml](../bunfig.toml) per file — bun 1.4 rejects the run when any measured file drops below the floor, even if the totals are higher. Security-relevant code stays inside that gate: the desktop guards (`apps/studio/src/node/desktop-guards.ts`), the workspace store, the AI client and the MCP server are all measured. The stdio MCP suite spawns the server as a subprocess, which coverage cannot observe, so `tests/studio/mcp-server-inline.test.ts` drives the same registered tools over an in-memory transport inside the test process. `tests/studio/mcp-paging.test.ts` builds an oversized workspace (243 chapters, 24 maximal worlds, 60 decoy lore entries, a 20,000-character standard body) to pin response budgets, page completeness, scoped search and exact prose reassembly.

Files listed in `coveragePathIgnorePatterns` are excluded because they cannot be meaningfully measured in a bun test process, not because their logic is untested:

- `apps/studio/electron/main.ts` imports `electron` at module load; the policy it applies lives in `desktop-guards.ts`, which is fully covered.
- `apps/studio/src/platform.ts` is the renderer bridge to `window.iploom`, which only exists inside Electron; unit tests mock the calls they exercise.
- `apps/studio/src/components/forms.tsx`, `manuscript-import.tsx`, `search-overlay.tsx`, `ui.tsx` and `apps/studio/src/views/workflow-view.tsx` are interaction-heavy UI surfaces covered by `studio:smoke` and manual QA; the extractable logic behind them lives in dedicated modules with their own tests.
