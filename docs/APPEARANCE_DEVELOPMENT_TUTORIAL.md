# Netrin 外观组 v3 开发实操教程

本教程带你从一个空目录开始，完成“创建源码 → 实时预览 → 静态校验 → 确定性打包 → 真实路由审查”的投稿前闭环。命令默认从 Netrin 仓库根目录执行，PowerShell 与其他终端均可使用。

需要查字段全集时，阅读 [作者契约速查](./APPEARANCE_AUTHORING.md)；希望让 Codex 协作完成时，调用 `$author-netrin-appearance`。

## 1. 环境、目录与边界

准备 Node.js、npm 和可运行本仓库的 Chromium/Chrome/Edge。先安装依赖并确认 CLI 存在：

```powershell
npm install
npm run appearance:check -- --help
```

第二条命令会因为没有输入目录而显示用法或错误，这是正常的；关键是脚本能够启动。

本教程使用两个被 Git 忽略的目录：

```text
appearance-work/<id>/       外观源码
appearance-output/<id>/     包、报告和截图
```

外观包只能改变 Netrin 自有界面的颜色、字体、材质、受限布局和动效：

- `skin` 是用户可上传的声明式 ZIP，不获得 React、TypeScript 或脚本执行能力。
- `phenotype` 随应用源码发布；内置 Field Guide 属于 phenotype，不是上传包。
- 高德底图样式是独立用户设置；外观只能改变 Netrin 控件和地图叠层。
- 外观不能改变路由、业务逻辑、数据、账号、投稿或审核行为。

选择一个小写短横线 ID，例如 `song-mountain-map`。ID 必须匹配 `^[a-z0-9]+(?:-[a-z0-9]+)*$`。

## 2. 创建源码并启动实时工作台

创建一个新项目：

```powershell
npm run appearance:init -- song-mountain-map appearance-work/song-mountain-map
```

初始化器拒绝覆盖非空目录，并生成：

```text
appearance.manifest.json
tokens.json
theme.css
README.md
assets/
```

`README.md` 只服务源码作者，不进入最终包。启动实时开发：

```powershell
npm run appearance:dev -- appearance-work/song-mountain-map
```

保持该终端运行，打开 Vite 输出的本地地址，再进入 `appearance-studio?tab=workbench`。开发服务只读取指定源码目录；候选外观保存在内存中，不会安装、不写 IndexedDB，也不访问 Supabase、高德或外部网络。

工作台会在每次文件变化后重新编译并显示 Manifest、令牌图、CSS 诊断、覆盖来源和隔离预览。桌面宽屏为三栏，中等宽度自动降为两栏，390×844 为单栏；所有导入、列表、预览、审计与投稿控件在各尺寸均可访问。390px Shadow DOM 预览在窄栏内自身横向滚动，不得撑破页面。另开一个终端执行后续命令。

## 3. 编写 Manifest 和三层令牌

先编辑 `appearance.manifest.json` 中的作者字段：

```json
{
  "schemaVersion": 3,
  "packageFormat": "netrin-appearance-zip",
  "interfaceContractVersion": 2,
  "id": "song-mountain-map",
  "displayName": "宋代山林舆图",
  "summary": "A restrained field-map appearance inspired by Song landscapes.",
  "version": "0.1.0",
  "type": "skin",
  "author": "Your name",
  "license": "MIT",
  "compatibility": { "minAppVersion": "0.1.0" },
  "entrypoints": { "tokens": "tokens.json", "theme": "theme.css" },
  "assets": [],
  "files": []
}
```

不要添加 `screens` 或 `components`。打包器会重建入口、文件和素材哈希清单，不信任手工填写的覆盖声明。

`tokens.json` 必须保持三层：

```json
{
  "primitive": {
    "color": {
      "pine-950": { "$type": "color", "$value": "#101713" },
      "paper-100": { "$type": "color", "$value": "#F2EBD8" }
    }
  },
  "semantic": {
    "surface": {
      "app": { "$type": "color", "$value": "{primitive.color.pine-950}" }
    }
  },
  "component": {
    "panel": {
      "background": { "$type": "color", "$value": "{semantic.surface.app}" }
    }
  }
}
```

实际文件必须保留初始化器生成的全部必需令牌；上例只演示引用方向：

- `primitive` 仅保存颜色、尺寸、时长、字体和阴影等字面值。
- `semantic` 必须引用 primitive。
- `component` 必须引用 semantic。
- 引用写作 `{primitive.color.pine-950}`，类型必须与目标一致。
- `component.control.min-target` 解析后不得小于 `44px`。

常用稳定输出包括 `--surface-app`、`--foreground-default`、`--border-default`、`--signal-success`、`--button-bg`、`--field-border`、`--focus-ring` 与 `--control-min-target`。完整结构见 [Token Schema](../appearance/appearance.tokens.schema.json)。

## 4. 编写受限 CSS

