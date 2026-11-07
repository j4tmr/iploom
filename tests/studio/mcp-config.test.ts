import { describe, expect, test } from "bun:test";
import { delimiter, join } from "node:path";
import {
  MCP_EXPORT_TOOL_NAMES,
  MCP_READ_TOOL_NAMES,
  MCP_STANDARD_WRITE_TOOL_NAMES,
  MCP_TOOL_COUNTS,
  MCP_TOOL_NAMES,
  mcpToolsNote,
} from "../../apps/studio/src/core/mcp-tools.ts";
import {
  createElectronMcpConfig,
  mcpClientConfigState,
  resolveBunBinary,
  resolveMcpBinary,
} from "../../apps/studio/src/node/mcp-config.ts";

function fakeFs(paths: readonly string[]) {
  const available = new Set(paths);
  return (path: string) => available.has(path);
}

const resourcesRoot = "/opt/IPloom Studio/Contents/Resources";

describe("resolveMcpBinary", () => {
  test("uses a trimmed env override before bundled locations", () => {
    const override = "/custom/iploom-mcp";
    const bundled = join(resourcesRoot, "bin", "iploom-mcp");
    expect(
      resolveMcpBinary({
        resourcesRoot,
        env: { IPLOOM_MCP_BINARY: `  ${override}  ` },
        exists: fakeFs([override, bundled]),
      }),
    ).toBe(override);
  });

  test("ignores an empty env override", () => {
    const bundled = join(resourcesRoot, "bin", "iploom-mcp");
    expect(
      resolveMcpBinary({
        resourcesRoot,
        env: { IPLOOM_MCP_BINARY: "   " },
        exists: fakeFs([bundled]),
      }),
    ).toBe(bundled);
  });

  test("prefers <root>/bin over <root>", () => {
    const bundled = join(resourcesRoot, "bin", "iploom-mcp");
    const flat = join(resourcesRoot, "iploom-mcp");
    expect(
      resolveMcpBinary({
        resourcesRoot,
        env: {},
        exists: fakeFs([bundled, flat]),
      }),
    ).toBe(bundled);
    expect(
      resolveMcpBinary({
        resourcesRoot,
        env: {},
        exists: fakeFs([flat]),
      }),
    ).toBe(flat);
  });

  test("returns null when no binary exists", () => {
    expect(
      resolveMcpBinary({
        resourcesRoot,
        env: {},
        exists: () => false,
      }),
    ).toBeNull();
  });
});

describe("resolveBunBinary", () => {
  const homeBun = join("/home/me", ".bun", "bin", "bun");

  test("probes BUN_INSTALL before everything else", () => {
    const bun = join("/custom/bun", "bin", "bun");
    expect(
      resolveBunBinary({
        env: { BUN_INSTALL: "/custom/bun", HOME: "/home/me" },
        platform: "darwin",
        pathEnv: "",
        exists: fakeFs([bun, homeBun, "/opt/homebrew/bin/bun"]),
      }),
    ).toBe(bun);
  });

  test("probes the home directory", () => {
    expect(
      resolveBunBinary({
        env: { HOME: "/home/me" },
        platform: "darwin",
        pathEnv: "",
        exists: fakeFs([homeBun]),
      }),
    ).toBe(homeBun);
  });

  test("falls back to USERPROFILE when HOME is absent", () => {
    const profileBun = join("C:\\Users\\me", ".bun", "bin", "bun.exe");
    expect(
      resolveBunBinary({
        env: { USERPROFILE: "C:\\Users\\me" },
        platform: "win32",
        pathEnv: "",
        exists: fakeFs([profileBun]),
      }),
    ).toBe(profileBun);
  });

  test("probes the well-known Homebrew locations", () => {
    expect(
      resolveBunBinary({
        env: {},
        platform: "darwin",
        pathEnv: "",
        exists: fakeFs(["/opt/homebrew/bin/bun"]),
      }),
    ).toBe("/opt/homebrew/bin/bun");
    expect(
      resolveBunBinary({
        env: {},
        platform: "darwin",
        pathEnv: "",
        exists: fakeFs(["/usr/local/bin/bun"]),
      }),
    ).toBe("/usr/local/bin/bun");
  });

  test("probes every non-empty PATH entry", () => {
    const tools = "/custom/tools";
    expect(
      resolveBunBinary({
        env: {},
        platform: "darwin",
        pathEnv: ["", "/missing", tools].join(delimiter),
        exists: fakeFs([join(tools, "bun")]),
      }),
    ).toBe(join(tools, "bun"));
  });

  test("deduplicates identical probes", () => {
    const bun = join("/opt/homebrew", "bin", "bun");
    expect(
      resolveBunBinary({
        env: { BUN_INSTALL: "/opt/homebrew" },
        platform: "darwin",
        pathEnv: "/opt/homebrew/bin",
        exists: fakeFs([bun]),
      }),
    ).toBe(bun);
  });

  test("probes bun.exe on win32 and never a bare name", () => {
    const tools = "/tools";
    expect(
      resolveBunBinary({
        env: {},
        platform: "win32",
        pathEnv: tools,
        exists: fakeFs([join(tools, "bun.exe")]),
      }),
    ).toBe(join(tools, "bun.exe"));
    expect(
      resolveBunBinary({
        env: {},
        platform: "win32",
        pathEnv: tools,
        exists: fakeFs([join(tools, "bun")]),
      }),
    ).toBeNull();
  });

  test("returns null when no bun exists", () => {
    expect(
      resolveBunBinary({
        env: {},
        platform: "darwin",
        pathEnv: "",
        exists: () => false,
      }),
    ).toBeNull();
  });
});

