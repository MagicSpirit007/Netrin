import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Coordinate } from '../../data/types'

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }))

vi.mock('../supabase', () => ({
  supabase: { functions: { invoke: invokeMock } }
}))

import { clearAmapRouteCache, planRouteSegment } from './routePlanning'

const from: Coordinate = [119.7314, 30.2577]
const to: Coordinate = [119.7323, 30.2584]

describe('Netrin route planning client', () => {
  beforeEach(() => {
    clearAmapRouteCache()
    invokeMock.mockReset()
  })

  it('keeps normalized WGS-84 walking geometry and step metadata', async () => {
    invokeMock.mockResolvedValue({
      data: {
        travelMode: 'walking',
        geometry: { type: 'LineString', coordinates: [from, [119.7318, 30.258], to] },
        distanceM: 128,
        durationS: 96,
        provider: 'amap-walking',
        plannedAt: '2026-07-20T00:00:00.000Z',
        steps: [{
          instruction: '向东步行',
          distanceMeters: 128,
          durationSeconds: 96,
          coordinates: [from, to]
        }]
      },
      error: null
    })

    const segment = await planRouteSegment({
      id: 'walk-test',
      fromPointId: 'a',
      toPointId: 'b',
      from,
      to,
      travelMode: 'walking',
      purpose: 'preview'
    })

    expect(segment.provider).toBe('amap-walking')
    expect(segment.coordSystem).toBe('WGS-84')
    expect(segment.coordinates[0]).toEqual(from)
    expect(segment.coordinates.at(-1)).toEqual(to)
    expect(segment.steps?.[0].instruction).toBe('向东步行')
    expect(segment.durationSeconds).toBe(96)
  })

  it('selects cycling and includes the mode in the cache key', async () => {
    invokeMock.mockResolvedValue({
      data: {
        travelMode: 'cycling',
        geometry: { type: 'LineString', coordinates: [from, to] },
        distanceM: 110,
        durationS: 45,
        provider: 'amap-cycling',
        plannedAt: '2026-07-20T00:00:00.000Z',
        steps: []
      },
      error: null
    })
    const input = { fromPointId: 'a', toPointId: 'b', from, to, travelMode: 'cycling' as const }
    const first = await planRouteSegment(input)
    const second = await planRouteSegment(input)
    expect(first.provider).toBe('amap-cycling')
    expect(second.provider).toBe('amap-cycling')
    expect(invokeMock).toHaveBeenCalledTimes(1)
    expect(invokeMock.mock.calls[0][1].body.travelMode).toBe('cycling')
  })

  it('rejects service failures and does not cache them', async () => {
    invokeMock.mockResolvedValue({ data: null, error: new Error('offline') })
    const input = { fromPointId: 'a', toPointId: 'b', from, to, travelMode: 'walking' as const }
    await expect(planRouteSegment(input)).rejects.toThrow('failed')
    await expect(planRouteSegment(input)).rejects.toThrow('failed')
    expect(invokeMock).toHaveBeenCalledTimes(2)
  })
})
