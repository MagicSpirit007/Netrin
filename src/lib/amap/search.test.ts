import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./loadAmap', () => ({ loadAmap: vi.fn() }))
import { loadAmap } from './loadAmap'
import {
  centerOfBounds,
  normalizeAmapCities,
  normalizeAmapPoi,
  rankAmapPlaceResults,
  searchAmap,
  searchAmapCities,
  searchAmapPlaces,
  searchRadiusForBounds
} from './search'
import type {
  AMapNamespace,
  AmapDistrictSearchInstance,
  AmapPlaceSearchInstance
} from './types'

type PlaceSearch = AmapPlaceSearchInstance['search']
type PlaceSearchNearBy = NonNullable<AmapPlaceSearchInstance['searchNearBy']>
type PlaceSearchInBounds = NonNullable<AmapPlaceSearchInstance['searchInBounds']>
type DistrictSearch = AmapDistrictSearchInstance['search']

function mockAmapSearches({
  placeSearch,
  placeSearchNearBy,
  placeSearchInBounds,
  districtSearch,
  onPlaceOptions,
  onDistrictOptions
}: {
  placeSearch: PlaceSearch
  placeSearchNearBy?: PlaceSearchNearBy
  placeSearchInBounds?: PlaceSearchInBounds
  districtSearch: DistrictSearch
  onPlaceOptions?: (options: Record<string, unknown> | undefined) => void
  onDistrictOptions?: (options: Record<string, unknown> | undefined) => void
}) {
  vi.mocked(loadAmap).mockResolvedValue({
    PlaceSearch: class {
      constructor(options?: Record<string, unknown>) {
        onPlaceOptions?.(options)
      }

      search = placeSearch
      searchNearBy = placeSearchNearBy
      searchInBounds = placeSearchInBounds
    },
    DistrictSearch: class {
      constructor(options?: Record<string, unknown>) {
        onDistrictOptions?.(options)
      }

      search = districtSearch
    }
  } as unknown as AMapNamespace)
}

