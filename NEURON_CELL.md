# Netrin Cell

## Natural-language brief

Netrin（中文产品名“移步换景”）是全国可扩展的移动优先步行、CityWalk 与普通自行车观光路线分享 PWA。访客可浏览、搜索、下载与导览公开路线；作者可规划、现场录制或导入路线，编辑有序重点（文字、标题与照片），保存草稿并提交审核。技术和数据按多城市架构设计，**不指定**任何默认或冷启动样板城市。

名称取自引导轴突走向目标的 netrin 蛋白：本 Cell 引导人沿作者确认的路线抵达有序重点。独立的“沿途观察 / field-note”产品已从当前范围移除；现场文字与照片属于路线重点。

结构化运行时真源是 [`neuron.manifest.json`](neuron.manifest.json)。本文描述**目标产品边界**；实现进度以 `PLAN.md` 里程碑与下方 Runtime drift 为准，不得把未交付能力写成已上线。

## Target users

- 浏览、下载并导览公开步行 / 骑行观光路线的访客（可免登录）
- 在地图上规划、现场录制或导入 GPX / GeoJSON 并提交审核的作者（需已验证大陆手机号）
- 浏览受审核公共路线和下载内容的使用者（公共分享不构成社交网络）
- 审核公开路线、外观组、账号与审计记录的管理员

## Platform and stack

主界面是可安装的 `mobile-web` PWA，技术栈为 Vite、React、React Router、TypeScript、AMap JS API 2.0 与 `vite-plugin-pwa`。这一选择符合 Cell Contract 对非 Expo 实现的例外：当前交付需要链接即开、浏览器原生高德地图和可控的 PWA 缓存，而不需要 App Store / Play Store 构建。

`vite.config.ts` 取代 Expo `app.json`；`packaging` 仅为 `web`。未来若确需 `.apk` 或商店发布，以 Capacitor 包装同一 Web 构建，并按新增里程碑接入原生定位和相机，不预建 Expo 脚手架。

## Target product surfaces

- **home（地图）**：高德在线底图；目标支持城市 / 地点 / 重点搜索与路线预览；导览使用独立沉浸式路由
- **discover（发现）**：汇总内置、已下载和至少含一个重点的自建路线，并按城市、范围、步行 / 骑行、距离、时长、难度与主题筛选
- **workshop（创意工坊）**：受审核公共路线与外观组目录；路线推荐使用地点、时间和下载等非社交信号并复用统一筛选
- **create（创作）**：地图规划、现场离散录制或文件导入，进入统一路线编辑器
- **profile（我的）**：账号、投稿、下载、草稿、语言、地图样式、外观与产品说明
- **auth**：中国大陆手机号注册、短信确认、密码登录和短信密码恢复
- **admin**：路线 / 外观审核、账号管理与审计
- **appearance-studio**：同站点公开外观作者入口；本轮提供 v3 源码创建、实时实验室、静态校验、真实路由审查、确定性打包与带报告投稿，不扩建手机目录或新成品外观

所有可见文案经 `react-i18next`；业务数据来自 Manifest、`data/*.json`、IndexedDB 或 Supabase，不在组件里复制产品内容。

## Completed runtime surfaces

路线详情、独立导览、步行/骑行规划、作者确认 WGS-84 线路、离线保存、GPX/GeoJSON 导入、三入口统一编辑器、发现筛选和分享闭环均已实现。关注、收藏、点赞、评论、消息、举报和创作者社交主页不属于产品范围。

## Map and data rules

- 高德是在线底图、定位与路径规划提供方；Netrin 负责路线、重点、实时位置、罗盘、控制条与面板。
- 持久化和业务交换统一使用 WGS-84；仅在 AMap 适配器边界与 GCJ-02 互转。作者确认的 `LineString` 与有序重点是作品真源；提供方临时偏航线不入库。
- 出行方式目标为 `walking` 与 `cycling`（普通自行车）；电动自行车不在首版。
- 本地路径网吸附仅为可选增强；全国录制不得依赖校园路径数据。
- 浏览器锁屏/后台定位不可靠；作者以离散标记重点为主，不得宣传为后台轨迹记录器。
- 阶段一数据本地优先；云端使用自托管 Supabase/PostGIS/Storage/Auth。公开、本人、管理员使用各自最小投影。

## Plugin contract

运行时选择由 Manifest 和 [`plugins/cell-plugins.json`](plugins/cell-plugins.json) 共同声明。插件 **id** 保持稳定；能力字符串描述城市/模式排序、GPX/GeoJSON 导入、定位、媒体和 AI 路线等当前槽位。已删除评分 receptor 与点赞/收藏能力。地图底座是基础设施，不伪装成插件。上传外观仍是无脚本的受限 skin，phenotype 仅随源码发布。

## Runtime state after the 0.1.2 static release (2026-08-23)

M1.5 expand（2026-07-20）、M2 激活与 **R1（M3+M4，2026-07-24）** 已在生产生效。当前真实边界：

