# Netrin 外观组 v3 作者指南

本页是契约速查。需要从空目录完成一次开发闭环，请阅读[外观组 v3 开发实操教程](./APPEARANCE_DEVELOPMENT_TUTORIAL.md)；在 Codex 项目中可调用 `$author-netrin-appearance` 进行两次确认式协作。

## 1. 快速开始

外观组只改变 Netrin 自有界面的颜色、字体、材质、受限布局和动效，不改变业务逻辑、高德底图样式或数据。推荐工作流：

```bash
npm run appearance:init -- my-skin ../my-skin
npm run appearance:dev -- ../my-skin
npm run appearance:check -- ../my-skin
npm run appearance:package -- ../my-skin ../my-skin.netrin-appearance
npm run appearance:review -- ../my-skin ../my-skin-review
```

浏览器打开 `/appearance-studio?tab=workbench` 查看实时组件实验室。`appearance:dev` 只读取命令指定的源码目录；实时候选保存在内存中，不写 IndexedDB、不安装、不访问 Supabase、高德或外部网络。

## 2. 包结构

`.netrin-appearance` 是路径排序、时间戳归一的确定性 ZIP，只允许：

```text
appearance.manifest.json
tokens.json
theme.css
assets/*
```

素材仅允许 PNG、JPEG、WebP、WOFF2；路径、大小、SHA-256 与文件魔数都要通过检查。SVG、脚本、HTML、Data URL 和远程 URL 均不允许。

## 3. Appearance Manifest v3

Manifest 固定为 `schemaVersion: 3`、`interfaceContractVersion: 2`、`type: "skin"`。作者填写身份、摘要、SemVer、作者、许可证和应用兼容范围；打包器重建 `entrypoints`、`files` 与 `assets` 的哈希清单。

```json
{
  "schemaVersion": 3,
  "packageFormat": "netrin-appearance-zip",
  "interfaceContractVersion": 2,
  "id": "my-skin",
  "displayName": "My Skin",
  "summary": "A concise description.",
  "version": "1.0.0",
  "type": "skin",
  "author": "Author",
  "license": "MIT",
  "compatibility": { "minAppVersion": "0.1.0" },
  "entrypoints": { "tokens": "tokens.json", "theme": "theme.css" },
  "assets": [],
  "files": []
}
```

v3 不再声明可伪造覆盖度的 `screens` 或 `components` 数组。v1/v2 不再导入、执行或投稿，也没有自动迁移；本机旧归档只可导出或删除。

## 4. 三层令牌

`tokens.json` 采用 DTCG 风格叶节点：`{ "$type": "color", "$value": "#0b0c0e" }`。

- `primitive` 只保存颜色、尺寸、时长、字体和阴影等原始值，不得引用别层。
- `semantic` 必须引用 `primitive`，覆盖 surface、foreground、border、signal、map、font、radius、shadow、motion。
- `component` 必须引用 `semantic`，覆盖 button、icon-button、field、panel、card、navigation、sheet、dialog、toast、focus、control。

引用写作 `{primitive.color.ink-900}`。校验器拒绝缺失引用、跨层倒置、循环、类型不匹配，以及解析后小于 44px 的 `component.control.min-target`。

稳定输出变量包括 `--surface-app`、`--foreground-default`、`--border-default`、`--signal-success`、`--button-bg`、`--field-border`、`--focus-ring` 与 `--control-min-target`。完整定义见 [Token Schema](../appearance/appearance.tokens.schema.json)。

## 5. CSS Hooks、页面、状态与插槽

`theme.css` 可以消费稳定变量，或声明以包 ID 开头的私有变量，如 `--my-skin-texture`；不能重新声明稳定契约变量。

```css
[data-appearance-hook="button"] {
  box-shadow: var(--shadow-hard);
}

[data-appearance-screen="route-detail"] [data-appearance-hook="route-card"] {
  border-width: 2px;
}

@media (prefers-reduced-motion: reduce) {
  [data-appearance-hook="button"] { animation: none; transition: none; }
}
```

Interface Contract v2 的十个屏幕族是 `map-navigation`、`route-catalog`、`route-detail`、`route-authoring`、`ai-route-authoring`、`profile-community`、`appearance-studio`、`phone-auth`、`legal-document`、`admin-moderation`。

