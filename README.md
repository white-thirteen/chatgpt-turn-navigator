# ChatGPT 轮次导航 v0.1.1

v0.1.1 支持新版 `data-content-search-unit-key` 消息和 App-Shell 页面结构；跳过隐藏的旧 main；识别新输入框与时间线滚动容器；提供 Alt+Shift+N 本地诊断面板。

浏览器用户脚本：在 ChatGPT 对话右侧显示轮次导航轨，支持悬停查看提问与回答摘要、点击跳转、当前位置高亮、键盘导航和长轨道内部滚动。零运行时依赖。

**适用范围：ChatGPT 浏览器网页版。不是 ChatGPT/Codex 桌面客户端插件。**

**验证边界：已通过 Node 单元测试和本地模拟 DOM 的无头 Chrome 交互测试，并收到真实网页版安装后可用的用户反馈。该反馈不代表所有账号、浏览器及布局均已验证，也不承诺与某版 DeepSeek Harness 完全一致。**

## 安装（无需 Node/npm）

1. 为 Chrome 或 Edge 安装 [Tampermonkey](https://www.tampermonkey.net/)。
2. 按浏览器提示，在 Tampermonkey 的扩展详情页开启“允许运行用户脚本 / Allow User Scripts”。较早版本可能使用“开发者模式”；以实际提示为准。参见 [Tampermonkey 官方说明](https://www.tampermonkey.net/faq.php#Q209)。
3. 点击 [安装 ChatGPT 轮次导航](https://raw.githubusercontent.com/white-thirteen/chatgpt-turn-navigator/main/dist/turn-navigator.user.js)，在 Tampermonkey 安装页确认安装。
4. 如果安装页没有自动打开，复制 `dist/turn-navigator.user.js` 的**完整内容**，包括 `==UserScript==` 头，然后在 Tampermonkey → 添加新脚本中替换默认模板并保存。无需开启本地文件访问权限。
5. 刷新 `https://chatgpt.com/` 的一个长对话页面，将浏览器窗口展开。对话可视区域宽度必须大于 900px，而且至少有两轮可识别的用户提问。

从旧版升级：在 Tampermonkey 打开原来的“ChatGPT 轮次导航 / Turn Navigator”脚本，Ctrl+A 替换为新版完整内容，保存，然后刷新 ChatGPT。保留一个已启用的脚本副本即可。安装后关闭 DevTools 再观察；DevTools 占用过多高度会使阅读区域不足。

直接下载到的 `turn-navigator.user.js` 与源码包 `dist/` 内的文件相同。无需安装源码依赖即可使用。

## 使用

- 右侧每一根短横对应一轮已识别到的用户提问及其后续回答。
- 鼠标沿轨道移动显示预览；点击横线或轨道内空白位置跳转。
- 当前轮标记宽 20px；普通标记 12px；非当前轮的预览标记 18px；未显示在 DOM 内的已知历史为 8px。
- 相邻标记中心间距固定 10px；轨道最高 420px；超过后可以在轨道内部滚动，两端渐隐。
- Tab 逐个聚焦，Enter / 空格跳转；方向键、Home、End 移动焦点；Esc 关闭当前预览并移出焦点。
- 鼠标或键盘焦点位于轨道内时，暂停自动跟随，防止标记在操作过程中移动。
- 只有检测到明确的“停止生成”按钮时，尾轮才显示忙碌脉冲。停止、取消或缺少回答本身不代表正在生成。
- 关闭脚本：在 Tampermonkey 中停用后刷新页面。卸载时在脚本管理面板删除此脚本。
- Alt+Shift+N 打开/关闭本地诊断面板。未能识别对话或窗口空间不足时，几秒后也会显示“轮次导航未显示 · 查看原因”按钮。面板仅显示结构、数量与尺寸，不含聊天内容、消息标识或对话 URL。

## 已知限制

1. **DOM 是非官方接口。** ChatGPT 改版后可能隐藏导航或出现识别、定位差异，必须根据真实页面修复适配器。
2. **不会凭空补全历史。** 只能读取当前页面实际提供的消息。曾经观察到的消息会保存在当前页面内存中，用来表示暂时被虚拟化移除的已知轮次；刷新或切换对话时清空。第一次打开就没有加载的轮次，无法确定其数量和内容。
3. 轮次编号是本脚本识别到的顺序，不保证等于服务器完整历史的全局编号。
4. 点击未加载的已知轮次，会滚到顶部并最多等待三轮、每轮五次 200ms 轮询；总等待约 3 秒。如果宿主不加载目标消息，就静默放弃。滚到顶部可能触发 ChatGPT 自身的历史请求，脚本不发出该请求。
5. 完全不重叠的消息窗口视为替换；编辑历史问题、切换回答分支和极端虚拟化场景尚未实测，不能保证已有缓存目录完整、无冗余。切换对话和刷新会清空缓存。
6. 纯图片、语音、Canvas、工具卡片等非文本内容的摘要可能不完整；暂不专门适配分享页、嵌入页或移动端。
7. 当页面底部没有足够滚动空间时，最后一轮无法强行贴到顶部。脚本会在原生滚动范围内定位，滚到底部后高亮最后一轮，不添加空白消息或修改消息样式。
8. 只在两个声明域名运行。不支持官方桌面软件，也未适配 Codex Web。
9. 脚本管理器的执行沙箱、站点 CSP 以及真实 ChatGPT 的全部布局尚未全面验证。若脚本完全不启动，先检查脚本管理器权限和页面控制台。

## 隐私与注入方式

- 脚本没有 fetch、XHR、WebSocket、遥测或外部资源加载，不拦截请求，不发送消息，不改写消息内容。
- 不使用 localStorage、IndexedDB、cookie 或 GM 存储；读取到的摘要只在当前页面内存及本地预览 DOM 中存在。
- 使用 Shadow DOM 隔离样式，并在组件宿主重置继承属性、定义自身颜色变量。使用页面明暗主题，系统主题仅作为兜底。
- 不使用 eval、new Function 或内联事件属性。脚本头为两个 @match、document-idle、@grant none，加基本身份与许可证元数据；没有 @require 或 GM_* 权限。
- DevTools Network 可确认没有脚本主动发起的第三方请求；页面及脚本管理器自身的请求不属于本脚本。

## 与提供规格的明确差异

| 项目 | 本实现 | 原因 |
|---|---|---|
| 预览浮层边界 | 限制在阅读区域内，允许超出短轨道 | 52px 的轨道无法容纳最高 100px 浮层 |
| 布局定位 | 外槽仍为 sticky / height:0 / z-index:7；内部 overlay 按真实滚动视口 fixed 定位 | 用户脚本没有 DSH 的原生挂载槽，避免聊天流和定位祖先影响 |
| 可用带高 | 测量滚动视口、实际顶部遮挡和输入框的交叠区域 | 避免输入框已被布局排除时再次扣除高度 |
| 水平位置 | 滚动容器内容右缘内缩 16px | 避让浏览器原生滚动条；属于规格允许调整范围 |
| SPA 检测 | popstate + DOM 变化 + 每 300ms 检查 URL；可见页面每约 1.5s 保底重查 | 避免改写宿主 history 函数；处理新 App-Shell 的缓存页面显隐切换 |
| 流式更新 | 150ms debounce，加 300ms 最大等待；复用按钮 DOM | 避免连续生成使更新一直无法触发 |
| 未加载历史 | 只保留曾识别的消息 ID 与摘要 | DOM 无法提供尚未加载历史的完整目录 |
| 跳转 | 统一 viewport 坐标后设置 scrollTop，instant 定位 | offsetTop 的 offsetParent 不一定是滚动容器；instant 不受宿主 smooth 样式影响 |
| 忙碌状态 | 明确停止生成按钮信号 | 空回答或取消生成不应持续脉冲 |
| 当前轮 | 原阈值规则；到聊天底部时选择最后一轮；跳转后锁定 300ms | 页面滚动上限可能使最后一轮无法跨过阈值 |
| 主题 | 页面设置优先，系统设置兜底 | 跟随用户对 ChatGPT 的手动主题选择 |
| 少于两轮 | 正常隐藏，不输出错误日志 | 新建对话不是适配失败 |
| 键盘焦点 | 与指针进入一样暂停跟随 | 保持键盘操作稳定 |
| 测试命令 | npm test 使用两个明确测试文件路径 | 当前 Windows / Node 24 环境下 node --test tests/ 未能按目录发现测试 |

10px 固定间距、6px 内边距、24px 渐隐带、28px 轨道宽度、420px 高度上限和各标记宽度保持规格值。

## DOM 锚点与改版排查

主要选择器集中在 `src/adapters/chatgpt.js`：

| 用途 | 当前锚点 |
|---|---|
| 主区域 | 可见的 main[data-app-shell-main-surface] / main / [role="main"]，跳过尺寸为零的隐藏缓存页 |
| 消息分组 | [data-testid^="conversation-turn"] / [data-turn-key] / [data-turn-id-container]；角色可以在分组节点自身 |
| 角色 | 旧版 data-message-author-role=user/assistant；新版 data-content-search-unit-key 以 :user / :assistant 结尾 |
| 稳定标识优先级 | data-message-id → data-content-search-unit-key → data-turn-key → data-turn-id → data-testid → 页面内 WeakMap 标识 |
| 输入框 | #prompt-textarea / composer-input / composer-markdown / ProseMirror / Lexical；优先可见的 data-chatgpt-composer、data-thread-find-composer 表单 |
| 生成中 | 可见的 stop-button / stop-generating-button，或明确停止生成的 aria-label |
| 滚动容器 | 从消息向上找包住整个已识别对话的可滚容器，避免误选消息内部滚动框；支持 data-app-action-timeline-scroll、data-conversation-scroll 和 document.scrollingElement |

排查顺序：

1. 确认 Tampermonkey 中脚本已启用、允许在该网站运行，并且刷新过页面。
2. 确认至少两轮对话；实际聊天容器宽度 >900px，不能只看整个窗口的宽度。关闭网站侧栏或放大窗口再试。
3. 优先按 Alt+Shift+N 打开诊断，查看 legacyUsers / modernUsers / recognizedUsers、main 和 layout 尺寸。若有“未显示”提示，点击也可打开；确认版本为 0.1.1。面板不读取或导出聊天正文。
4. 在 Elements 面板检查消息角色锚点是否仍存在、data-message-id 是否稳定，以及哪个祖先才是真正的滚动容器。初次完全无法找到消息时也可能只表现为隐藏，没有日志。
5. 只修订适配器的选择器、消息枚举或布局测量；修改后重建脚本并在 Tampermonkey 中替换、保存、刷新。
6. 如果快捷键没有反应，可在 Elements 查找 `#chatgpt-turn-navigator`。没有宿主节点时，检查脚本管理器的用户脚本权限、域名匹配或 CSP 错误。适配失败仍会输出 `[turn-navigator] adapter unhealthy, rail hidden`，不附带用户消息文本。

## 源码与构建

Node.js 20+，建议 Node 24；构建唯一开发依赖是 esbuild，运行时零依赖。

```sh
npm ci
npm test
npm run build
```

输出：`build/turn-navigator.js` 为单文件 IIFE，`dist/turn-navigator.user.js` 为附带用户脚本头的安装产物。安装不需要运行上述命令。

`tests/browser-smoke.mjs` 是可选浏览器验证工具，不属于构建依赖。它使用 Playwright 测试已安装 Chrome 和本地 fixture；如需复现，可在另一个工具目录安装 Playwright，通过 `PLAYWRIGHT_MODULE_PATH` 提供模块文件 URL，并使用 `BROWSER_PATH` 指定 Chrome 路径、`QA_OUTPUT_DIR` 指定报告目录。

## 验收结果

2026-10-24：Node v24.14.1；8 项纯函数测试通过；无头 Chrome 本地 fixture 的 20 项交互检查通过。另有用户反馈确认网页版安装后可用。以下勾选**仅表示模拟页面验证通过**，可使用 `tests/browser-smoke.mjs` 复现；仓库不包含本地验证截图。

- [x] 5 轮轨道高 52px；标记中心间距 10px；普通横线宽 12px。
- [x] 悬停显示对应问题与回答摘要；非当前标记扩展至 18px；active 与 preview 互斥。
- [x] 点击轨道的空白热区可跳转；中间轮次位于阅读区顶部下方 8px。
- [x] 当前轮跟随聊天滚动切换；跳转期间锁定高亮；底部末轮保留高亮。
- [x] 100 轮轨道封顶 420px；内部可滚；顶部、底部和中部的渐隐状态正确。
- [x] 指针或焦点位于轨道中时暂停自动跟随；移出指针后恢复跟随。
- [x] 连续文本生成过程中按最大等待时间更新；按钮节点不重建；生成结束停止脉冲。
- [x] 对话容器宽度 ≤900px 时隐藏，放宽后恢复；少于两轮时隐藏。
- [x] 键盘方向键、Home / End、Enter 导航可用；标记提供 aria-label、aria-current、aria-busy。
- [x] 减少动态效果时，标记、浮层、轨道的动画和过渡关闭。
- [x] SPA 切换后没有旧消息 ID 或历史缓存残留。
- [x] 破坏消息角色选择器后安全隐藏，恢复选择器后重建。
- [x] 页面设置暗色、系统设置亮色时，导航仍跟随页面暗色。
- [x] 重复注入只保留一份实例，无未捕获浏览器异常。
- [x] 本地浏览器测试中仅有 fixture 页面请求，导航脚本没有额外网络请求。
- [x] 旧 author-role 和 article 全部不存在、首个 main 为隐藏容器时，使用新版 turn-key 消息识别、预览与跳转。
- [x] 消息角色位于 turn 节点自身的结构可以识别。
- [x] 可见主区域为 div[role="main"] 的结构可以识别。
- [x] Alt+Shift+N 可打开诊断；报告不含聊天文本、消息 ID 或对话地址。
- [x] 宿主 class/style 变化观察没有导致自身反复更新循环。
- [x] 收到登录后真实 ChatGPT 页面安装可用的用户反馈（非完整兼容性测试）。
- [ ] 脚本管理器执行沙箱及 CSP 的全面兼容性验证。
- [ ] 不同 ChatGPT 布局、回答分支、真实历史分页、附件及特殊模式验收。
- [ ] Firefox、Safari、Edge 实机验收。

## 来源

几何和交互要求来自用户提供的移植规格，保留其中指定的 DeepSeek Harness 来源注释。实现为框架无关的重新编写，未核实所引路径对应的固定上游 commit，也没有宣称像素与行为完全等同于原版。详见 `NOTICE.md`。

新版 ChatGPT 结构锚点参考 [Ophel 的 ChatGPT 适配器配置](https://github.com/urzeye/ophel/blob/main/src/adapters/chatgpt-config.ts)，独立实现 DOM 识别；未复制其业务代码。
