import { AiRouteError } from './errors.js'

export class RequestLimiter {
  readonly #userPerMinute: number
  readonly #ipPerMinute: number
  readonly #activeUsers = new Set<string>()
  readonly #recentUsers = new Map<string, number[]>()
  readonly #recentIps = new Map<string, number[]>()
  readonly #maxTrackedIdentities: number
  #nextSweepAt = 0

  constructor(limits: {
    userPerMinute?: number
    ipPerMinute?: number
    maxTrackedIdentities?: number
  } = {}) {
    this.#userPerMinute = limits.userPerMinute ?? 6
    this.#ipPerMinute = limits.ipPerMinute ?? 20
    this.#maxTrackedIdentities = Math.max(1, limits.maxTrackedIdentities ?? 10_000)
  }

  async run<T>(userId: string, ip: string, now: number, operation: () => Promise<T>): Promise<T> {
    this.#sweep(now)
    if (this.#activeUsers.has(userId)) throw new AiRouteError('AI_CONCURRENCY_LIMIT', 429)
    const recentUser = (this.#recentUsers.get(userId) ?? []).filter((time) => now - time < 60_000)
    const recentIp = (this.#recentIps.get(ip) ?? []).filter((time) => now - time < 60_000)
    if (recentUser.length >= this.#userPerMinute || recentIp.length >= this.#ipPerMinute) {
      throw new AiRouteError('AI_RATE_LIMITED', 429)
    }
    recentUser.push(now)
    recentIp.push(now)
    this.#remember(this.#recentUsers, userId, recentUser)
    this.#remember(this.#recentIps, ip, recentIp)
    this.#activeUsers.add(userId)
    try {
      return await operation()
    } finally {
      this.#activeUsers.delete(userId)
    }
  }

  #remember(map: Map<string, number[]>, key: string, timestamps: number[]): void {
    if (!map.has(key) && map.size >= this.#maxTrackedIdentities) {
      const oldest = map.keys().next().value as string | undefined
      if (oldest !== undefined) map.delete(oldest)
    }
    map.set(key, timestamps)
  }

  #sweep(now: number): void {
    if (now < this.#nextSweepAt) return
    this.#nextSweepAt = now + 60_000
    for (const map of [this.#recentUsers, this.#recentIps]) {
      for (const [key, timestamps] of map) {
        const recent = timestamps.filter((time) => now - time < 60_000)
        if (recent.length > 0) map.set(key, recent)
        else map.delete(key)
      }
    }
  }
}