describe('AMap search provider boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('converts a GCJ-02 place to a WGS-84 result', () => {
    const result = normalizeAmapPoi({
      id: 'poi-1',
      name: '校园北门',
      adcode: '330100',
      cityname: '杭州市',
      location: [120.2, 30.3]
    }, 0)
    expect(result?.kind).toBe('place')
    expect(result?.coordinate).toBeDefined()
    expect(result?.coordinate).not.toEqual([120.2, 30.3])
    expect(result).not.toHaveProperty('gcj02')
  })

  it('accepts literal and string-valued provider coordinates but rejects non-finite values', () => {
    const literal = normalizeAmapPoi({
      id: 'literal',
      name: '酒泉万达广场',
      location: { lng: '98.4939', lat: '39.7329' }
    }, 0)
    const invalid = normalizeAmapPoi({
      id: 'invalid',
      name: '损坏坐标',
      location: { lng: undefined, lat: undefined }
    }, 1)

    expect(literal?.coordinate?.every(Number.isFinite)).toBe(true)
    expect(invalid?.coordinate).toBeUndefined()
  })

  it('returns only city-level district matches with public adcodes', () => {
    const results = normalizeAmapCities([{ name: '浙江省', level: 'province', districtList: [
      {
        name: '杭州市',
        level: 'city',
        adcode: '330100',
        center: [120.2, 30.3],
        boundaries: [[[120.1, 30.2], [120.3, 30.4]]]
      },
      { name: '西湖区', level: 'district', adcode: '330106', center: [120.1, 30.2] }
    ] }])
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({ kind: 'city', cityAdcode: '330100', cityName: '杭州市' })
    expect(results[0].bounds).toMatchObject({
      minLng: expect.any(Number),
      minLat: expect.any(Number),
      maxLng: expect.any(Number),
      maxLat: expect.any(Number)
    })
  })

  it('merges successful city and place callbacks', async () => {
    mockAmapSearches({
      districtSearch: (_keyword, callback) => callback('complete', {
        districtList: [{
          name: '杭州市',
          level: 'city',
          adcode: '330100',
          center: [120.2, 30.3]
        }]
      }),
      placeSearch: (_keyword, callback) => callback('complete', {
        poiList: {
          pois: [{
            id: 'poi-west-lake',
            name: '西湖风景名胜区',
            adcode: '330100',
            cityname: '杭州市',
            location: [120.14, 30.25]
          }]
        }
      })
    })

    const results = await searchAmap('杭州市')

    expect(results).toHaveLength(2)
    expect(results.map((item) => item.kind)).toEqual(['city', 'place'])
  })

  it('treats no_data as a completed empty search', async () => {
    mockAmapSearches({
      districtSearch: (_keyword, callback) => callback('no_data', { info: 'NO_DATA' }),
      placeSearch: (_keyword, callback) => callback('no_data', { info: 'NO_DATA' })
    })

    await expect(searchAmap('不存在的地点')).resolves.toEqual([])
  })

  it('reports a failure when the place provider fails and city search has no result', async () => {
    mockAmapSearches({
      districtSearch: (_keyword, callback) => callback('no_data', { info: 'NO_DATA' }),
      placeSearch: (_keyword, callback) => callback('error', { info: 'SERVICE_NOT_AVAILABLE' })
    })

    await expect(searchAmap('万达广场')).rejects.toThrow('AMap search unavailable')
  })

  it('queries administrative names at city level without unnecessary descendants', async () => {
    let districtOptions: Record<string, unknown> | undefined
    mockAmapSearches({
      districtSearch: (_keyword, callback) => callback('no_data', { info: 'NO_DATA' }),
      placeSearch: (_keyword, callback) => callback('no_data', { info: 'NO_DATA' }),
      onDistrictOptions: (options) => {
        districtOptions = options
      }
    })

    await searchAmapCities('杭州市')

    expect(districtOptions).toEqual({
      level: 'city',
      subdistrict: 0,
      extensions: 'all'
    })
  })

  it('biases place results to the draft city without restricting nationwide fallback', async () => {
    let placeOptions: Record<string, unknown> | undefined
    mockAmapSearches({
      districtSearch: (_keyword, callback) => callback('no_data', { info: 'NO_DATA' }),
      placeSearch: (_keyword, callback) => callback('no_data', { info: 'NO_DATA' }),
      onPlaceOptions: (options) => {
        placeOptions = options
      }
    })

    await searchAmapPlaces('公园', { city: '310000' })

    expect(placeOptions).toEqual({
      pageSize: 8,
      pageIndex: 1,
      city: '310000',
      citylimit: false
    })
  })

  it('ranks visible POIs before nearer out-of-view results, then by center distance', () => {
    const bounds = { minLng: 99, minLat: 39, maxLng: 101, maxLat: 41 }
    const results = rankAmapPlaceResults([
      {
        id: 'outside-near',
        providerId: 'outside-near',
        kind: 'place',
        label: 'Outside',
        coordinate: [101.01, 40]
      },
      {
        id: 'inside-far',
        providerId: 'inside-far',
        kind: 'place',
        label: 'Inside far',
        coordinate: [100.8, 40]
      },
      {
        id: 'inside-near',
        providerId: 'inside-near',
        kind: 'place',
        label: 'Inside near',
        coordinate: [100.1, 40]
      },
      {
        id: 'inside-near-duplicate',
        providerId: 'inside-near',
        kind: 'place',
        label: 'Duplicate',
        coordinate: [100.1, 40]
      }
    ], { bounds, center: [100, 40] })

    expect(results.map((item) => item.id)).toEqual([
      'inside-near',
      'inside-far',
      'outside-near'
    ])
  })

  it('caps a nationwide viewport radius at the AMap 50 km limit', () => {
    const bounds = { minLng: 73, minLat: 18, maxLng: 135, maxLat: 54 }
    expect(centerOfBounds(bounds)).toEqual([104, 36])
    expect(searchRadiusForBounds(bounds)).toBe(50000)
  })

  it('searches the visible bounds, nearby radius, then city-biased keyword fallback', async () => {
    const calls: string[] = []
    mockAmapSearches({
      districtSearch: (_keyword, callback) => callback('no_data', { info: 'NO_DATA' }),
      placeSearchInBounds: (_keyword, _bounds, callback) => {
        calls.push('bounds')
        callback('complete', {
          poiList: { pois: [{ id: 'visible', name: '视野内万达', location: [100.1, 40] }] }
        })
      },
      placeSearchNearBy: (_keyword, _center, radius, callback) => {
        calls.push(`nearby:${radius}`)
        callback('complete', {
          poiList: { pois: [{ id: 'nearby', name: '附近万达', location: [100.3, 40] }] }
        })
      },
      placeSearch: (_keyword, callback) => {
        calls.push('keyword')
        callback('complete', {
          poiList: {
            pois: [
              { id: 'visible', name: '视野内万达', location: [100.1, 40] },
              { id: 'fallback', name: '城市内万达', location: [101.5, 40] },
              { id: 'missing-coordinate', name: '无坐标万达' }
            ]
          }
        })
      }
    })

    const results = await searchAmapPlaces('万达广场', {
      city: '620900',
      bounds: { minLng: 99, minLat: 39, maxLng: 101, maxLat: 41 },
      center: [100, 40]
    })

    expect(calls[0]).toBe('bounds')
    expect(calls[1]).toMatch(/^nearby:/)
    expect(calls[2]).toBe('keyword')
    expect(results.map((item) => item.providerId)).toEqual([
      'visible',
      'nearby',
      'fallback'
    ])
    expect(results.some((item) => item.providerId === 'missing-coordinate')).toBe(false)
  })

  it('returns the successful provider after the other provider times out', async () => {
    vi.useFakeTimers()
    mockAmapSearches({
      districtSearch: (_keyword, callback) => callback('complete', {
        districtList: [{
          name: '杭州市',
          level: 'city',
          adcode: '330100',
          center: [120.2, 30.3]
        }]
      }),
      placeSearch: () => undefined
    })

    const resultPromise = searchAmap('杭州市')
    await vi.runAllTimersAsync()

    await expect(resultPromise).resolves.toMatchObject([
      { kind: 'city', cityAdcode: '330100', cityName: '杭州市' }
    ])
  })

  it('rejects after the deadline when both providers never call back', async () => {
    vi.useFakeTimers()
    mockAmapSearches({
      districtSearch: () => undefined,
      placeSearch: () => undefined
    })

    const assertion = expect(searchAmap('杭州市')).rejects.toThrow('AMap search unavailable')
    await vi.runAllTimersAsync()
    await assertion
  })

  it('rejects synchronous provider errors without waiting for the deadline', async () => {
    mockAmapSearches({
      districtSearch: (_keyword, callback) => callback('no_data', { info: 'NO_DATA' }),
      placeSearch: () => {
        throw new Error('provider exploded')
      }
    })

    await expect(searchAmapPlaces('杭州市')).rejects.toThrow('provider exploded')
  })
})
