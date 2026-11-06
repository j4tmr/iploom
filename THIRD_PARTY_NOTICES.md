# Third-party notices

IPloom Studio is MIT-licensed software that depends on open-source packages. The release bundles portions of the following projects. Their licenses remain in effect.

## Runtime

| Project | Version | License | Project |
| --- | --- | --- | --- |
| Electron | 45.2.3 | MIT | https://github.com/electron/electron |
| Chromium | bundled with Electron | BSD-style and other licenses | https://www.chromium.org/ |
| Node.js | bundled with Electron | MIT and component licenses | https://nodejs.org/ |
| React / React DOM | 19.3.1 | MIT | https://github.com/facebook/react |
| Zod | 4.6.7 | MIT | https://github.com/colinhacks/zod |
| Model Context Protocol SDK | 2.3.1 | MIT | https://github.com/modelcontextprotocol/typescript-sdk |

Electron distributes `LICENSE` and `LICENSES.chromium.html` with the application. The installed dependency tree contains each package's authoritative license text.

## Build and test

| Project | Version | License |
| --- | --- | --- |
| Bun | 1.4.2 | MIT |
| Vite | 8.3.4 | MIT |
| esbuild | 0.28.2 | MIT |
| electron-builder | 26.18.0 | MIT |
| TypeScript | 7.0.2 | Apache-2.0 |
| React types / Node types | as locked | MIT |

## Bundled data

The demonstration worlds, characters, places, rules and chapter prose in `apps/studio/src/core/factory.ts` are synthetic content created for this project. They are distributed under the repository's MIT license.

If you distribute a modified build, preserve this notice, the MIT license and all dependency license texts required by the packages you bundle.
