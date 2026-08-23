import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => {
  const store = new Map<string, unknown>()
  return {
    store,
    getItem: vi.fn(async (key: string) => mocks.store.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: unknown) => {
      mocks.store.set(key, value)
      return value
    }),
    removeItem: vi.fn(async (key: string) => {
      mocks.store.delete(key)
    })
  }
})

vi.mock('localforage', () => ({
  default: {
    getItem: mocks.getItem,
    setItem: mocks.setItem,
    removeItem: mocks.removeItem,
    createInstance: () => ({
      getItem: mocks.getItem,
      setItem: mocks.setItem,
      removeItem: mocks.removeItem
    })
  }
}))

vi.mock('../lib/supabase', () => ({
  isSupabaseConfigured: false,
  supabase: null
}))

import {
  DOWNLOADS_KEY,
  DOWNLOADS_KEY_V2,
  buildDiscoveryRpcArgs,
  buildSubmitRouteV4Args,
  loadDownloads,
  normalizeCommunityRouteDetail,
  normalizeDownloadedRoute,
  normalizeRouteSummary,
  patchDownloadedRoute,
  rankPopularRoutes,
  saveDownloads,
  serializeHighlightPointV4Wire
} from './routeLibrary'

describe('routes_discovery_v1 contract', () => {
  it('normalizes a summary without accepting route geometry or internal fields', () => {
    const route = normalizeRouteSummary({
      id: 'route-1',
      author: 'Author',
      title: { 'zh-CN': '路线', en: 'Route' },
      description: { 'zh-CN': '说明', en: 'Description' },
      downloads: 4,
      likes: 2,
      created_at: '2026-01-02T00:00:00.000Z',
      updated_at: '2026-01-03T00:00:00.000Z',
      travel_mode: 'walking',
      city_adcode: '330100',
      city_name: '杭州',
      distance_m: 1200,
      duration_s: 900,
      difficulty: 'easy',
      is_loop: false,
      tags: ['校园'],
      cover_media_id: 'media-1',
      bbox: { minLng: 119.7, minLat: 30.2, maxLng: 119.8, maxLat: 30.3 },
      point_count: 3,
      geometry: { type: 'LineString', coordinates: [[119.7, 30.2], [119.8, 30.3]] },
      created_by: 'private-user-id'
    })

    expect(route).toMatchObject({
      id: 'route-1',
      travelMode: 'walking',
      cityAdcode: '330100',
      pointCount: 3,
      bounds: { minLng: 119.7, minLat: 30.2, maxLng: 119.8, maxLat: 30.3 }
    })
    expect(route).not.toHaveProperty('geometry')
    expect(route).not.toHaveProperty('created_by')
    expect(route).not.toHaveProperty('likes')
  })

  it('ranks popular routes by downloads then recency without social counters', () => {
    const base = {
      author: 'Author',
      title: { 'zh-CN': '路线', en: 'Route' },
      description: { 'zh-CN': '', en: '' },
      travelMode: 'walking' as const,
      tags: [],
      pointCount: 2
    }
    const ranked = rankPopularRoutes([
      { ...base, id: 'older', downloads: 5, createdAt: '2026-01-01T00:00:00Z' },
      { ...base, id: 'newer', downloads: 5, createdAt: '2026-02-01T00:00:00Z' },
      { ...base, id: 'most', downloads: 8, createdAt: '2025-01-01T00:00:00Z' }
    ], 3)
    expect(ranked.map((route) => route.id)).toEqual(['most', 'newer', 'older'])
    expect(ranked.every((route) => route.recommendationReason === 'popular')).toBe(true)
    expect(ranked[0]).not.toHaveProperty('likes')
  })

  it('builds a stable tuple cursor and full filter arguments', () => {
    expect(buildDiscoveryRpcArgs({
      cursor: { createdAt: '2026-01-02T00:00:00.000Z', id: 'route-9' },
      limit: 99,
      cityAdcode: '330100',
      travelMode: 'cycling',
      minDistanceM: 1000,
      maxDistanceM: 5000,
      minDurationS: 600,
      maxDurationS: 3600,
      difficulty: 'moderate',
      tags: ['校园', '植物'],
      bounds: { minLng: 119, minLat: 30, maxLng: 120, maxLat: 31 }
    })).toEqual({
      p_cursor_created_at: '2026-01-02T00:00:00.000Z',
      p_cursor_id: 'route-9',
      p_limit: 50,
      p_city_adcode: '330100',
      p_travel_mode: 'cycling',
      p_min_distance_m: 1000,
      p_max_distance_m: 5000,
      p_min_duration_s: 600,
      p_max_duration_s: 3600,
      p_difficulty: 'moderate',
      p_tags: ['校园', '植物'],
      p_min_lng: 119,
      p_min_lat: 30,
      p_max_lng: 120,
      p_max_lat: 31
    })
  })
})

