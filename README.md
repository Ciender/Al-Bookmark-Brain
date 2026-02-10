# AI Bookmark Brain

一款基于 WXT 的浏览器扩展，自动同步 Chrome 书签、抓取网页正文并用 AI 生成双语摘要与标签，支持全局快捷键搜索（含模糊/拼音/分类过滤）和本地 SQLite（sql.js + IndexedDB）持久化。

## 功能亮点
- **书签同步与状态**：监听 Chrome 书签事件并支持一键全量同步，记录状态/错误，自动恢复 `analyzing` 异常任务。
- **AI 摘要管线**：DeepSeek / Gemini / OpenAI 兼容适配器，按批次报警定时处理（默认每批 2 条），可在 Options 页启动/恢复；新建书签尝试自动抓取当前标签页正文并触发摘要。
- **内容抓取防护**：HTTP 优先，必要时回退到前台标签页；基于 Readability + html-to-text 提取正文，检测 Cloudflare 挑战、frameset/iframe 场景并过滤乱码。
- **搜索体验**：Ctrl+Q/Cmd+Q 呼出覆盖层，支持精准/模糊/拼音权重搜索、置顶收藏、Frecency 重排；`@分类` 过滤、下拉多选分类、`!` 前缀搜索浏览历史。
- **可视化选项页**：设置 API Key/Active Provider 并一键连通性测试；查看同步计数、启动 AI 摘要、测试搜索；拖拽调整搜索策略优先级；调整 UI 字号；导出/导入 .db；扫描并重抓乱码页面。
- **数据与备份**：SQLite 数据保存在 IndexedDB，可导出/导入合并（按 URL 去重并迁移分类/标签/摘要/历史），支持重新拉取损坏内容并记录同步日志。

## 开发与构建
1. 环境：Node 18+、npm。
2. 安装依赖：`npm install`
3. 开发调试：`npm run dev`（或 `npm run dev:firefox`），在浏览器加载 `.output/chrome-mv3` 目录为“已解压的扩展程序”。
4. 生产构建：`npm run build`（Firefox：`npm run build:firefox`）；打包 zip：`npm run zip` / `npm run zip:firefox`。
5. 类型检查：`npm run compile`。

## 首次配置
1. 打开扩展“选项”页。
2. 选择 Active Provider，填入对应的 API Key（可选自定义 OpenAI Base URL），点击 **Save Configuration**。
3. 如需验证连通性，点击 **Test Connection**（会发送简短请求到所选服务）。
4. 同步书签：点击 **Full Sync Now**（首次安装后台也会自动触发一次全量同步）。
5. 启动 AI 摘要：点击 **Start AI Summarization**。后台以 2 条/批次、基于 alarm 的方式运行，崩溃/重载后会自动恢复。

## 使用说明
- **全局搜索覆盖层**：在可注入页面按 `Ctrl+Q`（macOS `Cmd+Q`）或使用扩展命令切换。禁止注入的页面（如 `chrome://`）会被跳过。
- **查询技巧**：
  - 直接输入关键词享受精准/模糊/拼音综合权重搜索；结果列表支持方向键选中，Enter 新标签打开，Esc 关闭。
  - 输入 `@分类` 触发分类自动补全；可在左上 Filter 下拉多选分类过滤。
  - 输入 `!关键词`（或中文全角感叹号）切换“浏览历史”模式；右侧面板可一键加入书签。
- **详情面板**：右侧显示 AI 摘要（双语）、标签、元数据与快捷操作（打开/复制 URL），支持直接修改分类，展示状态/访问次数等。
- **Options 页进阶**：
  - **Search Priority**：拖拽策略列表以调整匹配字段与匹配方式的优先级，复选框控制启用状态。
  - **UI Appearance**：按需调整搜索框/结果/摘要/元数据字号，支持一键重置。
  - **Data Management**：导出当前 SQLite 为 `.db`；导入时按 URL 合并数据；“Refetch Garbled Content” 批量扫描空内容/乱码并重抓，同时跳过标记为死链的站点。

## 架构速览
- **背景页**：`src/entrypoints/background.ts` 负责快捷键命令、心跳 keep-alive、消息路由、书签监听、搜索入口、AI 摘要队列与重新抓取乱码内容。
- **数据库**：`src/lib/offscreen-handler.ts` 在 offscreen 文档中用 sql.js 运行 SQLite，表结构详见 `src/database/schema.ts`（书签/AI 摘要/标签/分类/搜索历史/同步日志/浏览历史等），数据持久化到 IndexedDB 并支持导出/增量导入。
- **同步与摘要**：`src/services/sync/bookmark-sync.service.ts` 处理书签树同步与新建书签自动摘要；`src/services/sync/summarization-queue.ts` 批处理摘要、写入标签、记录日志。
- **搜索**：`src/services/search/search-engine.ts` 组合多策略权重、Fuse 模糊、拼音匹配与 Frecency；支持 `@分类` 和 `!历史` 模式。
- **前端 UI**：内容脚本 `src/entrypoints/content.tsx` 注入 React 覆盖层；主界面在 `src/ui/search-overlay/components/SearchOverlay.tsx`，选项页为 `src/entrypoints/options.html` + `src/lib/options-handler.ts`。

## 数据与隐私
书签、抓取的正文、AI 摘要/标签、搜索与浏览历史均保存在本地 IndexedDB（通过 sql.js）；网络请求仅用于 AI 推理、页面抓取及连通性测试。API Key 存储在扩展本地存储，可随时在 Options 页更新。
