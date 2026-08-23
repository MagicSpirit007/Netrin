# Netrin supporting documents

本目录只保存仍会指导当前实现或可复用部署的文档。私有主机状态、一次性维护窗、备份哈希和历史发布记录不进入公开仓库。文档命令默认从仓库根目录执行。

## 当前文档

- `AI_ROUTE_GENERATION_IMPLEMENTATION.md`：AI 路线服务、前端输入边界与安全约束。
- `ALIYUN_PNVS_PHONE_AUTH.md`：手机号认证的现行架构、配置真源和低成本排障顺序。
- `AMAP_SECURITY_PROXY.md`：高德 serviceHost、安全头与代理约束。
- `APPEARANCE_AUTHORING*.md`、`APPEARANCE_DEVELOPMENT_TUTORIAL*.md`：外观组 v3 中英文契约与教程。
- `APPEARANCE_V3_RELEASE_RUNBOOK.md`：外观 v3 后续维护发布门禁。
- `public/data/README.md`：OpenStreetMap 道路数据来源、署名和 ODbL 边界。

历史运维档案保留在私有系统中；不得从公开模板推断某一生产环境已经应用任何迁移或部署。

## 根目录真源

- `AGENTS.md`：操作规则与强制阅读入口。
- `NEURON_CELL.md`、`neuron.manifest.json`：产品和运行时结构真源。
- `AGENT_BRIEF.md`：代理所需的当前实现摘要。
- `PLAN.md`：开发完成后的维护与发布状态。
- `DESIGN.md`：视觉、布局和外观边界。
- `SERVER.md`：仅在本地私有工作区存在的服务器冷启动与变更日志真源，不进入公开仓库。

项目级 `$author-netrin-appearance` Skill 位于 `.agents/skills/author-netrin-appearance/`，继续执行两次人工确认式外观开发流程。