describe('get_route_detail_v1 normalization', () => {
  it('accepts a cycling WGS-84 route and preserves ordered highlights', () => {
    const route = normalizeCommunityRouteDetail({
      id: '00000000-0000-4000-8000-000000000001',
      author: 'author',
      title: { 'zh-CN': '骑行路线', en: 'Cycling route' },
      description: { 'zh-CN': '说明', en: 'Description' },
      downloads: 2,
      likes: 3,
      travelMode: 'cycling',
      geometrySource: 'amap-planned',
      geometry: {
        type: 'LineString',
        coordinates: [[98.5, 39.7], [98.51, 39.71]]
      },
      distanceM: 1300,
      durationS: 480,
      tags: ['河岸'],
      highlights: [
        { id: 'p2', order: 2, lng: 98.51, lat: 39.71, highlightTitle: '终点', media: [] },
        {
          id: 'p1',
          order: 1,
          lng: 98.5,
          lat: 39.7,
          highlightTitle: '起点',
          media: [{ id: 'm1', order: 1, mimeType: 'image/jpeg' }]
        }
      ]
    })

    expect(route?.travelMode).toBe('cycling')
    expect(route?.geometry?.coordinates).toEqual([[98.5, 39.7], [98.51, 39.71]])
    expect(route?.stops.map((stop) => stop.highlightTitle)).toEqual(['起点', '终点'])
    expect(route?.stops[0].media[0].id).toBe('m1')
    expect(route).not.toHaveProperty('likes')
  })

  it('rejects detail without confirmed geometry', () => {
    expect(normalizeCommunityRouteDetail({
      id: 'r1',
      title: { 'zh-CN': '路线', en: 'Route' },
      travelMode: 'walking',
      geometrySource: 'amap-planned',
      geometry: null,
      highlights: []
    })).toBeUndefined()
  })
})

describe('highlight wire serializers', () => {
  it('v4 omits speciesName', () => {
    const wire = serializeHighlightPointV4Wire({
      id: 'p1',
      order: 1,
      lng: 120,
      lat: 30,
      highlightTitle: '银杏'
    })
    expect(wire.highlightTitle).toBe('银杏')
    expect(wire).not.toHaveProperty('speciesName')
  })
})

describe('submit_route_v4 adapter builder', () => {
  it('builds args with highlightTitle-only points and empty tags array', () => {
    const args = buildSubmitRouteV4Args({
      routeId: '00000000-0000-4000-8000-000000000001',
      title: { 'zh-CN': '路线', en: 'Route' },
      description: { 'zh-CN': '', en: '' },
      points: [
        { id: 'p1', order: 1, lng: 98.5, lat: 39.7, highlightTitle: 'A' },
        { id: 'p2', order: 2, lng: 98.51, lat: 39.71, highlightTitle: 'B' }
      ],
      meta: {
        travelMode: 'walking',
        geometry: {
          type: 'LineString',
          coordinates: [[98.5, 39.7], [98.51, 39.71]]
        },
        geometrySource: 'field-recorded',
        tags: []
      }
    })
    expect(args.p_meta.geometrySource).toBe('field-recorded')
    expect(args.p_meta.tags).toEqual([])
    expect(args.p_points).toHaveLength(2)
    expect(args.p_points[0].highlightTitle).toBe('A')
    expect(args.p_points[0]).not.toHaveProperty('speciesName')
    expect(args.p_points[1].highlightTitle).toBe('B')
  })

  it('rejects missing geometry', () => {
    expect(() =>
      buildSubmitRouteV4Args({
        routeId: 'r1',
        title: { 'zh-CN': '', en: '' },
        description: { 'zh-CN': '', en: '' },
        points: [
          { id: 'p1', order: 1, lng: 1, lat: 1 },
          { id: 'p2', order: 2, lng: 2, lat: 2 }
        ],
        meta: {
          travelMode: 'walking',
          geometry: { type: 'LineString', coordinates: [[1, 1]] } as never,
          geometrySource: 'field-recorded'
        }
      })
    ).toThrow(/LineString/)
  })
})

