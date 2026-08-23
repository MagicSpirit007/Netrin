import type { ProviderCapabilities } from '../contracts/aiRoute.js'
import { AiRouteError } from '../errors.js'

export type RegisteredProvider = ProviderCapabilities & {
  baseUrl: string
}

const DEEPSEEK_CN: RegisteredProvider = {
  providerId: 'deepseek-cn',
  displayName: 'DeepSeek',
  baseUrl: 'https://api.deepseek.com',
  allowedModelIds: ['deepseek-v4-flash', 'deepseek-v4-pro'],
  modelSource: 'fixed',
  toolCalling: true,
  maxContextTokens: 131_072,
  supportsThinking: true
}

const QWEN_CN: RegisteredProvider = {
  providerId: 'qwen-cn',
  displayName: 'Qwen',
  baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode',
  allowedModelIds: [
    'qwen3.8-max',
    'qwen3.7-max',
    'qwen3.7-plus',
    'qwen3.7-flash',
    'qwen3.6-plus',
    'qwen3.6-flash'
  ],
  modelSource: 'fixed',
  toolCalling: true,
  maxContextTokens: 1_000_000,
  supportsThinking: true
}

const KIMI_CN: RegisteredProvider = {
  providerId: 'kimi-cn',
  displayName: 'Kimi',
  baseUrl: 'https://api.moonshot.cn',
  allowedModelIds: ['kimi-k3', 'kimi-k2.7-code-highspeed', 'kimi-k2.7-code', 'kimi-k2.6'],
  modelSource: 'fixed',
  toolCalling: true,
  maxContextTokens: 1_000_000,
  supportsThinking: true
}

const REGISTRY = new Map<string, RegisteredProvider>([
  [DEEPSEEK_CN.providerId, DEEPSEEK_CN],
  [QWEN_CN.providerId, QWEN_CN],
  [KIMI_CN.providerId, KIMI_CN]
])

export function listProviderCapabilities(): ProviderCapabilities[] {
  return [...REGISTRY.values()]
    .map(({ baseUrl: _baseUrl, ...capabilities }) => ({
    ...capabilities,
    allowedModelIds: [...capabilities.allowedModelIds]
    }))
}

export function requireRegisteredProvider(
  providerId: string,
  modelId: string
): RegisteredProvider {
  const provider = REGISTRY.get(providerId)
  if (!provider) throw new AiRouteError('AI_PROVIDER_NOT_ALLOWED', 400)
  if (!provider.allowedModelIds.includes(modelId)) {
    throw new AiRouteError('AI_MODEL_NOT_ALLOWED', 400)
  }
  if (!provider.toolCalling) {
    throw new AiRouteError('AI_MODEL_TOOL_CALLING_REQUIRED', 400)
  }
  return { ...provider }
}
