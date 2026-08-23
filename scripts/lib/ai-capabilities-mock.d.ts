export const AI_CAPABILITIES_RESPONSE: Record<string, unknown>
export function startAiCapabilitiesMock(options?: { host?: string; port?: number; delayMs?: number }): Promise<{
  url: string
  port: number
  requests: Array<{ method: string; url: string; host: string }>
  close(): Promise<void>
}>
