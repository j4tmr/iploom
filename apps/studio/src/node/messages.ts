import type { UiLocale } from "../core/types.ts";

/**
 * Bilingual catalog for main-process user-visible error copy.
 *
 * The desktop app and the MCP server share the modules that throw these
 * messages, so localization is injected rather than hardcoded: the MCP
 * server (and every default constructor) uses `englishMainMessages`, which
 * must stay byte-identical to the pre-localization strings. `main.ts`
 * injects the locale-appropriate preset when the app starts.
 *
 * The stale-workspace IPC marker (`STALE_WORKSPACE_MARKER`) wraps whatever
 * text the store produces, so this catalog never contains the marker and
 * never needs to parse it.
 */
export interface MainMessages {
  shell: {
    failedToLoadTitle: string;
    couldNotStartTitle: string;
    onlyHttpLinks: string;
    untrustedRenderer: string;
    storeNotInitialized: string;
    handshakeActive: string;
    flushTimeout: string;
    baseRevisionFinite: string;
    flushRequestId: string;
    copyTextMustBeString: string;
    openUrlMustBeString: string;
    snapshotReasonMustBeString: string;
    snapshotPathMustBeString: string;
    unsupportedLocale: string;
  };
  ai: {
    canceled: string;
    canceledFallback: string;
    firstByteTimeout(seconds: number): string;
    idleTimeout(seconds: number): string;
    noBody: string;
    unreadableResponse: string;
    outputTooLarge: string;
    incompleteOutput(reason: string): string;
    emptyOrInterrupted: string;
    streamError(code: string, message: string): string;
    httpLabel(status: number, code: string): string;
    httpHint(status: number, retryAfterSeconds?: number): string;
    urlInvalid: string;
    endpointPolicy: string;
    genericFailure: string;
    configureBusy: string;
    runBusy: string;
    notConfigured: string;
  };
  store: {
    unsafeExportPath(value: string): string;
    missingOrInvalid(detail: string): string;
    quarantineFailed(
      backup: string,
      filePath: string,
      detail: string,
      reason: string,
    ): string;
    noIsolationName(filePath: string): string;
    unreadableOverwrite(filePath: string): string;
    noRecoveryCopyName(filePath: string): string;
    unsafeSnapshotReason(reason: string): string;
    notSnapshot(path: string): string;
    exportDirectoryEscapes: string;
    duplicateExportFile(relative: string): string;
    exportPathEscapes(relative: string): string;
    staleSameRevision(path: string, revision: number): string;
    staleBaseBehind(
      path: string,
      stored: number,
      base: number,
      incoming: number,
    ): string;
    staleOlder(path: string, stored: number, incoming: number): string;
    newerVersion(path: string, found: number, supported: number): string;
  };
  guards: {
    revealPathMustBeString: string;
    revealOutsideKnownLocations: string;
    revealBlockedBundle: string;
    revealPathDoesNotExist: string;
    revealNotFileOrDirectory: string;
    revealNotAccessible: string;
    invalidArcReelBundle(where: string): string;
    invalidArcReelBundleAt(path: string): string;
  };
  mcpConfig: {
    binaryMissing: string;
    bunMissing: string;
  };
}

