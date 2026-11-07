# Local MCP

IPloom Studio ships a local [Model Context Protocol](https://modelcontextprotocol.io/) server over stdio. It exposes the active workspace to compatible clients without uploading the workspace.

## Getting the configuration

1. Open IPloom Studio.
2. Select **MCP** in the top bar.
3. Choose **Copy configuration**.
4. Paste the `mcpServers` object into your client's MCP configuration.

The generated configuration points at:

- the desktop executable;
- the bundled `resources/bin/iploom-mcp` script;
- the active `workspace.json`;
- `ELECTRON_RUN_AS_NODE=1`.

Do not replace the command with `iploom-mcp` alone on macOS or Windows. A clean desktop installation does not require a global MCP binary or a system Node.js runtime.

## Tools

| Tool | Read-only | Purpose |
| --- | --- | --- |
| `list_story_worlds` | yes | List universes and compact counts |
| `get_story_world` | yes | Read world rules, cast, places, factions, lore and relationships |
| `list_novels` | yes | List novels, optionally filtered by universe |
| `get_novel` | yes | Read novel metadata, chapter plans and statistics |
| `get_chapter` | yes | Read a chapter's full prose, outline, beats and scenes |
| `search_ip` | yes | Search the bilingual IP library |
| `get_relationship_graph` | yes | Return graph nodes, edges, degrees and warnings |
| `list_workflow_tasks` | yes | List AI authoring tasks with readiness, blockers and optional world/novel/status filters |
| `get_workflow_brief` | yes | Generate a deterministic, task-scoped bilingual Markdown brief |
| `list_standards` | yes | List foundation standards with kind, status, scope and pinned task count |
| `get_standard` | yes | Read one standard, its applied scope and the tasks that pin its version |
| `create_standard` | no | Register a foundation standard as a draft (or active) with schema validation |
| `update_standard` | no | Update a standard; content changes bump its version, status-only changes do not |
| `export_arcreel_bundle` | no | Write an ArcReel-style handoff package |

Tool schemas and descriptions are bilingual. Responses use stable JSON keys and include the workspace revision. The server registers 14 tools: eleven read-only, two standard writes (`create_standard`, `update_standard`) and one export (`export_arcreel_bundle`). Those three are the only tools that can change local state; writes are serialized and re-validated against the workspace schema. Tool names and access levels come from `apps/studio/src/core/mcp-tools.ts`, the single source the server, the settings copy and the verification script all share.

### Response shape and paging

Every collection response is a page rather than a bare array:

```json
{
  "total": 243,
  "offset": 0,
  "count": 20,
  "next_offset": 20,
  "truncated": true,
  "items": []
}
```

- List tools accept `offset` and `limit` (default 20, maximum 200); `get_novel` also pages `chapters`, `get_story_world` pages each collection, `list_standards` pages `standards`.
- Each response stays under a roughly 50 KB budget; a page carries fewer items when large entries would exceed it, so `count` can be below `limit`.
- Follow `next_offset` until it is `null`; across all pages every item appears exactly once, and `total` does not change while the workspace revision does not change.
- `search_ip` applies `world_id` and `kind` before ranking, so out-of-scope hits cannot crowd real matches out of the page.
- `get_chapter` windows prose: pass `offset` and `max_chars` (default 6,000) and concatenate `content.text` until `content.next_offset` is `null` to rebuild the full chapter.
- `get_standard` windows bodies the same way with `body_offset` and `body_max_chars` (default 4,000), applied to both `body.zh` and `body.en`.

### Errors

Failures return `isError: true` with a JSON text block that clients can parse:

```json
{ "error": { "code": "invalid_arguments", "message": "...", "issues": ["query: ..."] } }
```

`issues` is present for `invalid_arguments`; unknown ids and task references return `not_found`. Both keep the connection alive so a client can correct the call without reconnecting.

### Export destination boundary

`export_arcreel_bundle` may only write below the workspace's own `exports` directory. A relative `output_dir` is resolved against the directory that holds `workspace.json`; `exports/sub`, `./exports/sub` and an absolute path inside that directory are all accepted. Absolute paths elsewhere, `..` traversal and symlinked ancestors that resolve outside the allowed roots are rejected before anything is created.

For exports that must live somewhere else, start the server with one or more `--export-root` options:

```sh
bun run studio:mcp --workspace /absolute/path/workspace.json \
  --export-root /absolute/path/other-exports
```

Each root is resolved and compared by real path, and the default workspace `exports` directory stays available. Every bundle is validated in full before the first filesystem write: identifiers, timestamp, SHA-256 digest, file paths, media types, file count and total size are checked, so a tampered `output_dir`, `manifestSha256` or timestamp cannot escape the selected destination.

## Example prompts

```text
List my story worlds, then summarize the unused reusable cast in Mist Harbor.
```

```text
Read novel work_tide_clock and identify chapters whose relationship context
does not match the world graph. Do not rewrite the prose.
```

```text
Export chapters 1 and 2 of work_tide_clock as an ArcReel bundle.
```

```text
List tasks that are ready to start, then give me the full brief for the
highest-priority 3D comic-drama adaptation task.
```

## Command-line check

On macOS:

```sh
ELECTRON_RUN_AS_NODE=1 \
  "/Applications/IPloom Studio.app/Contents/MacOS/IPloom Studio" \
  "/Applications/IPloom Studio.app/Contents/Resources/bin/iploom-mcp" \
  --workspace "$HOME/Library/Application Support/IPloom Studio/workspace.json"
```

On Windows PowerShell:

```powershell
$env:ELECTRON_RUN_AS_NODE = "1"
& "$env:LOCALAPPDATA\Programs\IPloom Studio\IPloom Studio.exe" `
  "$env:LOCALAPPDATA\Programs\IPloom Studio\resources\bin\iploom-mcp" `
  --workspace "$env:APPDATA\IPloom Studio\workspace.json"
```

The command waits for MCP messages on stdin. It is not an interactive CLI; use an MCP client to communicate with it.

## Development

```sh
bun run studio:mcp --workspace /absolute/path/workspace.json
bun run studio:build:release
bun run studio:verify-mcp
```

`studio:verify-mcp` starts the bundled server through the Electron runtime and exercises all tool registration plus a temporary export.

## Safety

The server reads the workspace on every call. It only changes local state through `create_standard`, `update_standard` and `export_arcreel_bundle`. It does not call a model, network service or cloud API. MCP clients can still read all text in the active workspace, so only connect clients you trust.

Every response that carries workspace metadata includes `workspace.recovered_from_backup`. When it is `true`, the primary `workspace.json` was unreadable and the server loaded the `.bak` copy instead; the response also carries `workspace.rejected_primary_file` and `workspace.rejected_primary_reason` naming the quarantined file. Treat such a response as recovery data rather than the newest state, and inspect the quarantined file before relying on the reported revision.