describe('downloads v3 migration', () => {
  beforeEach(() => {
    mocks.store.clear()
    mocks.getItem.mockClear()
    mocks.setItem.mockClear()
    mocks.removeItem.mockClear()
  })

  it('migrates v2 localforage entries to v3 with highlightTitle only', async () => {
    mocks.store.set(DOWNLOADS_KEY_V2, [{
      id: 'route-legacy',
      remoteRouteId: 'route-legacy',
      title: { 'zh-CN': '旧路线', en: 'Old' },
      description: { 'zh-CN': '说明', en: 'Desc' },
      author: 'author',
      downloadedAt: '2026-01-01T00:00:00.000Z',
      isLocalEdited: true,
      localEditedAt: '2026-01-02T00:00:00.000Z',
      remoteUpdatedAt: '2025-12-01T00:00:00.000Z',
      stops: [{
        id: 'stop-1',
        order: 4,
        location: [98.5, 39.7],
        title: { 'zh-CN': '点', en: 'P' },
        description: { 'zh-CN': '注', en: 'N' },
        speciesName: '旧物种',
        media: [{ id: 'media-1', order: 2, storagePath: 'routes/u/r/p/1.jpg' }]
      }]
    }])

    const routes = await loadDownloads()

    expect(routes).toHaveLength(1)
    expect(routes[0].id).toBe('route-legacy')
    expect(routes[0].isLocalEdited).toBe(true)
    expect(routes[0].localEditedAt).toBe('2026-01-02T00:00:00.000Z')
    expect(routes[0].remoteRouteId).toBe('route-legacy')
    expect(routes[0].remoteUpdatedAt).toBe('2025-12-01T00:00:00.000Z')
    expect(routes[0].stops[0].order).toBe(4)
    expect(routes[0].stops[0].media[0].id).toBe('media-1')
    expect(routes[0].stops[0].media[0].order).toBe(2)
    expect(routes[0].stops[0].highlightTitle).toBe('旧物种')
    expect(routes[0].stops[0]).not.toHaveProperty('speciesName')

    expect(mocks.store.has(DOWNLOADS_KEY)).toBe(true)
    expect(mocks.store.has(DOWNLOADS_KEY_V2)).toBe(false)
    const persisted = mocks.store.get(DOWNLOADS_KEY) as Array<{
      stops: Array<Record<string, unknown>>
    }>
    expect(JSON.stringify(persisted)).not.toContain('speciesName')
    expect(persisted[0].stops[0]).not.toHaveProperty('url')
  })

  it('normalizeDownloadedRoute strips speciesName and resolved urls', () => {
    const route = normalizeDownloadedRoute({
      id: 'r1',
      title: { 'zh-CN': 't', en: 't' },
      description: { 'zh-CN': '', en: '' },
      author: 'a',
      downloadedAt: '2026-01-01T00:00:00.000Z',
      stops: [{
        id: 's1',
        order: 1,
        location: [1, 2],
        title: { 'zh-CN': 'x', en: 'x' },
        description: { 'zh-CN': '', en: '' },
        speciesName: 'legacy',
        media: [{ id: 'm1', order: 1, url: 'https://example.test/x', storagePath: 'p' }]
      }]
    })
    expect(route.stops[0].highlightTitle).toBe('legacy')
    expect(route.stops[0]).not.toHaveProperty('speciesName')
    expect(route.stops[0].media[0].url).toBeUndefined()
  })

  it('preserves route fields and converts legacy image package metadata to geometry/text v2', async () => {
    const legacyOfflinePackage = {
      version: 1 as const,
      packagedAt: '2026-07-20T00:00:00.000Z',
      mediaSelection: { selectedMediaIds: ['media-1'] },
      geometryTextBytes: 240,
      knownImageBytes: 4096,
      unknownImageCount: 0
    }
    mocks.store.set(DOWNLOADS_KEY, [{
      id: 'route-full',
      remoteRouteId: 'route-full',
      title: { 'zh-CN': '全量', en: 'Full' },
      description: { 'zh-CN': '说明', en: 'Desc' },
      author: 'author',
      travelMode: 'cycling',
      geometry: {
        type: 'LineString',
        coordinates: [[98.5, 39.7], [98.51, 39.71]]
      },
      geometrySource: 'amap-planned',
      cityAdcode: '620900',
      cityName: '酒泉',
      distanceM: 1200,
      durationS: 600,
      metricsUpdatedAt: '2026-07-19T00:00:00.000Z',
      difficulty: 'moderate',
      isLoop: true,
      tags: ['desert'],
      coverMediaId: 'media-1',
      offlineMediaAllowed: true,
      offlinePackage: legacyOfflinePackage,
      remoteUpdatedAt: '2026-07-18T00:00:00.000Z',
      downloadedAt: '2026-07-20T12:00:00.000Z',
      stops: [{
        id: 'stop-1',
        order: 1,
        location: [98.5, 39.7],
        title: { 'zh-CN': '点', en: 'P' },
        description: { 'zh-CN': '注', en: 'N' },
        highlightTitle: '胡杨',
        media: [{
          id: 'media-1',
          order: 1,
          storagePath: 'routes/u/r/p/1.jpg',
          url: 'https://signed.example/1.jpg',
          sizeBytes: 4096
        }]
      }]
    }])

    const routes = await loadDownloads()
    expect(routes[0].travelMode).toBe('cycling')
    expect(routes[0].geometry?.coordinates).toHaveLength(2)
    expect(routes[0].geometrySource).toBe('amap-planned')
    expect(routes[0].cityAdcode).toBe('620900')
    expect(routes[0].cityName).toBe('酒泉')
    expect(routes[0].distanceM).toBe(1200)
    expect(routes[0].durationS).toBe(600)
    expect(routes[0].metricsUpdatedAt).toBe('2026-07-19T00:00:00.000Z')
    expect(routes[0].difficulty).toBe('moderate')
    expect(routes[0].isLoop).toBe(true)
    expect(routes[0].tags).toEqual(['desert'])
    expect(routes[0].coverMediaId).toBe('media-1')
    expect(routes[0]).not.toHaveProperty('offlineMediaAllowed')
    const offlinePackage = {
      version: 2 as const,
      packagedAt: '2026-07-20T00:00:00.000Z',
      geometryTextBytes: 240
    }
    expect(routes[0].offlinePackage).toEqual(offlinePackage)
    expect(routes[0].remoteUpdatedAt).toBe('2026-07-18T00:00:00.000Z')
    expect(routes[0].stops[0].media[0].sizeBytes).toBe(4096)
    expect(routes[0].stops[0].media[0].url).toBeUndefined()

    const patched = patchDownloadedRoute(routes[0], {
      title: { 'zh-CN': '改名', en: 'Renamed' }
    })
    expect(patched.geometry?.type).toBe('LineString')
    expect(patched.travelMode).toBe('cycling')
    expect(patched.offlinePackage).toEqual(offlinePackage)
    expect(patched).not.toHaveProperty('offlineMediaAllowed')
    expect(patched.coverMediaId).toBe('media-1')
    expect(patched.isLocalEdited).toBe(true)

    await saveDownloads([patched])
    const persisted = mocks.store.get(DOWNLOADS_KEY) as Array<Record<string, unknown>>
    expect(DOWNLOADS_KEY).toBe('netrin.downloaded.v3')
    expect(JSON.stringify(persisted)).not.toContain('speciesName')
    expect(JSON.stringify(persisted)).not.toContain('https://signed.example')
    expect(persisted[0].travelMode).toBe('cycling')
    expect(persisted[0]).not.toHaveProperty('offlineMediaAllowed')
    expect((persisted[0].stops as Array<{ media: Array<{ sizeBytes?: number; url?: string }> }>)[0]
      .media[0].sizeBytes).toBe(4096)
    expect((persisted[0].stops as Array<{ media: Array<{ url?: string }> }>)[0]
      .media[0].url).toBeUndefined()
  })
})