/** Byte-identical to the strings these modules threw before localization. */
export const englishMainMessages: MainMessages = {
  shell: {
    failedToLoadTitle: "IPloom Studio failed to load",
    couldNotStartTitle: "IPloom Studio could not start",
    onlyHttpLinks: "Only credential-free HTTP(S) links can be opened",
    untrustedRenderer: "Rejected IPC call from an untrusted renderer",
    storeNotInitialized: "Workspace store is not initialized",
    handshakeActive: "A workspace save handshake is already active",
    flushTimeout:
      "The editor did not confirm its final save within 8 seconds. The window was kept open.",
    baseRevisionFinite: "Base revision must be a finite number",
    flushRequestId: "Flush request id must be a string",
    copyTextMustBeString: "Text must be a string",
    openUrlMustBeString: "URL must be a string",
    snapshotReasonMustBeString: "Snapshot reason must be a string",
    snapshotPathMustBeString: "Snapshot path must be a string",
    unsupportedLocale: "Unsupported locale",
  },
  ai: {
    canceled: "Model request canceled by the user; no result was applied.",
    canceledFallback: "Model request was canceled; no result was applied.",
    firstByteTimeout: (seconds) =>
      `Model sent no data for ${seconds} seconds; no result was applied. Check the endpoint and model, then retry.`,
    idleTimeout: (seconds) =>
      `Model stopped sending data for ${seconds} seconds; no result was applied. Retry, or shorten the prompt if the model is struggling with its length.`,
    noBody: "Model API returned no body.",
    unreadableResponse: "Model API returned an unreadable response.",
    outputTooLarge: "Model output exceeded 2 MB.",
    incompleteOutput: (reason) => `Incomplete model output (${reason}).`,
    emptyOrInterrupted:
      "Model output was empty or interrupted; nothing was applied.",
    streamError: (code, message) =>
      `Model API stream error${code ? ` (${code})` : ""}${message ? `: ${message}` : ""}.`,
    httpLabel: (status, code) =>
      `Model API HTTP ${status}${code ? ` (${code})` : ""}`,
    httpHint: (status, retryAfterSeconds) => {
      if (status === 400)
        return "Check the prompt length, model ID and request parameters.";
      if (status === 401)
        return "The API key was rejected; check it in Settings.";
      if (status === 403)
        return "Access was denied; check the key's model access and account permissions.";
      if (status === 404) return "Check the endpoint URL and model ID.";
      if (status === 413)
        return "The request is too large; shorten the prompt or use a model with a larger context window.";
      if (status === 429) {
        return retryAfterSeconds === undefined
          ? "Rate limit or quota reached; wait and retry."
          : `Rate limit or quota reached; retry after ${retryAfterSeconds} seconds.`;
      }
      if (status >= 500)
        return "The provider failed to handle the request; retry later.";
      return "Check endpoint, model, credentials and quota.";
    },
    urlInvalid: "Enter a valid URL such as https://host/v1.",
    endpointPolicy:
      "Use HTTPS or loopback HTTP; no URL credentials, query or fragment.",
    genericFailure: "Model request failed. Check configuration and retry.",
    configureBusy:
      "Wait for the current AI task or cancel it before changing configuration.",
    runBusy: "Another AI task is running. Wait or cancel it first.",
    notConfigured: "Configure the model API in Settings first.",
  },
  store: {
    unsafeExportPath: (value) => `Unsafe export path: ${value}`,
    missingOrInvalid: (detail) => `Workspace is missing or invalid. ${detail}`,
    quarantineFailed: (backup, filePath, detail, reason) =>
      `Recovered from ${backup}, but could not isolate the unreadable file ${filePath}: ${detail}. ${reason}`,
    noIsolationName: (filePath) =>
      `Could not find a free name to isolate ${filePath}`,
    unreadableOverwrite: (filePath) =>
      `Refusing to overwrite unreadable workspace file ${filePath}. Reload the workspace so the file can be quarantined first.`,
    noRecoveryCopyName: (filePath) =>
      `Could not find a free recovery-copy name for ${filePath}`,
    unsafeSnapshotReason: (reason) => `Unsafe snapshot reason: ${reason}`,
    notSnapshot: (path) => `Not a workspace snapshot: ${path}`,
    exportDirectoryEscapes: "Export directory escapes the selected destination",
    duplicateExportFile: (relative) => `Duplicate export file: ${relative}`,
    exportPathEscapes: (relative) => `Export path escapes package: ${relative}`,
    staleSameRevision: (path, revision) =>
      `Refusing to overwrite ${path} revision ${revision} with different ` +
      `content. Another process (for example the MCP server) changed the ` +
      `workspace. Reload the workspace to continue from the newer file; ` +
      `the file was left untouched.`,
    staleBaseBehind: (path, stored, base, incoming) =>
      `Refusing to overwrite ${path} revision ${stored} with a draft ` +
      `based on revision ${base} (incoming revision ${incoming}). ` +
      `Another process (for example the MCP server) changed the workspace. ` +
      `Reload the workspace to continue from the newer file; ` +
      `the file was left untouched.`,
    staleOlder: (path, stored, incoming) =>
      `Refusing to overwrite ${path} revision ${stored} with older ` +
      `revision ${incoming}. Another process (for example the MCP ` +
      `server) changed the workspace. Reload the workspace to continue from ` +
      `the newer file; the file was left untouched.`,
    newerVersion: (path, found, supported) =>
      `This workspace was created by a newer IPloom Studio (schema ${found}; ` +
      `this build supports ${supported}). Update the app to open ${path}. ` +
      `The file was left untouched.`,
  },
  guards: {
    revealPathMustBeString: "Folder path must be a string",
    revealOutsideKnownLocations:
      "Path is outside this workspace's known locations",
    revealBlockedBundle: "Application bundles cannot be opened",
    revealPathDoesNotExist: "Path does not exist",
    revealNotFileOrDirectory: "Path is not a file or directory",
    revealNotAccessible: "Path is not accessible",
    invalidArcReelBundle: (where) => `Invalid ArcReel bundle${where}`,
    invalidArcReelBundleAt: (path) => ` at ${path}`,
  },
  mcpConfig: {
    binaryMissing: "Bundled MCP server is missing from this installation.",
    bunMissing:
      "The development MCP server needs Bun, but no Bun executable was found.",
  },
};

