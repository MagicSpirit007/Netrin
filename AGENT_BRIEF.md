# Netrin current-state brief

完成 `AGENTS.md` 规定的必读顺序后读本文。本文只给当前实现导航，不替代上游 Cell 契约或本地 `SERVER.md`。

## Product and stack

- Vite + React + React Router + TypeScript + AMap JS API 2.0 + `vite-plugin-pwa`；主表面是 390×844 移动优先 PWA。
- 默认中文、英文备用，所有用户文案经过 `t(...)`；内容结构来自 Manifest 和数据层。
- 业务/存储地理数据只用 WGS-84；前端和服务端都只在 AMap 边界转换 GCJ-02。
- 公共路线分享是投稿与人工审核，不是社交网络。没有关注、点赞、收藏、评论、通知、创作者社交主页、社区开关或社区法律 RPC。

## Navigation

- `/`：在线地图、路线预览与主动开始后的定位导览。
- `/discover`：本机随包、下载和自建路线的搜索、筛选、列表/地图选择。
- `/workshop`：云端受审核路线和外观目录；公共路线推荐使用地点、时间和下载等非社交信号。
- `/create`、`/create/:draftId`：地图规划、现场记录、GPX/GeoJSON 导入和统一编辑器。
- `/create/ai`：文本/文件 AI 路线生成，运行时能力决定可见入口，确认后进入统一编辑器。
- `/route/:routeId`、`/guide/:routeId`：公开/本地详情、离线副本与沉浸式导览。
- `/profile`、`/auth`、`/admin`：本地数据与设置、手机号账号、路线/外观/账号审核和审计。
- `/appearance-studio`：外观 v3 工作台与作者指南。
- `/legal`、`/legal/:documentType`：相同的静态“服务、隐私与第三方说明”表面；保留 `legal-document` 外观屏幕族兼容。

## Data and services

- 草稿 v5、草稿媒体、下载路线、离线包元数据、活动路线和外观设置使用 IndexedDB/`localForage`；Provider Key 只在当前标签页 `sessionStorage` 和活动请求中。
- 投稿只接受确认几何并调用 `submit_route_v4`；SQL14 已移除旧 v3/v2 写接口。
- 私有 `route-media` 由 `netrin-media` 签发五分钟 URL；当前函数不处理个人头像或对象大小。
- `netrin-route-plan` 代理 AMap 步行/骑行规划，并要求有效 Supabase JWT、已确认手机号和 active 账号；限流键绑定用户 ID 与可信客户端地址。AI orchestrator 提供 Provider 1.3 文本/文件工作流。
- Workbox `runtimeCaching` 必须为空；不得缓存 AMap 瓦片或远端媒体。
- 可选道路吸附加载 `public/data/campus-paths.json`；该数据为 © OpenStreetMap contributors，并按 ODbL-1.0 独立分发，原始 GPS 始终是兜底。

## Appearance

- 包格式为 `.netrin-appearance` v3，Interface Contract v2；v1/v2 不导入、不激活、不投稿。
- 十个屏幕族和二十一个稳定 Hook 由真实路由/夹具证据产生；上传者 sidecar 不受信，服务端复跑机器审计。
- `appearance-work/song-mountain-map` 与对应管理员审计输出是当前受保护的外观制作证据，不作普通测试夹具。

## Public-source boundary

- 公开版本为无私有 Git 历史的受跟踪文件快照；`SERVER.md`、环境文件、构建产物、主机身份、个人路径、备份哈希和一次性运维档案均不得进入。
- 自有代码采用 AGPL-3.0-or-later；OSM 道路数据采用 ODbL-1.0；依赖许可由 `THIRD_PARTY_NOTICES.md` 与双锁文件检查。
- 仓库内 Supabase、Nginx 与容器文件均为模板，不代表任何生产数据库迁移、服务部署或网络配置已应用。

## Working rules

- 先看 `git status --short --branch`，保护官家未提交内容；禁止 reset 或批量回退。
- 修改导航、数据边界、服务器状态或外观契约时同步更新本文及对应真源。
- 当前活跃文档索引见 `docs/README.md`；私有历史运维档案不进入公开树。
- 静态发布必须构建、测试、扫描、打包、哈希与冒烟；任何真实服务器变更仍须单独授权并更新本地 `SERVER.md`。
