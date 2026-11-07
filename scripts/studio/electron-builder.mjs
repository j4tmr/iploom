import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../..");
const packageMetadata = JSON.parse(
  readFileSync(join(repositoryRoot, "package.json"), "utf8"),
);
const electronVersion =
  packageMetadata.devDependencies?.electron ??
  packageMetadata.dependencies?.electron;

if (!electronVersion) {
  throw new Error("The root package must declare the Electron version");
}

const hasMcpBinary = existsSync(
  join(repositoryRoot, "dist-studio", "bin", "iploom-mcp"),
);
const legalResources = ["LICENSE", "THIRD_PARTY_NOTICES.md"]
  .filter((file) => existsSync(join(repositoryRoot, file)))
  .map((file) => ({
    from: file,
    to: file,
  }));

export default {
  appId: "com.j4tmr.iploom.studio",
  productName: "IPloom Studio",
  copyright: "Copyright © 2026 j4tmr",
  electronVersion,
  npmRebuild: false,
  nodeGypRebuild: false,
  directories: {
    app: "dist-studio/app",
    output: "release",
    buildResources: "apps/studio/build",
  },
  files: [
    "package.json",
    "electron/**/*",
    "renderer/**/*",
    "!node_modules/**/*",
    "!**/node_modules/**/*",
  ],
  asar: true,
  // The packaged MCP server runs through the app binary with
  // ELECTRON_RUN_AS_NODE=1, so RunAsNode has to stay enabled. Every other
  // runtime escape hatch is off. ASAR integrity validation stays off until the
  // app is code signed.
  //
  // grantFileProtocolExtraPrivileges stays at Electron's default (enabled).
  // With it disabled, the packaged app's first file:// load of
  // app.asar/renderer/index.html fails with ERR_FILE_NOT_FOUND on Electron 45
  // (the retry succeeds, so the smoke exit on did-fail-load made it look like a
  // crash). Reproduced with a minimal asar app: every launch failed with the
  // fuse off and none failed with it on. Electron Forge tracks the same failure
  // mode (electron/forge#3508). Revisit if Electron fixes it or if the renderer
  // moves to a custom protocol.
  electronFuses: {
    runAsNode: true,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    enableEmbeddedAsarIntegrityValidation: false,
    onlyLoadAppFromAsar: true,
    grantFileProtocolExtraPrivileges: true,
    // Flipping the fuses rewrites the unsigned app binary and invalidates the
    // ad-hoc signature Electron ships with. macOS refuses to launch that on
    // Apple Silicon (it is killed with "Code Signature Invalid"), so re-sign
    // ad-hoc right after the flip. A real Developer ID signature can replace
    // this later without changing the fuses themselves.
    resetAdHocDarwinSignature: true,
  },
  compression: "normal",
  // biome-ignore lint/suspicious/noTemplateCurlyInString: electron-builder expands these macros at build time
  artifactName: "IPloom-Studio-${version}-${platform}-${arch}.${ext}",
  extraResources: hasMcpBinary
    ? [
        {
          from: "dist-studio/bin",
          to: "bin",
          filter: ["iploom-mcp", "iploom-mcp.*", "package.json"],
        },
        ...legalResources,
      ]
    : legalResources,
  mac: {
    target: [
      { target: "dmg", arch: ["universal"] },
      { target: "zip", arch: ["universal"] },
    ],
    category: "public.app-category.productivity",
    darkModeSupport: true,
    icon: "icon.icns",
    identity: null,
  },
  dmg: {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: electron-builder expands this macro at build time
    title: "IPloom Studio ${version}",
  },
  win: {
    target: [{ target: "nsis", arch: ["x64"] }],
    icon: "icon.ico",
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: "IPloom Studio",
    uninstallDisplayName: "IPloom Studio",
  },
  publish: null,
};
