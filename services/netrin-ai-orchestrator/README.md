# netrin-ai-orchestrator

Netrin M9 / R5 的独立 Node.js 路线意图服务。它只开放固定路线领域工具，不向 Agent 提供 Shell、文件写入、任意 HTTP、数据库或通用网络能力。

## 本地命令

```text
npm ci
npm run typecheck
npm run test
npm run start
```

服务配置见 `.env.example`。模型 API Key 只随 `/model-catalog`、`/provider-probe` 或 `/analyze` 请求进入 request-scoped closure，请求结束即清空引用；服务端不保存 Key。浏览器只把 Key 放在当前标签页的 `sessionStorage`。

## Provider 1.3.0 契约

- 输入仅为提示词和文件；文件仅支持 TXT、MD、DOCX 与带文字层 PDF。
- 文件单件与合计上限均为 10 MiB，PDF 最多 30 页，抽取文字最多 100,000 字符。
- 扫描 PDF 拒绝；混合 PDF 只采用文字页并返回警告。不运行浏览器或服务端 OCR，不接收图片或视觉消息。
- 固定 Provider 为 DeepSeek、Qwen、Kimi。Qwen 包含 `qwen3.8-max` 及所需 3.7/3.6 文本模型；不登记视觉模型。
- 可选自定义 Provider 只兼容 OpenAI Chat Completions，且仅允许公网域名的 HTTPS 443。禁止 URL 抓取、模型路由聚合服务、任意 Header 和重定向。
- 自定义目标须通过所有 DNS 结果公网校验；实际连接固定已验证 IP，并保持原域名 TLS/SNI。回环租约代理只允许 `GET /models` 与 `POST /chat/completions`。
- `/model-catalog` 与 `/provider-probe` 使用独立小请求体和限速；能力探测签发一小时、绑定用户/端点/模型/Key 指纹的短期令牌。
- `/plan` 不接受客户端坐标，只接受短时签名 `optionRef`；服务端重新查询高德 POI 后调用既有 `netrin-route-plan`。

固定三家的 Base URL 与模型 ID 由代码锁定。Qwen 完整兼容地址可由 `AI_ROUTE_QWEN_BASE_URL` 配置，但只接受官方公共地址或 Workspace 专属 `maas.aliyuncs.com/compatible-mode/v1`。文件和自定义端点分别受 `AI_ROUTE_FILE_ENABLED`、`AI_ROUTE_CUSTOM_PROVIDER_ENABLED` 控制。

## 容器与生产

从 Cell 根目录构建：

```text
docker build -f services/netrin-ai-orchestrator/Dockerfile -t netrin-ai-orchestrator:local .
```

生产 Compose 模板为 `compose.production.yml`。它不包含真实主机、域名、凭据或已部署状态：

- 容器仅绑定 `127.0.0.1:8787`；同源 Nginx 模板精确开放 `/v1/ai-route/providers`、`/analyze`、`/plan`、`/model-catalog`、`/provider-probe`，其余子路径返回 404。
- `/analyze` 请求体上限为 1 MiB，`/plan` 为 256 KiB，目录与探测各为 32 KiB；注册、计算、目录、探测使用独立限速区。
- Docker 网络模板使用独立子网；`DOCKER-USER` 模板只允许该网段新建公网 TCP 443 连接，并拒绝私网、保留地址、明文 HTTP 与其他新建外联。部署前必须确认该子网不与现有网络冲突。
- 默认关闭文件与自定义端点；只有在完成隐私、出站网络和资源上限复核后才应开启。
- 受保护接口无令牌应返回 401，未知接口应返回 404。真实 Provider 烟测必须由部署者使用自己的测试账户与 request-scoped key 完成。

部署者须自行完成隐私、第三方服务披露、日志脱敏、反向代理、健康检查和回滚复核。搜索、网页抓取、浏览器自动化、图像识别和完整地图匹配不在本服务范围。

## License

本服务的 Netrin 自有源码采用 `AGPL-3.0-or-later`，与根项目一致。第三方依赖仍受各自许可约束，清单与检查方式见仓库根目录 `THIRD_PARTY_NOTICES.md`。
