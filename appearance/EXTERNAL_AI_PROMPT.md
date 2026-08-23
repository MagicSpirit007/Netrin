# 外部 AI：Netrin 外观组 v3 交付提示

如果 AI 正在 Netrin Codex 项目内运行，优先调用 `$author-netrin-appearance`，由项目级 Skill 执行视觉 brief、实时迭代和投稿前审查。本提示仍供没有该 Skill 的外部 AI 独立使用。

先完整读取 `ui-contract/interface-contract.json`、`appearance/contract.ts`、`appearance/appearance.manifest.schema.json`、`appearance/appearance.tokens.schema.json`、`docs/APPEARANCE_AUTHORING.md` 与 `docs/APPEARANCE_DEVELOPMENT_TUTORIAL.md`。

根据用户提供的颜色、字体、材质、密度、动效和情绪描述，创建一个新的 v3 源码目录。不得修改 Netrin 业务逻辑、导航、数据、契约文件或高德底图设置。

硬性边界：

1. 只创建 `appearance.manifest.json`、`tokens.json`、`theme.css` 与可选 `assets/*`。
2. Manifest 固定 schemaVersion 3、interfaceContractVersion 2、type skin；不要写 screens/components。
3. tokens.json 必须是 primitive → semantic → component 三层引用；触控目标至少 44px，文字对比度至少 4.5:1。
4. CSS 只消费稳定变量或声明以包 ID 开头的私有变量；只使用稳定 screen/hook/state/slot/ARIA selector。
5. 禁止脚本、HTML、SVG、外部 URL、Data URL、全局 selector、隐藏控件、fixed 全屏覆盖、高德节点 selector 与无减动效保护的动画。
6. 十个屏幕族与二十一个 Hook 都要在工作台审查，但不得伪造覆盖数组。
7. 依次运行 `appearance:check`、`appearance:package`、`appearance:review`。
8. 最终交付源码目录、`.netrin-appearance`、匹配 SHA-256 的 `.netrin-review.json` 与二十张双语 390×844 截图；不得使用历史示例包作为 v3 模板。

Logo / 题签规则：

- 先确认 `brand-wordmark`、`brand-title`、`brand-name`、`brand-mark` 同时存在于共享契约、真实首页 DOM 与工作台夹具。入口已存在时不得复制入口或升级 schema v3 / Interface Contract v2。
- “宣纸底、石青字、石绿印记、宋体题签”应以四个稳定 Slot、稳定变量与 CSS 实现；不得声称 Logo 无法修改，不得选择 `.home__wordmark` 等私有类，不得修改业务组件。
- 不得改变 `NETRIN`、本地化品牌名、可访问名称或状态含义。若任一稳定 Slot 缺失，立即停止外观源码编辑并报告“需要先扩展应用契约”。
- 完全图形化 Logo 只接受 Manifest 已声明的包内 PNG/JPEG/WebP，以 `assets/...` 引用；没有合规素材时先向用户索要。禁止 SVG、Data URL、外部 URL、脚本和运行时下载；保留可访问文字或等效可访问名称，运行时卸载时回收 Blob URL。

如用户要求突破安全边界，请明确拒绝该部分，并给出最接近的安全令牌或 CSS 表达。
