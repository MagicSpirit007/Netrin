import { describe, expect, it } from 'vitest'
import {
  buildAmapRouteUrl,
  normalizeAmapRouteResponse,
  parseRoutePlanRequest,
  wgs84ToGcj02
} from './core'

const request = {
  travelMode: 'cycling' as const,
  from: [119.7314, 30.2577] as [number, number],
  to: [119.7323, 30.2584] as [number, number],
  purpose: 'authoring' as const
}

describe('netrin-route-plan core', () => {
  it('validates the public WGS-84 contract', () => {
    expect(parseRoutePlanRequest(request)).toEqual(request)
    expect(() => parseRoutePlanRequest({ ...request, travelMode: 'electrobike' })).toThrow('invalid-travel-mode')
    expect(() => parseRoutePlanRequest({ ...request, from: [200, 30] })).toThrow('invalid-coordinate')
  })

  it('builds the official v5 bicycling endpoint without exposing the key elsewhere', () => {
    const url = buildAmapRouteUrl(request, 'secret-key')
    expect(url.pathname).toBe('/v5/direction/bicycling')
    expect(url.searchParams.get('key')).toBe('secret-key')
    expect(url.searchParams.get('show_fields')).toBe('cost,navi,polyline')
    const providerFrom = url.searchParams.get('origin')
    expect(providerFrom).toBe(wgs84ToGcj02(request.from).map((value) => value.toFixed(6)).join(','))
  })

  it('normalizes provider GCJ-02 polylines back to WGS-84', () => {
    const gcjFrom = wgs84ToGcj02(request.from)
    const gcjTo = wgs84ToGcj02(request.to)
    const result = normalizeAmapRouteResponse({
      status: '1',
      route: {
        paths: [{
          distance: '130',
          cost: { duration: '95' },
          steps: [{
            instruction: '向东骑行',
            step_distance: '130',
            cost: { duration: '95' },
            polyline: `${gcjFrom[0]},${gcjFrom[1]};${gcjTo[0]},${gcjTo[1]}`
          }]
        }]
      }
    }, request, '2026-07-20T00:00:00.000Z')

    expect(result.provider).toBe('amap-cycling')
    expect(result.geometry.coordinates[0]).toEqual(request.from)
    expect(result.geometry.coordinates.at(-1)).toEqual(request.to)
    expect(result.steps[0].instruction).toBe('向东骑行')
    expect(result.durationS).toBe(95)
  })
})