`theme.css` 可以消费稳定变量，也可以声明以包 ID 开头的私有变量：

```css
[data-appearance-hook="app-shell"] {
  --song-mountain-map-paper-grain: 0.035;
  background: var(--surface-app);
  color: var(--foreground-default);
}

[data-appearance-hook="button"] {
  border-radius: var(--button-radius);
  box-shadow: var(--shadow-hard);
}

[data-appearance-screen="route-detail"]
[data-appearance-hook="route-card"][data-appearance-state="active"] {
  border-color: var(--signal-success);
}

[data-appearance-hook="button"]:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: var(--focus-offset);
}

@media (prefers-reduced-motion: reduce) {
  [data-appearance-hook="button"] {
    animation: none;
    transition: none;
  }
}
```

可以使用稳定的 screen、hook、state、slot、ARIA 和原生控件属性。禁止全局或通配 selector、脚本、隐藏关键控件、固定全屏覆盖、高 z-index、高德节点 selector，以及没有减动效保护的动画。

首页品牌题签使用四个稳定 slot，允许分别控制容器、文字和状态印记：

```css
[data-appearance-slot="brand-wordmark"] { background: var(--surface-paper); }
[data-appearance-slot="brand-title"],
[data-appearance-slot="brand-name"] { color: var(--signal-info); }
[data-appearance-slot="brand-mark"] { background: var(--signal-success); }
```

不要选择 `.home__wordmark`、`.home__brand-name` 等应用私有类名。

例如“宣纸底、石青字、石绿印记、宋体题签”应直接用这四个稳定 slot 表达：`brand-wordmark` 承担纸张背景、边框、间距和阴影，`brand-title` / `brand-name` 承担石青字色与宋体字体栈，`brand-mark` 承担石绿印记。不要回答“Logo 无法修改”，也不要改首页组件。品牌文字、本地化语义、可访问名称与状态含义必须原样保留。若真实 DOM 或契约缺少任一稳定 slot，应停止编辑外观源码并报告“需要先扩展应用契约”。

必须维持：正文对比度至少 4.5:1、可见键盘焦点、交互目标至少 44×44、390×844 无横向溢出、高德 attribution 可见。

## 5. 按需加入素材

默认先用令牌和 CSS。确有必要时，把素材放在 `assets/`：

- 允许 PNG、JPEG、WebP 与 WOFF2。
- 扩展名和文件魔数必须一致；仅改扩展名无法通过审计。
- 不允许 SVG、HTML、JavaScript、Data URL 或远程 URL。
- 不允许路径穿越、软链接目标或包外引用。
- WOFF2 必须有明确许可证；不要让 AI 从网络下载字体。
- 位图应控制尺寸和体积，并记录来源或生成方式。

在 CSS 中以包内相对路径消费素材，例如 `background-image: url("assets/logo.webp")`。完全图形化 Logo 也只能使用 Manifest 已声明的包内 PNG/JPEG/WebP；没有合规位图时，AI 应先索要素材。保留可访问品牌文字或等效可访问名称。打包器会把素材写入 Manifest 清单；审计通过后，应用将其映射为临时 Blob URL，并在外观卸载时回收。未声明路径和任何外部 URL 都会被拒绝。

Manifest 中的素材和文件哈希由打包器生成。不要手工复制旧包的哈希数组。

## 6. 运行静态校验并修复诊断

每轮重要修改后运行：

```powershell
npm run appearance:check -- appearance-work/song-mountain-map --json
```

报告只会把真正执行过的检查标记为 `passed` 或 `failed`；没有执行的项目是 `not-run`。常用定位字段：

| 字段 | 用法 |
| --- | --- |
| `file` | 打开出错的 Manifest、令牌、CSS 或素材文件 |
| `line` / `column` | 定位 CSS 或 JSON 文本位置 |
| `selector` | 识别被拒绝的 CSS selector |
| `tokenPath` | 定位缺失引用、倒置、循环或类型冲突 |

常见修复：

- 未解析引用：确认路径拼写并补回被删除的必需令牌。
- 跨层倒置：primitive 改回字面值，semantic 只指向 primitive，component 只指向 semantic。
- 循环依赖：把共享值下沉到 primitive，再让上层单向引用。
- 类型错误：引用两端使用相同 `$type`，不要让颜色指向尺寸。
- 低对比度：拉开 foreground 与对应 surface 的亮度差。
- 小于 44px：让 `component.control.min-target` 最终解析到至少 `44px`。
- CSS 拒绝：按 `selector` 和行列改用稳定 hook，或删除越界声明。
- 素材错误：检查路径、扩展名、魔数、体积和许可证。

只有静态报告有效且可激活时，才进入视觉确认。

## 7. 审查工作台矩阵

工作台提供十个真实屏幕族：

`map-navigation`、`route-catalog`、`route-detail`、`route-authoring`、`ai-route-authoring`、`profile-community`、`appearance-studio`、`phone-auth`、`legal-document`、`admin-moderation`。

