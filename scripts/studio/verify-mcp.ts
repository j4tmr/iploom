import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createDemoWorkspace } from "../../apps/studio/src/core/factory.ts";
import { WorkspaceStore } from "../../apps/studio/src/node/workspace-store.ts";

const binaryIndex = process.argv.indexOf("--binary");
const binary = resolve(
  binaryIndex >= 0
    ? (process.argv[binaryIndex + 1] ?? "")
    : "dist-studio/bin/iploom-mcp",
);
const root = mkdtempSync(join(tmpdir(), "iploom-studio-bundle-mcp-"));
const workspacePath = join(root, "workspace.json");
const client = new Client({ name: "bundle-smoke", version: "1.0.0" });

try {
  await new WorkspaceStore(workspacePath).save(
    createDemoWorkspace("en", "2026-11-06T00:00:00.000Z"),
  );
  const require = createRequire(import.meta.url);
  const electron = require("electron") as string;
  const transport = new StdioClientTransport({
    command: electron,
    args: [binary, "--workspace", workspacePath],
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
    } as Record<string, string>,
    cwd: root,
    stderr: "pipe",
  });
  await client.connect(transport);
  const tools = await client.listTools();
  if (tools.tools.length !== 8)
    throw new Error(`Expected 8 MCP tools, received ${tools.tools.length}`);
  const listed = await client.callTool({
    name: "list_novels",
    arguments: {},
  });
  const text = listed.content.find(
    (item): item is { type: "text"; text: string } => item.type === "text",
  )?.text;
  const body = JSON.parse(text ?? "{}") as { count?: number };
  if (body.count !== 2)
    throw new Error(`Expected 2 demo novels, received ${body.count}`);
  const exported = await client.callTool({
    name: "export_arcreel_bundle",
    arguments: {
      novel_id: "work_tide_clock",
      output_dir: "bundle-export",
    },
  });
  if (exported.isError) throw new Error("Bundled MCP export failed");
  console.log(
    `[mcp] bundled Electron runtime ok: ${tools.tools.length} tools, ${binary}`,
  );
} finally {
  await client.close().catch(() => undefined);
  rmSync(root, { recursive: true, force: true });
}
