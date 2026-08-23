import { describe, expect, it } from 'vitest'
import { buildLocalRouteCatalog, filterLocalRouteCatalog } from './localRouteCatalog'
import type { DownloadedRoute, RouteDraft } from './types'

function draft(overrides: Partial<RouteDraft> = {}): RouteDraft {
  return {
    version: 5,
    id: 'draft-1',
    authoringMode: 'field',
    title: '西湖晨行',
    note: '自己的路线',
    points: [{
      id: 'point-1',
      index: 1,
      raw: [120.15, 30.25],
      final: [120.15, 30.25],
      snapped: false,
      text: '',
      media: []
    }],
    snapToRoads: true,
    travelMode: 'walking',
    geometryStatus: 'missing',
    cityAdcode: '330100',
    cityName: '杭州市',
    tags: ['湖景'],
    syncState: 'local',
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-02T00:00:00.000Z',
    ...overrides
  }
}

function download(): DownloadedRoute {
  return {
    id: 'download-1',
    title: { 'zh-CN': '旧城漫步', en: 'Old Town Walk' },
    description: { 'zh-CN': '', en: '' },
    author: '作者',
    stops: [{
      id: 'stop-1',
      order: 1,
      location: [121.47, 31.23],
      title: { 'zh-CN': '起点', en: 'Start' },
      description: { 'zh-CN': '', en: '' },
      media: []
    }],
    travelMode: 'walking',
    cityAdcode: '310000',
    cityName: '上海市',
    downloadedAt: '2026-06-01T00:00:00.000Z'
  }
}

describe('local route catalog', () => {
  it('restores created routes with at least one point and skips empty drafts', () => {
    const routes = buildLocalRouteCatalog([download()], [
      draft(),
      draft({ id: 'empty', points: [] })
    ])

    expect(routes.map((route) => route.id)).toEqual(['draft-1', 'download-1'])
    expect(routes[0]).toMatchObject({
      localSource: 'draft',
      pointCount: 1,
      bounds: {
        minLng: 120.15,
        minLat: 30.25,
        maxLng: 120.15,
        maxLat: 30.25
      }
    })
  })

  it('filters local routes by the AMap city selection with a city-name fallback', () => {
    const routes = buildLocalRouteCatalog([download()], [draft({ cityAdcode: undefined })])
    const filtered = filterLocalRouteCatalog(routes, {
      cityAdcode: '330100',
      tags: ['湖景']
    }, '杭州')

    expect(filtered.map((route) => route.id)).toEqual(['draft-1'])
  })
})
