import { describe, expect, it, vi } from 'vitest'
import { gcj02ToWgs84 } from '../../../../supabase/functions/netrin-route-plan/core.js'
import { AmapPoiClient } from '../../src/tools/amapPoi.js'
import { NetrinRoutePlanClient } from '../../src/tools/routePlanClient.js'

function requestUrl(input: string | URL | Request): URL {
  return new URL(input instanceof Request ? input.url : input.toString())
}

describe('trusted provider boundaries', () => {
  it('keeps AMap coordinates away from the Agent and converts GCJ-02 to WGS-84', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = requestUrl(input)
      expect(url.origin).toBe('https://restapi.amap.com')
      expect(url.searchParams.get('key')).toBe('server-amap-key')
      if (url.pathname.endsWith('/text')) {
        expect(url.searchParams.get('keywords')).toBe('杭州植物园')
        expect(url.searchParams.get('region')).toBe('杭州市')
      } else {
        expect(url.searchParams.get('id')).toBe('B024')
      }
      return Response.json({
        status: '1',
        pois: [{
          id: 'B024',
          name: '杭州植物园',
          type: '风景名胜',
          adname: '西湖区',
          address: '桃源岭1号',
          location: '120.117000,30.263000'
        }]
      })
    }) as unknown as typeof fetch
    const client = new AmapPoiClient('server-amap-key', fetchImpl)

    const options = await client.search('杭州植物园', '杭州市')
    expect(options).toHaveLength(1)
    expect(options[0]).not.toHaveProperty('poiId')
    expect(options[0]).not.toHaveProperty('wgs84')
    const trusted = client.resolveAgentRef(options[0]!.poiRef)
    expect(trusted?.wgs84).toEqual(gcj02ToWgs84([120.117, 30.263]))

    const refreshed = await client.getById('B024', '杭州市')
    expect(refreshed).toMatchObject({ poiId: 'B024', name: '杭州植物园' })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('retries one transient AMap QPS rejection without exposing provider details', async () => {
    let calls = 0
    const fetchImpl = vi.fn(async () => {
      calls += 1
      if (calls === 1) {
        return Response.json({
          status: '0',
          info: 'CUQPS_HAS_EXCEEDED_THE_LIMIT',
          infocode: '10021'
        })
      }
      return Response.json({
        status: '1',
        pois: [{
          id: 'B025',
          name: '洛浦公园',
          location: '112.460000,34.670000'
        }]
      })
    }) as unknown as typeof fetch
    const client = new AmapPoiClient('server-amap-key', fetchImpl)

    await expect(client.search('公园', '洛阳市')).resolves.toHaveLength(1)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('plans every adjacent segment through the existing route-plan contract', async () => {
    const segmentCoordinates = [
      [[120.1, 30.1], [120.2, 30.2]],
      [[120.2, 30.2], [120.3, 30.3]]
    ] as const
    let callIndex = 0
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as {
        from: [number, number]
        to: [number, number]
        travelMode: string
        purpose: string
      }
      expect(request).toMatchObject({
        from: segmentCoordinates[callIndex]![0],
        to: segmentCoordinates[callIndex]![1],
        travelMode: 'walking',
        purpose: 'authoring'
      })
      const coordinates = segmentCoordinates[callIndex++]
      return Response.json({
        provider: 'amap',
        geometry: { type: 'LineString', coordinates },
        distanceM: 1_000,
        durationS: 600
      })
    }) as unknown as typeof fetch
    const client = new NetrinRoutePlanClient(
      'https://supabase.example/functions/v1/netrin-route-plan',
      'public-anon-key',
      fetchImpl
    )

    const result = await client.plan(
      [[120.1, 30.1], [120.2, 30.2], [120.3, 30.3]],
      'walking',
      'user-jwt'
    )
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(result).toEqual({
      geometry: {
        type: 'LineString',
        coordinates: [[120.1, 30.1], [120.2, 30.2], [120.3, 30.3]]
      },
      distanceMeters: 2_000,
      durationMinutes: 20
    })
  })
})
