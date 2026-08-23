import { describe, expect, it } from 'vitest'
import { loadConfig } from '../../src/config.js'

const base = {
  PORT: '8787',
  SUPABASE_URL: 'https://supabase.example',
  SUPABASE_ANON_KEY: 'anon',
  AMAP_WEB_SERVICE_KEY: 'amap',
  AI_ROUTE_OPTION_SIGNING_KEY: 'a-signing-secret-that-is-longer-than-32-characters'
}

describe('AI input and provider feature flags', () => {
  it('keeps file and custom providers dark by default and enables only explicit true', () => {
    const defaults = loadConfig(base)
    expect(defaults.qwenBaseUrl).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1')
    expect(defaults.fileInputEnabled).toBe(false)
    expect(defaults.customProviderEnabled).toBe(false)
    const enabled = loadConfig({
      ...base,
      AI_ROUTE_FILE_ENABLED: 'true',
      AI_ROUTE_CUSTOM_PROVIDER_ENABLED: 'TRUE'
    })
    expect(enabled.fileInputEnabled).toBe(true)
    expect(enabled.customProviderEnabled).toBe(true)
    expect(loadConfig({ ...base, AI_ROUTE_FILE_ENABLED: '1' }).fileInputEnabled).toBe(false)
  })

  it('accepts only a complete trusted Qwen compatible-mode endpoint', () => {
    const workspaceUrl = 'https://llm-workspace123.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/'
    expect(loadConfig({ ...base, AI_ROUTE_QWEN_BASE_URL: workspaceUrl }).qwenBaseUrl)
      .toBe(workspaceUrl.slice(0, -1))

    for (const invalid of [
      'http://llm-workspace123.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
      'https://llm-workspace123.cn-beijing.maas.aliyuncs.com:8443/compatible-mode/v1',
      'https://llm-workspace123.cn-beijing.maas.aliyuncs.com/v1',
      'https://llm-workspace123.cn-beijing.maas.aliyuncs.com/compatible-mode/v1?target=other',
      'https://llm-workspace123.cn-beijing.maas.aliyuncs.com.evil.example/compatible-mode/v1'
    ]) {
      expect(() => loadConfig({ ...base, AI_ROUTE_QWEN_BASE_URL: invalid })).toThrow()
    }
  })
})
