# AI production desk / AI 制作台

These features are on the development branch after 0.3.0, not in the already-published 0.3.0 installer. / 以下能力晚于 0.3.0，已发布的 0.3.0 安装包不包含。

## Import an existing novel / 导入已有小说

Open **Library → Import novel**. Choose TXT/Markdown or paste text. UTF-8 and BOM-marked UTF-16 files are supported. Convert Word, EPUB, PDF or legacy-encoded text to UTF-8 TXT first. Maximum: 8 MB file, 2 million characters, 1,000 chapters. Headings in Chinese, English or Markdown become chapters; prefaces and headings remain in the chapter contents, preserving the source text.

进入**小说书架 → 导入已有小说**，选择 TXT/Markdown 或粘贴文本。支持 UTF-8 与带 BOM 的 UTF-16。其他格式先导出 UTF-8 文本。导入前可检查拆章结果；无章节标题时保留为单章。

Plain import is offline. Optional analysis sends 8,000-character segments to your configured model, one at a time, up to 40 requests per import. Larger books may be imported without analysis or split beforehand. The confirmation names the endpoint, model and request count. No automatic retry or background transmission occurs.

纯导入不联网。可选分析每段最多 8,000 字符，每次导入最多 40 个请求；超长小说可先纯导入或拆分。确认框显示端点、模型与请求数，服务商可能计费。

Analysis proposes a world, characters, locations, factions, lore, directional relationships and scenes. Every proposal needs an exact quotation from its source segment. Review the editable JSON before applying. Exact normalized names are deduplicated; aliases and ambiguous identities need author review. Each import creates a separate world and novel, preserving current work. Failures/cancellation do not apply partial assets. Evidence is retained in chapter adaptation notes and relevant assets.

分析结果包含原文依据，必须审阅后入库。相同规范名称会合并；别名、同名人物、关系推断需作者核对。每次导入创建独立世界与小说，失败或取消不写入部分资产。

## Configure and run / 配置与执行

In desktop **Settings → Model API**, enter a Chat Completions compatible base URL (including `/v1`), model ID and API key. A full `/chat/completions` URL also works. HTTPS is required except for loopback HTTP local models. Configuration stays in main-process memory for this session only. Re-enter it after restart. Keys are never returned to the renderer or stored in workspace/export files; browser previews do not execute model requests.

在桌面版**设置 → 模型 API**填写地址、模型与密钥。配置仅在本次会话有效，重启后重新填写。本地模型可不填密钥。浏览器预览可编辑、导入，但不能调用模型。

The shared production desk is available above each view. Select world, novel, chapter and character, then choose world, chapter writing, character, costume, relationship, location, scene, storyboard or continuity-review prompts. Compose, inspect and edit the exact prompt before running. Chapter text, relevant assets and style constraints are included. Prompts over 100,000 characters require narrower scope or manual editing; they are never silently truncated.

各视图顶部的制作台可选择对象和模板。提示词包含相关设定、章节、人物与风格约束；可编辑、复制或执行。超过 10 万字符会要求缩小范围，绝不静默截断。

While running, the UI displays the task label and streamed authored output. Cancel stops the request; 180 seconds times out. Incomplete, filtered or truncated responses are not marked successful. The display is generated work, not a model's private reasoning. Output is saved as a workflow draft for review, never automatically replacing a chapter or approved asset.

执行时显示任务名称和实时产出，可取消；单次请求 180 秒超时。不完整结果不会算成功，也不会自动覆盖原稿。没有真实提供商凭据时可使用本地模拟服务验证执行链路，不代表某个远程模型已实测兼容。

## Production workflow / 制作工作流

**Create production workflow** adds six dependent stages: world → character → costume → scene → storyboard → continuity review. Each stage can be run from the production desk's task selector. Review and mark its result **Done** in Workflow before starting its successor. Dependency results feed the next prompt. Workflows remain author-controlled; this is not unattended batch generation.

一键建立六阶段依赖任务。作者审阅并标记前置任务完成后，下一步才能执行；已完成输出进入后续提示词。章节创作、地点与关系设计也可独立执行。

Scene editing lives alongside chapter adaptation notes: locations, cast, action/evidence, shots, camera, dialogue, duration and visual/video prompt text are editable. Relationship view now displays single/bidirectional arrows and supports editing and source-note inspection.

## Handoff and compatibility / 交付与兼容

ArcReel exports include `production/approved-designs.json`, containing only completed designs scoped to the exported work/world and selected chapters, with manifest hashes. These are text production specifications and reusable prompts, not generated images/videos or automatically applied storyboard shots. Use the scene editor to apply reviewed structured shot information.

服装、布景等已完成设计作为文字规格随包导出；图片、视频与最终渲染仍由下游工具完成。未审阅设计不进入该文件。

Schema v6 is current. Workflow brief/deliverable/result text limits are 100k/100k/200k characters per language. Migration to v6 strips composed model prompts that older builds had written back into task briefs and deliverables (briefs return to their template description; deliverables return to the standard review instructions), so the composed prompt is no longer nested into itself on every run and a cancelled run no longer loses the author's brief. Model runs record metadata (`lastRun`: model, prompt hash, source revision, timestamp), keep the pre-run result in `previousResult`, and flag done tasks that consume a replaced output with `resultSuperseded` until they are re-reviewed. Existing v1–v5 data remain readable through the migration chain. Older 0.3.0 builds reject results longer than their original 500-character limit; keep a workspace backup before downgrading. No database or production migration is involved.
