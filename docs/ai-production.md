# AI production desk / AI 制作台

These features are included in the packaged desktop app. / 以下能力已包含在桌面安装包中。

## Import an existing novel / 导入已有小说

Open **Library → Import novel**. Choose TXT/Markdown or paste text. UTF-8 and BOM-marked UTF-16 files are supported. Convert Word, EPUB, PDF or legacy-encoded text to UTF-8 TXT first. Maximum: 8 MB file, 2 million characters, 1,000 chapters. Markdown `#` headings, Chinese `第一章`-style headings (including full-width digits and spaces), `序章`/`楔子`/`尾声`/`番外` and `Prologue`/`Chapter I`/`Chapter One` become chapters. Headings are normalized for display but the source text is kept verbatim; prose such as a sentence starting with 第…节课 is not treated as a heading, and a whitespace-only prefix creates no preface.

进入**小说书架 → 导入已有小说**，选择 TXT/Markdown 或粘贴文本。支持 UTF-8 与带 BOM 的 UTF-16。其他格式先导出 UTF-8 文本。导入前可检查拆章结果；Markdown `#` 标题、中文「第一章」式标题（含全角数字与空格）、序章/楔子/尾声/番外及 `Prologue`/`Chapter I`/`Chapter One` 均可识别。标题会规范化显示，但原文逐字保留；「第二节课……」这类句子不会被当作标题，纯空白前缀也不会生成前言。

Plain import is offline. Optional analysis splits at paragraph, line or sentence boundaries (never inside a surrogate pair) and sends segments to your configured model one at a time, up to 40 requests per import. A book above that limit is rejected before any request is sent; split it or import without analysis. Chapters longer than six segments produce a preflight warning, and the confirmation names the endpoint, model and request count. No automatic retry or background transmission occurs. Completed segments are kept in the review box if a later segment fails or you cancel. **Retry failed segments** resumes at the first unfinished segment without resending completed ones; **Skip failed and continue** excludes failed segments and continues with the rest. Nothing is written to the workspace until you confirm the reviewed import.

纯导入不联网。可选分析会优先在段落、行或句子边界切分（绝不拆开代理对），逐段发送给已配置模型，每次最多 40 个请求；超过上限会在发送任何请求前拒绝，请先拆分或纯导入。单章超过 6 块会预先提示；确认框显示端点、模型与请求数，服务商可能计费。后续片段失败或取消时，已完成片段会保留在审核框。**重试失败片段**从第一个未完成片段继续，不重发已完成片段；**跳过失败片段并继续**会排除失败片段并继续其余部分。只有确认审阅后的导入才会写入工作区。

Analysis proposes a world, characters, locations, factions, lore, directional relationships and scenes. Every proposal needs an exact quotation of 2–500 characters from its source segment, and prose before the JSON is tolerated. Review the editable JSON before applying; if an asset fails cross-checks (for example a relationship naming an unlisted character), the JSON stays visible with the validation message. Exact normalized names are deduplicated; aliases and ambiguous identities need author review. Each import creates a separate world and novel, preserving current work. Failures/cancellation do not apply partial assets. Chapter adaptation notes keep bounded per-segment evidence summaries under the schema limit; cast links and scenes are capped at 100 per chapter with a review notice rather than failing the whole import.

分析结果包含原文依据，必须审阅后入库。每条依据须为原文中 2–500 字符的精确引用；JSON 前的说明文字也可解析。相同规范名称会合并；别名、同名人物、关系推断需作者核对。若资产未通过交叉校验（例如关系指向未列出的人物），审核框会保留 JSON 并显示校验信息。每次导入创建独立世界与小说，失败或取消不写入部分资产。章节改编备注只保留有长度上限的分段依据摘要；每章人物关联与场景最多 100 个，超出会提示审阅，而不是让整个导入失败。

## Configure and run / 配置与执行

In desktop **Settings → Model API**, enter a Chat Completions compatible base URL (including `/v1`), model ID and API key. A full `/chat/completions` URL also works. HTTPS is required except for loopback HTTP local models. Configuration stays in main-process memory for this session only. Re-enter it after restart. Keys are never returned to the renderer or stored in workspace/export files; browser previews do not execute model requests.