describe("mcpClientConfigState", () => {
  const base = {
    executable:
      "/Applications/IPloom Studio.app/Contents/MacOS/IPloom Studio",
    workspacePath:
      "/Users/me/Library/Application Support/IPloom Studio/workspace.json",
    resourcesRoot,
    sourceCandidates: ["/repo/apps/studio/mcp/server.ts"],
  };
  const bundled = join(resourcesRoot, "bin", "iploom-mcp");
  const source = base.sourceCandidates[0]!;
  const bun = join("/home/me", ".bun", "bin", "bun");

  test("uses the bundled binary through the Electron runtime", () => {
    const state = mcpClientConfigState({
      ...base,
      env: {},
      platform: "darwin",
      exists: fakeFs([bundled]),
    });
    expect(state.error).toBeNull();
    expect(state.binary).toBe(bundled);
    const server = state.config!.mcpServers["iploom-studio"];
    expect(server.command).toBe(base.executable);
    expect(server.args).toEqual([
      bundled,
      "--workspace",
      base.workspacePath,
    ]);
    expect(server.env).toEqual({ ELECTRON_RUN_AS_NODE: "1" });
  });

  test("builds a dev config from an absolute bun path and no env block", () => {
    const state = mcpClientConfigState({
      ...base,
      env: { HOME: "/home/me" },
      platform: "darwin",
      exists: fakeFs([source, bun]),
    });
    expect(state.error).toBeNull();
    expect(state.binary).toBeNull();
    const server = state.config!.mcpServers["iploom-studio"];
    expect(server.command).toBe(bun);
    expect(server.command).not.toBe("bun");
    expect(server.args).toEqual([source, "--workspace", base.workspacePath]);
    expect(server.env).toBeUndefined();
  });

  test("reports a missing Bun for a dev checkout", () => {
    const state = mcpClientConfigState({
      ...base,
      env: {},
      platform: "darwin",
      pathEnv: "",
      exists: fakeFs([source]),
    });
    expect(state.config).toBeNull();
    expect(state.binary).toBeNull();
    expect(state.error).toBe(
      "The development MCP server needs Bun, but no Bun executable was found.",
    );
  });

  test("reports a missing bundled server when nothing exists", () => {
    const state = mcpClientConfigState({
      ...base,
      env: {},
      platform: "darwin",
      exists: () => false,
    });
    expect(state.config).toBeNull();
    expect(state.binary).toBeNull();
    expect(state.error).toBe(
      "Bundled MCP server is missing from this installation.",
    );
  });

  test("prefers the bundled binary over a dev source checkout", () => {
    const state = mcpClientConfigState({
      ...base,
      env: { HOME: "/home/me" },
      platform: "darwin",
      exists: fakeFs([bundled, source, bun]),
    });
    expect(state.binary).toBe(bundled);
    const server = state.config!.mcpServers["iploom-studio"];
    expect(server.args[0]).toBe(bundled);
    expect(server.env).toEqual({ ELECTRON_RUN_AS_NODE: "1" });
  });
});

describe("createElectronMcpConfig", () => {
  test("keeps the documented client-config shape", () => {
    const mcpScript = join(resourcesRoot, "bin", "iploom-mcp");
    const workspacePath = "/Users/me/workspace.json";
    expect(
      createElectronMcpConfig({
        executable:
          "/Applications/IPloom Studio.app/Contents/MacOS/IPloom Studio",
        mcpScript,
        workspacePath,
      }),
    ).toEqual({
      mcpServers: {
        "iploom-studio": {
          command:
            "/Applications/IPloom Studio.app/Contents/MacOS/IPloom Studio",
          args: [mcpScript, "--workspace", workspacePath],
          env: { ELECTRON_RUN_AS_NODE: "1" },
        },
      },
    });
  });
});

describe("MCP tool registry", () => {
  test("partitions the registered tools by access level", () => {
    expect(MCP_TOOL_COUNTS).toEqual({
      total: 14,
      read: 11,
      write: 2,
      export: 1,
    });
    expect(MCP_TOOL_NAMES).toHaveLength(14);
    expect(MCP_READ_TOOL_NAMES).toHaveLength(11);
    expect(MCP_STANDARD_WRITE_TOOL_NAMES).toEqual([
      "create_standard",
      "update_standard",
    ]);
    expect(MCP_EXPORT_TOOL_NAMES).toEqual(["export_arcreel_bundle"]);
    expect(
      [
        ...MCP_READ_TOOL_NAMES,
        ...MCP_STANDARD_WRITE_TOOL_NAMES,
        ...MCP_EXPORT_TOOL_NAMES,
      ].sort(),
    ).toEqual([...MCP_TOOL_NAMES].sort());
  });

  test("describes the split for both interface languages", () => {
    expect(mcpToolsNote("en")).toBe(
      "11 read-only query tools + 2 foundation-standard writers + 1 local export tool.",
    );
    expect(mcpToolsNote("zh-CN")).toBe(
      "11 个只读查询工具 + 2 个基础规则写入工具 + 1 个本地导出工具。",
    );
  });
});