- **公开仓库不记录生产主机、活动目录、备份哈希或已应用迁移状态**。仓库中的 SQL、Functions、AI 服务与 Nginx 内容均为源码或模板；任何真实部署状态只由部署者的私有运维记录确认。
- 四底栏路由：`/`、`/discover`、`/create`、`/profile`；另有 `/route/:routeId`、`/guide/:routeId`、`/workshop`、`/auth`、`/admin`、`/appearance-studio`、`/legal`。`/creator/:publicId` 与 `/notifications` 不存在。
- `/create` 三入口（地图规划 / 现场录制 / 文件导入）与 `/create/:draftId` 统一路线编辑器已随 R1 静态站上线；草稿 `version:5`（兼容迁移 v4），几何必须由作者确认
- M9 / R5 Provider 1.3.0 支持提示词与文件（PDF/DOCX/TXT/MD）、固定 Qwen/Kimi/DeepSeek 以及受限自定义 OpenAI Chat Completions；不支持视觉、URL 抓取、聚合模型目录或 OCR。Key 只在当前页面进程与活动请求内存中；刷新或关闭页面即丢失，草稿也不保存 Provider、模型、Base URL、Key 或轨迹。`/analyze` 上限 1 MiB，目录与探测上限 32 KiB 并独立限速；自定义端点仅允许经公网校验并固定 IP 的 HTTPS 443。API base 留空时默认同源，入口由运行时 providers 能力决定
- 严格 GPX / GeoJSON 导入已上线；发现页支持本机路线汇总、筛选、搜索与地图选择；独立创意工坊承载云端受审核摘要与非社交推荐；路线详情支持线路、模式、指标、有序重点、分享、离线保存与开始导览
- `/guide/:routeId` 直接按 URL 加载路线，不依赖全局 `activeRouteId`；导览隐藏底栏，正常跟随持久 WGS-84 几何，去起点或偏航时才临时重算
- 客户端运行时重点字段仅 `highlightTitle`（legacy wire 的 `speciesName` 只在归一器入口消费）
- 下载键 `netrin.downloaded.v3`；新客户端只允许 confirmed 几何投稿并走 `submit_route_v4`；`submit_route_v3` 已随 SQL14 移除，长期未更新客户端不再获得旧写接口
- CreateScreen 可选择 `walking` / `cycling`，经服务端适配层规划相邻重点，确认后持久化 WGS-84 `LineString`、距离与预计时长
- 两条历史路线已以真实 `amap-planned` WGS-84 LineString 审计确认（navigable=2、`needs_geometry_review=0`）
- **R2 已永久取消**：无关注、收藏、点赞、评论、举报、消息、社区开关或法律同意 RPC；数据库未应用 SQL11/12，仓库不再携带候选实现。
- **R3 已完成**：SQL13 兼容观测随 R1 启动；PWA 更新周期于 `2026-08-14 13:14:57 UTC` 标记且旧使用最终为 0。官家于 2026-08-15 以显式理由/授权批准 early 路径，SQL14 单事务提交并通过独立 verify、当前读模型刷新链、数据/Storage 与真实匿名路线/媒体烟测，未回滚
- **R4 纯本地增强**：几何/文字离线包与本地吸附已随静态站上线；不缓存远端图片，不部署 SQL15、质量 RPC 或 Admin 摘要；`netrin-media` 保持路线媒体签名边界。
- 无路线时地图使用全国级中性视野；随包 `data/nature.json` 可为空
- 外观 Interface Contract v2 使用十屏族：`map-navigation`、`route-catalog`、`route-detail`、`route-authoring`、`ai-route-authoring`、`profile-community`、`appearance-studio`、`phone-auth`、`legal-document`、`admin-moderation`
- 生产已安全配置 `AMAP_WEB_SERVICE_KEY`；`netrin-route-plan` 与媒体签发仍以 M2 时代部署为准

## Acceptance criteria

**契约（M0）**

- Manifest contentTypes 为 `community-route` 与 `route-highlight`；无 `field-note` / 旧 trail/species 类型
- 文档与元数据描述全国步骑路线制作、审核、分享和导览，且不指定默认样板城市
- 用户可见文案须如实反映当前产品；不得把已永久取消的社交能力写成待开放功能

**行为（0.1.2 生产运行时）**

- 390×844 下可打开独立路线详情与导览 URL、查看重点，并在主动授权定位后沿确认线路导航
- 作者可经三入口建立至少两个关键点、选择步行/骑行、切换道路吸附、导入 GPX/GeoJSON、附加媒体、确认线路、保存并以 v4 提交审核
- AMap 失败时路线录制和本地数据仍可用，算路明确进入可重试状态；已离线保存的确认线路可继续显示和导览
- 精确位置和待审媒体默认不公开；公开读取不暴露作者内部 ID 或 Storage 路径
- 路线与关键点使用 WGS-84 持久化
- 中英文、PWA 安装、离线草稿、私有媒体授权、RLS 与后台审计均通过自动或手工验收