在桌面版**设置 → 模型 API**填写地址、模型与密钥。配置仅在本次会话有效，重启后重新填写。本地模型可不填密钥。浏览器预览可编辑、导入，但不能调用模型。

The shared production desk is available above each view. Select world, novel, chapter and character, then choose world, chapter writing, character, costume, relationship, location, scene, storyboard or continuity-review prompts. Compose, inspect and edit the exact prompt before running. Chapter text, relevant assets and style constraints are included. Prompts over 100,000 characters require narrower scope or manual editing; they are never silently truncated.

各视图顶部的制作台可选择对象和模板。提示词包含相关设定、章节、人物与风格约束；可编辑、复制或执行。超过 10 万字符会要求缩小范围，绝不静默截断。

While running, the UI displays the task label and streamed authored output. Cancel stops the request and reports a cancellation, distinct from a timeout. A request is stopped when the provider sends no first byte within 120 seconds, or when an active stream produces no chunk for 60 seconds; every received chunk resets the idle timer, so long generations that keep producing output can finish. Incomplete, filtered or truncated responses are not marked successful. When the provider rejects a request, the error shows its sanitized explanation, a status-specific hint and, for rate limits, `Retry-After`; key-like text is redacted. The display is generated work, not a model's private reasoning. Output is saved as a workflow draft for review, never automatically replacing a chapter or approved asset.

执行时显示任务名称和实时产出，可取消；取消与超时分别报告。首个数据 120 秒未到达，或流式输出中途 60 秒没有新数据时会停止；每收到一块数据都会重置空闲计时，因此持续输出的长生成可以正常完成。不完整结果不会算成功，也不会自动覆盖原稿。服务商拒绝请求时显示清洗后的说明与针对性提示，429 还会附带 `Retry-After`；疑似密钥的内容会被隐去。没有真实提供商凭据时可使用本地模拟服务验证执行链路，不代表某个远程模型已实测兼容。

## Production workflow / 制作工作流

**Create production workflow** adds six dependent stages: world → character → costume → scene → storyboard → continuity review. Each stage can be run from the production desk's task selector. Review and mark its result **Done** in Workflow before starting its successor. Dependency results feed the next prompt. Workflows remain author-controlled; this is not unattended batch generation.

一键建立六阶段依赖任务。作者审阅并标记前置任务完成后，下一步才能执行；已完成输出进入后续提示词。章节创作、地点与关系设计也可独立执行。

Scene editing lives alongside chapter adaptation notes: locations, cast, action/evidence, shots, camera, dialogue, duration and visual/video prompt text are editable. Relationship view now displays single/bidirectional arrows and supports editing and source-note inspection.

## Handoff and compatibility / 交付与兼容

ArcReel exports include `production/approved-designs.json`, containing only completed designs scoped to the exported work/world and selected chapters, with manifest hashes. These are text production specifications and reusable prompts, not generated images/videos or automatically applied storyboard shots. Use the scene editor to apply reviewed structured shot information.

服装、布景等已完成设计作为文字规格随包导出；图片、视频与最终渲染仍由下游工具完成。未审阅设计不进入该文件。

Schema v7 is current. Workflow brief/deliverable/result text limits are 100k/100k/200k characters per language. Migration to v6 strips composed model prompts that older builds had written back into task briefs and deliverables (briefs return to their template description; deliverables return to the standard review instructions), so the composed prompt is no longer nested into itself on every run and a cancelled run no longer loses the author's brief. Migration to v7 pins an explicit prompt template on every workflow task, inferred from its title, brief and kind, so a later title edit cannot silently switch the instructions; invalid stored templates are dropped. Model runs record metadata (`lastRun`: model, prompt hash, source revision, timestamp), keep the pre-run result in `previousResult`, and flag done tasks that consume a replaced output with `resultSuperseded` until they are re-reviewed. Existing v1–v6 data remain readable through the migration chain. Older 0.3.0 builds reject the v7 workspace and results longer than their original 500-character limit; keep a workspace backup before downgrading. No database or production migration is involved.