export const zhMainMessages: MainMessages = {
  shell: {
    failedToLoadTitle: "IPloom Studio 加载失败",
    couldNotStartTitle: "IPloom Studio 无法启动",
    onlyHttpLinks: "只能打开不含凭据的 HTTP(S) 链接",
    untrustedRenderer: "已拒绝来自不受信任渲染进程的 IPC 调用",
    storeNotInitialized: "工作区存储尚未初始化",
    handshakeActive: "已有工作区保存握手在进行",
    flushTimeout: "编辑器未在 8 秒内确认最终保存。窗口保持打开。",
    baseRevisionFinite: "基准版本必须是有限数字",
    flushRequestId: "刷新请求 ID 必须是字符串",
    copyTextMustBeString: "文本必须是字符串",
    openUrlMustBeString: "URL 必须是字符串",
    snapshotReasonMustBeString: "快照原因必须是字符串",
    snapshotPathMustBeString: "快照路径必须是字符串",
    unsupportedLocale: "不支持的语言",
  },
  ai: {
    canceled: "模型请求已被用户取消；未应用任何结果。",
    canceledFallback: "模型请求已取消；未应用任何结果。",
    firstByteTimeout: (seconds) =>
      `模型在 ${seconds} 秒内未返回数据；未应用任何结果。请检查端点与模型后重试。`,
    idleTimeout: (seconds) =>
      `模型已停止返回数据 ${seconds} 秒；未应用任何结果。请重试，或缩短提示词长度。`,
    noBody: "模型 API 返回了空响应体。",
    unreadableResponse: "模型 API 返回了无法解析的响应。",
    outputTooLarge: "模型输出超过 2 MB。",
    incompleteOutput: (reason) => `模型输出不完整（${reason}）。`,
    emptyOrInterrupted: "模型输出为空或已中断；未应用任何结果。",
    streamError: (code, message) =>
      `模型 API 流式响应出错${code ? `（${code}）` : ""}${message ? `：${message}` : ""}。`,
    httpLabel: (status, code) =>
      `模型 API HTTP ${status}${code ? `（${code}）` : ""}`,
    httpHint: (status, retryAfterSeconds) => {
      if (status === 400) return "请检查提示词长度、模型 ID 与请求参数。";
      if (status === 401) return "API 密钥被拒绝；请在设置中检查。";
      if (status === 403)
        return "访问被拒绝；请检查密钥的模型访问权限与账户权限。";
      if (status === 404) return "请检查端点 URL 与模型 ID。";
      if (status === 413)
        return "请求过大；请缩短提示词或改用上下文窗口更大的模型。";
      if (status === 429) {
        return retryAfterSeconds === undefined
          ? "已达到速率或配额限制；请稍后重试。"
          : `已达到速率或配额限制；请在 ${retryAfterSeconds} 秒后重试。`;
      }
      if (status >= 500) return "服务提供方处理请求失败；请稍后重试。";
      return "请检查端点、模型、凭据与配额。";
    },
    urlInvalid: "请输入有效的 URL，例如 https://host/v1。",
    endpointPolicy:
      "请使用 HTTPS 或本机回环 HTTP；URL 中不能包含凭据、查询参数或片段。",
    genericFailure: "模型请求失败。请检查配置后重试。",
    configureBusy: "请等待当前 AI 任务完成或取消后再修改配置。",
    runBusy: "已有 AI 任务在运行。请等待或先取消。",
    notConfigured: "请先在设置中配置模型 API。",
  },
  store: {
    unsafeExportPath: (value) => `不安全的导出路径：${value}`,
    missingOrInvalid: (detail) => `工作区缺失或无效。${detail}`,
    quarantineFailed: (backup, filePath, detail, reason) =>
      `已从 ${backup} 恢复，但无法隔离无法读取的文件 ${filePath}：${detail}。${reason}`,
    noIsolationName: (filePath) => `找不到可用于隔离 ${filePath} 的空闲名称`,
    unreadableOverwrite: (filePath) =>
      `拒绝覆盖无法读取的工作区文件 ${filePath}。请重新载入工作区，让该文件先被隔离。`,
    noRecoveryCopyName: (filePath) =>
      `找不到可用于 ${filePath} 恢复副本的空闲名称`,
    unsafeSnapshotReason: (reason) => `不安全的快照原因：${reason}`,
    notSnapshot: (path) => `不是工作区快照：${path}`,
    exportDirectoryEscapes: "导出目录逃逸出所选目标位置",
    duplicateExportFile: (relative) => `重复的导出文件：${relative}`,
    exportPathEscapes: (relative) => `导出路径逃逸出程序包：${relative}`,
    staleSameRevision: (path, revision) =>
      `拒绝以不同内容覆盖 ${path} 的版本 ${revision}。另一个进程（例如 MCP 服务器）` +
      `修改了工作区。请重新载入工作区，从较新的文件继续；文件未被改动。`,
    staleBaseBehind: (path, stored, base, incoming) =>
      `拒绝用基于版本 ${base} 的草稿（传入版本 ${incoming}）覆盖 ${path} 的版本 ${stored}。` +
      `另一个进程（例如 MCP 服务器）修改了工作区。请重新载入工作区，从较新的文件继续；` +
      `文件未被改动。`,
    staleOlder: (path, stored, incoming) =>
      `拒绝用较旧的版本 ${incoming} 覆盖 ${path} 的版本 ${stored}。另一个进程（例如 ` +
      `MCP 服务器）修改了工作区。请重新载入工作区，从较新的文件继续；文件未被改动。`,
    newerVersion: (path, found, supported) =>
      `此工作区由较新版本的 IPloom Studio 创建（数据结构 v${found}；当前构建支持 ` +
      `v${supported}）。请升级应用后打开 ${path}。文件未被改动。`,
  },
  guards: {
    revealPathMustBeString: "文件夹路径必须是字符串",
    revealOutsideKnownLocations: "路径在工作区已知位置之外",
    revealBlockedBundle: "无法打开应用程序包",
    revealPathDoesNotExist: "路径不存在",
    revealNotFileOrDirectory: "路径不是文件或目录",
    revealNotAccessible: "路径不可访问",
    invalidArcReelBundle: (where) => `无效的 ArcReel 交付包${where}`,
    invalidArcReelBundleAt: (path) => `（位置：${path}）`,
  },
  mcpConfig: {
    binaryMissing: "此安装缺少内置的 MCP 服务器。",
    bunMissing: "开发用 MCP 服务器需要 Bun，但未找到 Bun 可执行文件。",
  },
};

export function mainMessagesFor(locale: UiLocale): MainMessages {
  return locale === "zh-CN" ? zhMainMessages : englishMainMessages;
}
