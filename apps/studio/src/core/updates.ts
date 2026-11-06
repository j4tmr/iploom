export const RELEASE_REPOSITORY = "j4tmr/iploom";
export const RELEASE_TAG_PREFIX = "studio-v";
export const RELEASES_PAGE_URL = `https://github.com/${RELEASE_REPOSITORY}/releases`;
export const RELEASES_API_URL = `https://api.github.com/repos/${RELEASE_REPOSITORY}/releases?per_page=20`;

export interface Semver {
  major: number;
  minor: number;
  patch: number;
}

export interface ReleaseAsset {
  name: string;
  url: string;
}

export interface GithubRelease {
  tag: string;
  notesUrl: string;
  publishedAt: string;
  assets: ReleaseAsset[];
}

export interface ReleaseSummary {
  version: string;
  tag: string;
  notesUrl: string;
  publishedAt: string;
}

export type UpdateDownloadKind = "dmg" | "zip" | "exe";

export interface UpdateDownload {
  name: string;
  url: string;
  kind: UpdateDownloadKind;
}

export type UpdateCheckFailureReason =
  | "timeout"
  | "network"
  | "http"
  | "response"
  | "version"
  | "desktop-only";

export interface UpdateCheckResult {
  status: "update-available" | "up-to-date" | "unavailable";
  currentVersion: string;
  checkedAt: string;
  latest?: ReleaseSummary;
  download?: UpdateDownload;
  recent: ReleaseSummary[];
  reason?: UpdateCheckFailureReason;
  httpStatus?: number;
}

const SEMVER_PATTERN = /^(\d{1,9})\.(\d{1,9})\.(\d{1,9})$/;

export function parseSemver(value: string): Semver | null {
  const match = SEMVER_PATTERN.exec(value.trim());
  if (!match) return null;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (![major, minor, patch].every(Number.isSafeInteger)) return null;
  return { major, minor, patch };
}

export function parseReleaseTag(tag: string): Semver | null {
  if (!tag.startsWith(RELEASE_TAG_PREFIX)) return null;
  return parseSemver(tag.slice(RELEASE_TAG_PREFIX.length));
}

export function compareSemver(a: Semver, b: Semver): number {
  if (a.major !== b.major) return a.major > b.major ? 1 : -1;
  if (a.minor !== b.minor) return a.minor > b.minor ? 1 : -1;
  if (a.patch !== b.patch) return a.patch > b.patch ? 1 : -1;
  return 0;
}

export function formatSemver(value: Semver): string {
  return `${value.major}.${value.minor}.${value.patch}`;
}

export function isAllowedReleaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === "github.com" &&
      url.port === "" &&
      !url.username &&
      !url.password &&
      url.pathname.startsWith(`/${RELEASE_REPOSITORY}/releases/`)
    );
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function parseGithubReleases(payload: unknown): GithubRelease[] {
  if (!Array.isArray(payload)) return [];
  const releases: GithubRelease[] = [];
  for (const item of payload) {
    if (!isRecord(item)) continue;
    if (item.draft === true || item.prerelease === true) continue;
    const tag = typeof item.tag_name === "string" ? item.tag_name : "";
    const notesUrl = typeof item.html_url === "string" ? item.html_url : "";
    if (!parseReleaseTag(tag) || !isAllowedReleaseUrl(notesUrl)) continue;
    const rawAssets = Array.isArray(item.assets) ? item.assets : [];
    const assets: ReleaseAsset[] = [];
    for (const rawAsset of rawAssets) {
      if (!isRecord(rawAsset)) continue;
      const name = typeof rawAsset.name === "string" ? rawAsset.name : "";
      const url =
        typeof rawAsset.browser_download_url === "string"
          ? rawAsset.browser_download_url
          : "";
      if (!name || !isAllowedReleaseUrl(url)) continue;
      assets.push({ name, url });
    }
    const publishedAt =
      typeof item.published_at === "string" &&
      !Number.isNaN(Date.parse(item.published_at))
        ? item.published_at
        : "";
    releases.push({ tag, notesUrl, publishedAt, assets });
  }
  return releases;
}

/** Returns null when the API response is not a release list at all. */
export function parseReleasePayload(payload: unknown): GithubRelease[] | null {
  return Array.isArray(payload) ? parseGithubReleases(payload) : null;
}

const PLATFORM_EXTENSIONS: Record<string, readonly UpdateDownloadKind[]> = {
  darwin: ["dmg", "zip"],
  win32: ["exe"],
};

export function platformDownload(
  release: GithubRelease,
  platform: string,
): UpdateDownload | undefined {
  const kinds = PLATFORM_EXTENSIONS[platform] ?? [];
  for (const kind of kinds) {
    const asset = release.assets.find((item) =>
      item.name.toLocaleLowerCase().endsWith(`.${kind}`),
    );
    if (asset) return { name: asset.name, url: asset.url, kind };
  }
  return undefined;
}

function summarize(
  release: GithubRelease,
  version: Semver,
): ReleaseSummary {
  return {
    version: formatSemver(version),
    tag: release.tag,
    notesUrl: release.notesUrl,
    publishedAt: release.publishedAt,
  };
}

export function buildUpdateCheck(
  releases: GithubRelease[],
  currentVersion: string,
  platform: string,
  checkedAt: string,
): UpdateCheckResult {
  const current = parseSemver(currentVersion);
  const stable = releases
    .map((release) => ({ release, version: parseReleaseTag(release.tag) }))
    .filter(
      (entry): entry is { release: GithubRelease; version: Semver } =>
        entry.version !== null,
    )
    .sort((a, b) => compareSemver(b.version, a.version));
  const recent = stable.slice(0, 5).map((entry) => summarize(entry.release, entry.version));

  if (!current) {
    return {
      status: "unavailable",
      currentVersion,
      checkedAt,
      recent,
      reason: "version",
    };
  }

  const newest = stable[0];
  if (!newest) {
    return {
      status: "up-to-date",
      currentVersion,
      checkedAt,
      recent,
    };
  }

  const latest = summarize(newest.release, newest.version);
  const newer = compareSemver(newest.version, current) > 0;
  return {
    status: newer ? "update-available" : "up-to-date",
    currentVersion,
    checkedAt,
    latest,
    download: newer ? platformDownload(newest.release, platform) : undefined,
    recent,
  };
}

export function unavailableUpdateCheck(
  currentVersion: string,
  checkedAt: string,
  reason: UpdateCheckFailureReason,
  httpStatus?: number,
): UpdateCheckResult {
  return {
    status: "unavailable",
    currentVersion,
    checkedAt,
    recent: [],
    reason,
    ...(httpStatus === undefined ? {} : { httpStatus }),
  };
}
