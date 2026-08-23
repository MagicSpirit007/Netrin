export type RateWindow = { startedAt: number; count: number }

export function contentLengthExceeds(request: Request, maximumBytes: number): boolean {
  const raw = request.headers.get('content-length')
  if (!raw) return false
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > maximumBytes
}

export function trustedProxyClientKey(request: Request): string {
  const candidate = request.headers.get('x-real-ip')?.trim() ?? ''
  if (candidate.length === 0 || candidate.length > 64) return 'untrusted'

  const ipv4 = candidate.split('.')
  if (ipv4.length === 4 && ipv4.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)) {
    return ipv4.map(Number).join('.')
  }
  if (!candidate.includes(':') || !/^[0-9a-f:]+$/i.test(candidate)) return 'untrusted'
  try {
    const parsed = new URL(`http://[${candidate}]/`).hostname
    return parsed.slice(1, -1).toLowerCase()
  } catch {
    return 'untrusted'
  }
}

export function consumeFixedWindowLimit(
  windows: Map<string, RateWindow>,
  key: string,
  now: number,
  windowMs: number,
  limit: number,
  maximumEntries: number
): boolean {
  for (const [candidate, window] of windows) {
    if (now - window.startedAt >= windowMs) windows.delete(candidate)
  }
  if (!windows.has(key) && windows.size >= maximumEntries) return false
  const current = windows.get(key)
  if (!current) {
    windows.set(key, { startedAt: now, count: 1 })
    return true
  }
  if (current.count >= limit) return false
  current.count += 1
  return true
}
