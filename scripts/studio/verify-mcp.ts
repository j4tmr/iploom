import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createDemoWorkspace } from "../../apps/studio/src/core/factory.ts";
import { WorkspaceStore } from "../../apps/studio/src/node/workspace-store.ts";
import { packagedPaths } from "./packaged-paths.ts";

const binaryIndex = process.argv.indexOf("--binary");
const archIndex = process.argv.indexOf("--arch");
const arch = archIndex >= 0 ? process.argv[archIndex + 1] : undefined;
const packaged = process.argv.includes("--packaged") ? packagedPaths() : null;
if (arch !== undefined) {
  if (arch !== "x86_64" && arch !== "arm64") {
    throw new Error(`Unsupported architecture: ${arch}`);
  }
  if (!packaged) throw new Error("--arch requires --packaged");
  if (process.platform !== "darwin") {
    throw new Error("--arch is only supported on macOS");
  }
}
const binary =
  packaged?.mcpScript ??
  resolve(
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
  const electron = packaged?.executable ?? (require("electron") as string);
  const transport = new StdioClientTransport({
    command: arch ? "/usr/bin/arch" : electron,
    args: arch
      ? [`-${arch}`, electron, binary, "--workspace", workspacePath]
      : [binary, "--workspace", workspacePath],
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
    } as Record<string, string>,
    cwd: root,
    stderr: "pipe",
  });
  await client.connect(transport);
  const tools = await client.listTools();
  if (tools.tools.length !== 14)
    throw new Error(`Expected 14 MCP tools, received ${tools.tools.length}`);
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
  const workflow = await client.callTool({
    name: "list_workflow_tasks",
    arguments: {},
  });
  const workflowText = workflow.content.find(
    (item): item is { type: "text"; text: string } => item.type === "text",
  )?.text;
  const workflowBody = JSON.parse(workflowText ?? "{}") as { count?: number };
  if (workflowBody.count !== 4) {
    throw new Error(
      `Expected 4 demo workflow tasks, received ${workflowBody.count}`,
    );
  }
  const brief = await client.callTool({
    name: "get_workflow_brief",
    arguments: {
      task_id: "task_chapter_three",
      locale: "en",
    },
  });
  const briefText = brief.content.find(
    (item): item is { type: "text"; text: string } => item.type === "text",
  )?.text;
  if (!briefText?.includes("task_chapter_three")) {
    throw new Error("Bundled MCP workflow brief did not include the task");
  }
  const exported = await client.callTool({
    name: "export_arcreel_bundle",
    arguments: {
      novel_id: "work_tide_clock",
      output_dir: "exports/bundle-export",
    },
  });
  if (exported.isError) throw new Error("Bundled MCP export failed");
  console.log(
    `[mcp] bundled Electron runtime ok: ${tools.tools.length} tools, ${binary}${
      arch ? ` (${arch})` : ""
    }`,
  );
} finally {
  await client.close().catch(() => undefined);
  rmSync(root, { recursive: true, force: true });
}
