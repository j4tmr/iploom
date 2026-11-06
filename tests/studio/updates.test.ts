import { describe, expect, test } from "bun:test";
import {
  buildUpdateCheck,
  compareSemver,
  isAllowedReleaseUrl,
  parseGithubReleases,
  parseReleaseTag,
  parseSemver,
  platformDownload,
  unavailableUpdateCheck,
} from "../../apps/studio/src/core/updates.ts";

const CHECKED_AT = "2026-11-06T08:00:00.000Z";

function release(
  tag: string,
  assets: Array<{ name: string; url?: string }> = [],
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    tag_name: tag,
    html_url: `https://github.com/j4tmr/iploom/releases/tag/${tag}`,
    published_at: "2026-11-01T00:00:00Z",
    draft: false,
    prerelease: false,
    assets: assets.map((asset) => ({
      name: asset.name,
      browser_download_url:
        asset.url ??
        `https://github.com/j4tmr/iploom/releases/download/${tag}/${asset.name}`,
    })),
    ...extra,
  };
}

describe("update check", () => {
  test("parses strict semver and studio release tags", () => {
    expect(parseSemver("0.3.0")).toEqual({ major: 0, minor: 3, patch: 0 });
    expect(parseSemver(" 12.4.9 ")).toEqual({ major: 12, minor: 4, patch: 9 });
    expect(parseSemver("1.2")).toBeNull();
    expect(parseSemver("1.2.3.4")).toBeNull();
    expect(parseSemver("1.2.3-beta.1")).toBeNull();
    expect(parseSemver("v1.2.3")).toBeNull();

    expect(parseReleaseTag("studio-v0.4.0")).toEqual({
      major: 0,
      minor: 4,
      patch: 0,
    });
    expect(parseReleaseTag("studio-v0.4.0-rc.1")).toBeNull();
    expect(parseReleaseTag("v0.4.0")).toBeNull();
    expect(parseReleaseTag("studio-v0.4")).toBeNull();
  });

  test("compares versions numerically instead of lexically", () => {
    const older = parseSemver("0.9.9")!;
    const newer = parseSemver("0.10.0")!;
    expect(compareSemver(older, newer)).toBe(-1);
    expect(compareSemver(newer, older)).toBe(1);
    expect(compareSemver(newer, parseSemver("0.10.0")!)).toBe(0);
    expect(
      compareSemver(parseSemver("1.0.0")!, parseSemver("0.99.99")!),
    ).toBe(1);
  });

  test("allows only credential-free HTTPS release URLs in this repository", () => {
    expect(
      isAllowedReleaseUrl(
        "https://github.com/j4tmr/iploom/releases/tag/studio-v0.4.0",
      ),
    ).toBe(true);
    expect(
      isAllowedReleaseUrl(
        "https://github.com/j4tmr/iploom/releases/download/studio-v0.4.0/IPloom-Studio-0.4.0-darwin-universal.dmg",
      ),
    ).toBe(true);
    expect(
      isAllowedReleaseUrl("http://github.com/j4tmr/iploom/releases/tag/x"),
    ).toBe(false);
    expect(
      isAllowedReleaseUrl("https://evil.example/j4tmr/iploom/releases/tag/x"),
    ).toBe(false);
    expect(
      isAllowedReleaseUrl("https://github.com/j4tmr/iploom2/releases/tag/x"),
    ).toBe(false);
    expect(
      isAllowedReleaseUrl(
        "https://token@github.com/j4tmr/iploom/releases/tag/x",
      ),
    ).toBe(false);
    expect(
      isAllowedReleaseUrl("https://github.com/j4tmr/iploom/issues/1"),
    ).toBe(false);
    expect(isAllowedReleaseUrl("not a url")).toBe(false);
  });

  test("drops drafts, prereleases, foreign tags and untrusted assets", () => {
    const payload = [
      release("studio-v0.4.0", [
        { name: "IPloom-Studio-0.4.0-darwin-universal.dmg" },
        { name: "IPloom-Studio-0.4.0-win32-x64.exe" },
        {
          name: "IPloom-Studio-0.4.0-linux.AppImage",
          url: "https://evil.example/IPloom-Studio-0.4.0-linux.AppImage",
        },
      ]),
      release("studio-v0.5.0", [], { prerelease: true }),
      release("studio-v0.6.0", [], { draft: true }),
      release("studio-v0.7.0-beta.1"),
      release("v0.8.0"),
      { tag_name: "studio-v0.9.0", html_url: "https://evil.example/release" },
      "not an object",
    ];

    const parsed = parseGithubReleases(payload);
    expect(parsed.map((item) => item.tag)).toEqual(["studio-v0.4.0"]);
    expect(parsed[0]!.assets.map((asset) => asset.name)).toEqual([
      "IPloom-Studio-0.4.0-darwin-universal.dmg",
      "IPloom-Studio-0.4.0-win32-x64.exe",
    ]);
  });

  test("returns an empty list for malformed payloads", () => {
    expect(parseGithubReleases(null)).toEqual([]);
    expect(parseGithubReleases({})).toEqual([]);
    expect(parseGithubReleases([null, 42])).toEqual([]);
  });

  test("selects the newest stable release and maps platform downloads", () => {
    const releases = parseGithubReleases([
      release("studio-v0.3.0", [
        { name: "IPloom-Studio-0.3.0-darwin-universal.dmg" },
      ]),
      release("studio-v0.4.0", [
        { name: "IPloom-Studio-0.4.0-win32-x64.exe" },
        { name: "IPloom-Studio-0.4.0-darwin-universal.zip" },
        { name: "IPloom-Studio-0.4.0-darwin-universal.dmg" },
      ]),
      release("studio-v0.10.0", [
        { name: "IPloom-Studio-0.10.0-win32-x64.exe" },
        { name: "IPloom-Studio-0.10.0-darwin-universal.dmg" },
      ]),
      release("studio-v0.9.0"),
    ]);

    const result = buildUpdateCheck(releases, "0.4.0", "darwin", CHECKED_AT);
    expect(result.status).toBe("update-available");
    expect(result.latest?.version).toBe("0.10.0");
    expect(result.download).toEqual({
      kind: "dmg",
      name: "IPloom-Studio-0.10.0-darwin-universal.dmg",
      url: "https://github.com/j4tmr/iploom/releases/download/studio-v0.10.0/IPloom-Studio-0.10.0-darwin-universal.dmg",
    });
    expect(result.recent.map((item) => item.version)).toEqual([
      "0.10.0",
      "0.9.0",
      "0.4.0",
      "0.3.0",
    ]);

    const windows = buildUpdateCheck(releases, "0.4.0", "win32", CHECKED_AT);
    expect(windows.download?.kind).toBe("exe");

    const linux = buildUpdateCheck(releases, "0.4.0", "linux", CHECKED_AT);
    expect(linux.status).toBe("update-available");
    expect(linux.download).toBeUndefined();
  });

  test("falls back to the zip when no dmg asset exists", () => {
    const releases = parseGithubReleases([
      release("studio-v0.4.0", [
        { name: "IPloom-Studio-0.4.0-darwin-universal.zip" },
      ]),
    ]);
    const result = buildUpdateCheck(releases, "0.3.0", "darwin", CHECKED_AT);
    expect(result.download?.kind).toBe("zip");
  });

  test("reports up-to-date without offering a download", () => {
    const releases = parseGithubReleases([
      release("studio-v0.3.0", [
        { name: "IPloom-Studio-0.3.0-darwin-universal.dmg" },
      ]),
    ]);
    const result = buildUpdateCheck(releases, "0.3.0", "darwin", CHECKED_AT);
    expect(result.status).toBe("up-to-date");
    expect(result.latest?.version).toBe("0.3.0");
    expect(result.download).toBeUndefined();
  });

  test("reports up-to-date with no latest release when none is stable", () => {
    const result = buildUpdateCheck([], "0.3.0", "darwin", CHECKED_AT);
    expect(result.status).toBe("up-to-date");
    expect(result.latest).toBeUndefined();
    expect(result.recent).toEqual([]);
    expect(result.currentVersion).toBe("0.3.0");
  });

  test("treats a newer local build as up-to-date and caps recent releases", () => {
    const releases = parseGithubReleases(
      [
        "studio-v0.9.0",
        "studio-v0.8.0",
        "studio-v0.7.0",
        "studio-v0.6.0",
        "studio-v0.5.0",
        "studio-v0.4.0",
        "studio-v0.3.0",
      ].map((tag) => release(tag)),
    );
    const result = buildUpdateCheck(releases, "1.0.0", "darwin", CHECKED_AT);
    expect(result.status).toBe("up-to-date");
    expect(result.recent).toHaveLength(5);
    expect(result.recent[0]!.version).toBe("0.9.0");
    expect(result.recent[4]!.version).toBe("0.5.0");
  });

  test("fails closed on an unparsable current version", () => {
    const releases = parseGithubReleases([release("studio-v0.4.0")]);
    const result = buildUpdateCheck(releases, "dev", "darwin", CHECKED_AT);
    expect(result.status).toBe("unavailable");
    expect(result.reason).toBe("version");
    expect(result.download).toBeUndefined();
  });

  test("keeps platform mapping out of untrusted assets", () => {
    const parsed = parseGithubReleases([
      release("studio-v0.4.0", [
        {
          name: "IPloom-Studio-0.4.0-darwin-universal.dmg",
          url: "https://evil.example/download.dmg",
        },
      ]),
    ]);
    expect(parsed[0]!.assets).toEqual([]);
    expect(platformDownload(parsed[0]!, "darwin")).toBeUndefined();
  });

  test("builds a structured unavailable result", () => {
    expect(unavailableUpdateCheck("0.3.0", CHECKED_AT, "timeout")).toEqual({
      status: "unavailable",
      currentVersion: "0.3.0",
      checkedAt: CHECKED_AT,
      recent: [],
      reason: "timeout",
    });
    expect(
      unavailableUpdateCheck("0.3.0", CHECKED_AT, "http", 503),
    ).toMatchObject({ reason: "http", httpStatus: 503 });
  });
});