它还提供二十一个组件 Hook 及状态矩阵。逐项确认：

1. `tokens` 来源是否表达了全局设计意图。
2. `CSS` 来源是否只用于必要的局部差异。
3. `inherited` 是否是有意保留的默认行为，而不是遗漏。
4. 默认、hover、active、disabled、focus 和错误状态是否仍可辨认。
5. 地图控件、弹层、表单和底部导航是否形成同一视觉系统。
6. 四个品牌 slot 是否各有独立夹具，并明确标为 `Token`、`CSS` 或“默认继承”。

实时实验室是隔离预览，不代表真实路由审查已经完成。

## 8. 打包与真实路由审查

视觉确认后使用同一个输出目录：

```powershell
npm run appearance:package -- appearance-work/song-mountain-map appearance-output/song-mountain-map/song-mountain-map.netrin-appearance
npm run appearance:review -- appearance-work/song-mountain-map appearance-output/song-mountain-map
npm run appearance:check -- appearance-output/song-mountain-map/song-mountain-map.netrin-appearance --json
```

`appearance:review` 会重新打包，运行 typecheck、生产构建和真实浏览器路由审查，并生成十屏族 × 中英文共二十张 390×844 截图。

审查报告的八项检查必须全部为 `passed`：

`packageAudit`、`typecheck`、`productionBuild`、`routeSmoke`、`locales`、`viewport390x844`、`reducedMotion`、`networkIsolation`。

在 PowerShell 中核对最终包和报告哈希：

```powershell
$audit = npm --silent run appearance:check -- appearance-output/song-mountain-map/song-mountain-map.netrin-appearance --json | ConvertFrom-Json
$review = Get-Content -LiteralPath appearance-output/song-mountain-map/song-mountain-map.netrin-review.json -Raw | ConvertFrom-Json
if ($audit.packageSha256 -ne $review.packageSha256) { throw 'Package and review hashes do not match.' }
```

任何 `failed`、`not-run`、缺失截图或哈希不一致都表示交付尚未完成。

## 9. 与 AI 使用两次确认协作

在 Codex 中调用：

```text
$author-netrin-appearance 请创建一个“宋代山林舆图”风格的外观组，低饱和墨绿、宣纸面板、克制动效，作者为……，许可证为 MIT。
```

Skill 会在两个位置停下：

1. **视觉 brief 后**：确认 ID、作者信息、视觉语言、素材策略和安全边界；确认前不写文件。
2. **静态校验与实时预览后**：确认预览及有意继承的区域；确认前不打包和 review。

迭代时直接描述感受，例如：

```text
面板阴影太重，请保留纸张层次但降低压迫感，并重新运行 JSON check。
```

```text
请比较十个屏幕族，补齐表单、弹层和导航之间不一致的边框与焦点状态。
```

AI 仍必须遵守 v3 契约。要求脚本、外部字体、远程图片或生产部署时，它应拒绝越界部分并给出安全替代方案。

## 10. 交付清单与故障排查

投稿前应得到：

```text
appearance-work/song-mountain-map/                       源码
appearance-output/song-mountain-map/song-mountain-map.netrin-appearance
appearance-output/song-mountain-map/song-mountain-map.netrin-review.json
appearance-output/song-mountain-map/appearance-zh-CN-*.png
appearance-output/song-mountain-map/appearance-en-*.png
```

最终检查：

- v3 包静态审计有效且可激活。
- 八项 review 全部 `passed`。
- 二十张截图存在、尺寸正确且视觉无明显回归。
- 包与报告 SHA-256 完全一致。
- 源码没有脚本、远程资源或未授权字体。
- 开发服务已停止，候选外观没有被自动安装。

常见故障：

- `Refusing to overwrite non-empty directory`：换一个空目录，或确认它是同 ID v3 源码后直接编辑。
- `unsupported-schema-version`：输入是 v1/v2；本工具不迁移旧包。
- Vite 端口占用：使用终端实际输出的新端口，不要假定 5173。
- `not-run`：查看前置失败；例如静态审计失败时，后续构建和截图不会伪装成通过。
- 浏览器审查失败：优先查看报告诊断和对应截图，再区分外观源码问题与无关的应用构建问题。

本教程止于投稿前交付。真实投稿、管理员批准、Function 部署、SSH、数据库迁移、Git 提交和推送均需要独立请求与授权。
# 可靠性门禁补充

外观 v3 发布候选必须先运行 `npm run validate:appearance`。工作台中的包输入仅用于 `.netrin-appearance`，报告输入仅用于 `.netrin-review.json`；投稿前会重新导出当前选中包并复算 SHA-256。管理员批准必须经 `netrin-appearance` Function 重新下载私有候选包、机器审计并严格核验八项检查和二十项证据，不能在浏览器中直接调用数据库批准 RPC。
