import type { McpClientConfig } from "../platform.ts";

export interface ElectronMcpConfigInput {
  executable: string;
  mcpScript: string;
  workspacePath: string;
}

export function createElectronMcpConfig(
  input: ElectronMcpConfigInput,
): McpClientConfig {
  return {
    mcpServers: {
      "iploom-studio": {
        command: input.executable,
        args: [input.mcpScript, "--workspace", input.workspacePath],
        env: {
          ELECTRON_RUN_AS_NODE: "1",
        },
      },
    },
  };
}
