import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { AiRouteError } from '../../src/errors.js'
import { RequestLimiter } from '../../src/limits.js'
import { requestIp } from '../../src/server.js'

describe('request identity and limiter retention', () => {
  it('prefers a valid real IP and otherwise uses only the final forwarded hop', () => {
    expect(requestIp(new Request('http://service/', {
      headers: {
        'x-real-ip': '203.0.113.7',
        'x-forwarded-for': '198.51.100.4, 192.0.2.8'
      }
    }))).toBe('203.0.113.7')
    expect(requestIp(new Request('http://service/', {
      headers: {
        'x-real-ip': 'forged-value',
        'x-forwarded-for': '198.51.100.4, 192.0.2.8'
      }
    }))).toBe('192.0.2.8')
    expect(requestIp(new Request('http://service/', {
      headers: { 'x-forwarded-for': 'forged-value' }
    }))).toBe('unknown')
  })

  it('retains normal rate-limit behavior while bounding tracked identities', async () => {
    const limiter = new RequestLimiter({
      userPerMinute: 1,
      ipPerMinute: 1,
      maxTrackedIdentities: 2
    })
    await limiter.run('user-a', '192.0.2.1', 0, async () => 'a')
    await expect(limiter.run('user-a', '192.0.2.1', 1, async () => 'blocked'))
      .rejects.toEqual(expect.objectContaining<Partial<AiRouteError>>({ code: 'AI_RATE_LIMITED' }))
    await limiter.run('user-b', '192.0.2.2', 2, async () => 'b')
    await limiter.run('user-c', '192.0.2.3', 3, async () => 'c')
    await expect(limiter.run('user-a', '192.0.2.1', 4, async () => 'evicted')).resolves.toBe('evicted')
    await expect(limiter.run('user-b', '192.0.2.2', 60_003, async () => 'expired')).resolves.toBe('expired')
  })

  it('overwrites forwarded IP headers for every public Nginx AI route', async () => {
    const config = await readFile(new URL('../../ops/nginx-enabled.conf', import.meta.url), 'utf8')
    expect(config.match(/proxy_set_header X-Forwarded-For \$remote_addr;/g)).toHaveLength(5)
    expect(config).not.toContain('$proxy_add_x_forwarded_for')
  })
})
