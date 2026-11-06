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
  compression: "normal",
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
