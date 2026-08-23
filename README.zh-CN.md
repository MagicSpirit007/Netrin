# Netrin

[English](README.md) | **简体中文**

Netrin 是一款移动优先、可安装的 Web 应用，用于创作、审核、分享、下载徒步、
CityWalk 和休闲骑行路线，并在途中提供路线引导。路线几何数据以 WGS-84
GeoJSON 存储，只在地图服务商的边界进行坐标转换。

当前版本是一款基于 Vite、React 和 TypeScript 的 PWA，使用高德地图 JS API
2.0，支持本地优先的路线草稿，并可选择接入 Supabase 后端和路线意图 AI 服务。

在线演示：[utopians.cloud/netrin](https://utopians.cloud/netrin/)

## 包含内容

- 地图规划、实地记录以及 GPX/GeoJSON 导入。
- 可选的尽力而为道路吸附功能，使用仓库内由 OpenStreetMap 衍生的数据。
- 路线审核、离线保存和路线引导流程。
- 自托管 Supabase 所需的 SQL 和 Edge Function 源码。
- 可独立部署的 Node.js AI 路线编排服务。
- 简体中文（`zh-CN`）和英文界面资源。

Netrin 不是官方导航工具、安全保障服务或紧急救援服务。

## 环境要求

- Node.js 22.19.0 或更高版本
- npm（Node.js 随附的版本即可）
- 用于在线地图功能的高德地图 JS API Web 端 Key
- 可选：用于账户、存储、审核和云端数据的 Supabase 项目

各软件包仍设为 `private: true`；本仓库不是 npm 软件包。

## 快速开始

```powershell
npm ci
Copy-Item .env.local.example .env.local
npm run dev
```

请在 `.env.local` 中填写您自己的浏览器端公开凭据。切勿把 Supabase
`service_role` 密钥、数据库密码、模型 API 密钥、私钥或服务器凭据放入
`VITE_` 变量，也不要将它们提交到仓库。

本地开发包装层为 AI 路线服务提供确定性的模拟实现。若要单独运行真实服务：

```powershell
npm --prefix services/netrin-ai-orchestrator ci
Copy-Item services/netrin-ai-orchestrator/.env.example services/netrin-ai-orchestrator/.env
npm --prefix services/netrin-ai-orchestrator run start
```

## 配置

| 变量 | 作用范围 | 用途 |
| --- | --- | --- |
| `VITE_AMAP_KEY` | 浏览器 | 高德地图 JS API 2.0 Web 端 Key |
| `VITE_AMAP_SERVICE_HOST` | 浏览器 | 可选的同源高德安全代理 |
| `VITE_SUPABASE_URL` | 浏览器 | 您的 Supabase 项目 URL |
| `VITE_SUPABASE_ANON_KEY` | 浏览器 | 仅限公开的 anon/publishable key |
| `VITE_AI_ROUTE_API_BASE` | 浏览器 | 可选的公开 AI 服务基址；留空表示同源 |

完整模板请参阅 `.env.local.example` 和
`services/netrin-ai-orchestrator/.env.example`。

## 验证

```powershell
npm run validate:cell
npm run licenses:check
npm run lint
npm run typecheck
npm test
npm run shell:check
npm run validate:appearance
npm run build

npm --prefix services/netrin-ai-orchestrator run typecheck
npm --prefix services/netrin-ai-orchestrator test
```

依赖漏洞门禁使用公开 npm 注册表：

```powershell
npm audit --audit-level=moderate --registry=https://registry.npmjs.org/
npm --prefix services/netrin-ai-orchestrator audit --audit-level=moderate --registry=https://registry.npmjs.org/
```

## 架构与部署

- `src/`：PWA 界面、本地优先的数据流和地图服务商适配器。
- `public/data/`：随应用分发的公开数据及其来源元数据。
- `supabase/`：可复用的数据库结构、迁移源码和 Edge Functions。
- `services/netrin-ai-orchestrator/`：隔离部署的路线意图服务。
- `themes/`：外观定义和验证夹具。
- `docs/`：可复用的产品与部署指南。

生产主机、凭据、DNS、数据库状态和私有运维历史均有意排除在本仓库之外。
部署文件均为模板，使用前请根据自己的环境审查并填写参数。上述构建和测试命令
不会对生产环境进行任何变更。

## 贡献与安全

提交拉取请求前，请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。所有提交都必须带有
DCO `Signed-off-by` 行。请按照 [SECURITY.md](SECURITY.md) 的说明私下报告安全漏洞，
不要发布到公开 Issue。

## 许可证与署名

- Netrin 原创源代码：**AGPL-3.0-or-later**。参见 [LICENSE](LICENSE)。
- `public/data/campus-paths.json`：**ODbL-1.0**，© OpenStreetMap contributors。
  参见 [LICENSES/ODbL-1.0.md](LICENSES/ODbL-1.0.md) 和
  [public/data/README.md](public/data/README.md)。
- 第三方软件包：分别遵循各自的许可证。参见
  [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

AGPL-3.0-or-later 允许商业使用，但使用者须遵守其许可条件；通过网络向用户提供
修改版本时，可能需要履行相应的网络源码提供义务。