二十一个组件 Hook 是 `app-shell`、`top-bar`、`bottom-navigation`、`button`、`icon-button`、`text-field`、`switch`、`route-card`、`route-point-card`、`media-gallery`、`map-frame`、`map-controls`、`recorder-panel`、`route-plan-confirmation`、`navigation-instruction`、`sheet`、`dialog`、`toast`、`loading-state`、`empty-state`、`error-state`。还可使用稳定的 `data-appearance-state`、`data-appearance-slot`、ARIA 与原生控件属性。

首页品牌题签正式提供四个稳定 slot：`brand-wordmark`（完整题签）、`brand-title`（`NETRIN`）、`brand-name`（本地化应用名）与 `brand-mark`（带可访问名称的状态印记）。外观应以这些 slot 为入口，不得依赖 `.home__wordmark` 等应用私有类名。

文字题签可直接用稳定变量、CSS 与包 ID 私有变量调整颜色、背景、边框、字体、间距、阴影和材质；不得改写 `NETRIN`、本地化品牌名、可访问名称或状态含义。若四个稳定 slot 任一缺失，作者或 AI 必须停止外观源码编辑并报告“需要先扩展应用契约”，不得修改业务组件或偷偷改用私有类。

```css
[data-appearance-slot="brand-wordmark"] {
  background: var(--surface-paper);
  border: 1px solid var(--signal-info);
  box-shadow: var(--shadow-hard);
}
[data-appearance-slot="brand-title"],
[data-appearance-slot="brand-name"] {
  color: var(--signal-info);
  font-family: var(--font-display);
}
[data-appearance-slot="brand-mark"] { background: var(--signal-success); }
```

完全图形化 Logo 只允许 Manifest 已声明的包内 PNG/JPEG/WebP，并通过 `url("assets/logo.webp")` 安全映射。禁止 SVG、Data URL、外部 URL、脚本和运行时下载；现有品牌文字或等效可访问名称必须保留。运行时只为审计过的字节创建 Blob URL，并在卸载外观时回收。

## 6. 资源与安全限制

禁止脚本、外部资源、全局 selector、通配 selector、隐藏关键控件、fixed 全屏覆盖、高 z-index、路径穿越、高德节点 selector，以及没有 `prefers-reduced-motion: reduce` 保护的动画。文字对比度至少 4.5:1，交互目标至少 44×44，焦点必须可见，390×844 不得横向溢出，高德版权必须可见。

包内素材通过相对路径引用，例如 `background-image: url("assets/logo.webp")`。该路径必须出现在 Manifest 的打包器生成素材清单中；审计器会拒绝未声明路径和外部 URL，运行时只把已审计字节映射为临时 Blob URL，并在外观卸载时回收。

## 7. 打包、校验与路由审查

`appearance:check` 只报告真正运行过的归档、Schema、令牌、CSS、安全、兼容与校验和检查，状态为 `passed`、`failed` 或 `not-run`。`appearance:validate` 是 v3 check 的兼容别名。

`appearance:review` 会先打包，再运行 TypeScript、生产构建和真实浏览器路由审查，生成 v3 包、十屏族中英文 390×844 截图和 `<id>.netrin-review.json`。诊断包含文件、行、列、selector 或 token 路径。报告中的包 SHA-256 必须与投稿包一致。

## 8. skin、phenotype 与投稿审核

上传包永远只能是声明式 `skin`，不能获得 React、TypeScript、脚本或插件执行权。内置 Field Guide 是随应用源码发布的 phenotype；新的 phenotype 仍走源码评审和应用发布，不伪装成上传 ZIP。

投稿必须同时选择 v3 `.netrin-appearance` 与匹配的 `.netrin-review.json`。作者报告被标记为“作者提供、不可直接信任”；服务端独立重跑机器审计后才写入 pending。任一检查为 failed/not-run、哈希不匹配或契约版本错误都会被拒绝。管理员批准前必须下载私有包、核对 SHA-256，并在本地重跑 review。

## 9. 契约下载与 AI 交付

- [开发实操教程](./APPEARANCE_DEVELOPMENT_TUTORIAL.md)
- [Interface Contract v2](../ui-contract/interface-contract.json)
- [Manifest Schema v3](../appearance/appearance.manifest.schema.json)
- [Token Schema v3](../appearance/appearance.tokens.schema.json)
- [外部 AI 提示模板](../appearance/EXTERNAL_AI_PROMPT.md)

仓库中的 v1/v2 示例和旧评审截图已经删除，不再作为档案或输入。需要示例时用 `appearance:init` 创建新的 v3 源码；外部 AI 最终应交付源码目录、确定性包、审查报告与截图目录。
