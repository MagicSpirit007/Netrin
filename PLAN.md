# Netrin Cell · 维护与发布状态

Netrin 的当前开发范围已经完成。本文不再保存未实施的产品路线图，只记录现行能力、维护边界和发布门禁。实现事实以 `AGENT_BRIEF.md` 为准，服务器事实以本地 `SERVER.md` 为准。

## 当前产品

- 移动优先、可安装的 Vite + React + TypeScript PWA，默认 `zh-CN`，可切换英文。
- 全国步行、CityWalk 与休闲骑行路线的制作、审核、浏览、下载和导览；没有默认样板城市。
- 地图规划、现场离散记录、GPX/GeoJSON 导入和 AI 文本/文件输入最终进入同一个路线编辑器。
- 公开路线采用投稿与人工审核，不提供关注、点赞、收藏、评论、通知或创作者社交主页。
- `/legal` 是静态服务、隐私与第三方说明，不读取社区法律 RPC，也不记录协议同意。

## 公开版本

- 当前包版本为 `0.1.2`，公开发布目标为无私有历史的 `MagicSpirit007/Netrin` 单一根提交。
- 公开快照排除 `SERVER.md`、本地环境文件、构建产物、主机资料、个人路径、备份哈希与历史运维档案。
- 开源发布不修改数据库、Supabase Functions、AI 服务、Nginx、DNS、TLS、防火墙或凭据；这些操作需要独立授权。

## 已完成基线

- 路线数据以 WGS-84 GeoJSON 为真源，仅在高德边界转换 GCJ-02；线路确认后通过 `submit_route_v4` 投稿。
- 发现页汇总本机路线，`/workshop` 提供受审核的云端路线与外观目录，路线详情负责分享、离线保存和开始导览。
- 本地贴路是可关闭增强；15 m 内应用，路径缺失、精度不足或超阈值时保留原始 GPS。
- 离线包只保存几何与文字；远端图片保持在线，Workbox 不缓存高德瓦片或媒体。
- 手机号账号、路线/外观审核、审计记录、自托管 Supabase、私有路线媒体与五分钟签名 URL 已投入使用。
- 外观组 v3 使用 Manifest v3、Interface Contract v2、三层令牌、受限 CSS、机器审计、双检查点和哈希绑定 review sidecar。
- AI Provider 1.3 支持文字及 PDF/DOCX/TXT/MD，固定 Qwen/Kimi/DeepSeek 与受限自定义 OpenAI Chat Completions；不支持 URL 抓取、视觉、OCR 或聚合模型目录。

## 服务器和迁移边界

- 生产数据库保留已实施的路线、账号、安全和外观迁移，包括 SQL14、16、17、18；迁移历史及 verify/rollback 文件继续留仓库。
- R2 SQL11/12、质量 SQL15 从未部署并已永久删除，不执行回滚。
- `netrin-media` 仓库代码保持路线媒体签名边界，不含个人头像候选或 `sizeBytes` 候选。
- 新的数据库、Function、AI 服务、Nginx 路由、DNS、TLS、防火墙和凭据变更均需单独授权；静态发布不推断这些权限。

## 维护门禁

每次正式静态发布至少通过：

1. `npm run validate:cell`
2. `npm run licenses:check`、Biome 与两个包的 `npm audit --audit-level=moderate`
3. `npm run typecheck` 与 `npm run test`
4. `npm run ai:typecheck` 与 `npm run ai:test`
5. `npm run shell:check` 与 `npm run validate:appearance`
6. `npm run build`、产物秘密扫描与性能预算
7. `npm run test:smoke` 的 390×844 双语/路由/PWA 验收
8. 公共树与历史秘密扫描、干净克隆复验、单根提交与 GitHub 保护设置

## 明确不实施

- R2 社交关系、社区开关、社区协议同意 RPC 和治理队列。
- 质量遥测、SQL15、远端图片离线缓存与完整地图匹配。
- Expo、EAS 或预建原生工程；如未来需要商店包，仅以独立里程碑用 Capacitor 包装当前 Web 构建。
- 高德底图/瓦片缓存、GCJ-02 业务持久化、前端 service-role 或模型密钥。

历史维护窗与生产迁移证据只保存在私有运维系统中，不进入公开仓库。
