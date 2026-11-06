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
| `export_arcreel_bundle` | no | Write an ArcReel-style handoff package |

Tool schemas and descriptions are bilingual. Responses use stable JSON keys and include the workspace revision.

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

The server reads the workspace on every call and only writes through `export_arcreel_bundle`. It does not call a model, network service or cloud API. MCP clients can still read all text in the active workspace, so only connect clients you trust.
