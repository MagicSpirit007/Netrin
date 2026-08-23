import { describe, expect, it, vi } from 'vitest'
import {
  buildOfflinePackageMeta,
  estimateGeometryTextBytes,
  estimateOfflinePackageBytes,
  isOfflinePackageComplete,
  isOfflinePackageStale,
  normalizeOfflinePackageMeta,
  type OfflinePackageBuildInput
} from './offlinePackage'
import type { Coordinate, DownloadedRoute, OfflinePackageMeta, Wgs84LineString } from './types'

const geometry = {
  type: 'LineString',
  coordinates: [
    [119.73, 30.25] as Coordinate,
    [119.74, 30.26] as Coordinate
  ]
} satisfies Wgs84LineString

const baseRoute = {
  title: { 'zh-CN': '环湖', en: 'Lake loop' },
  description: { 'zh-CN': '说明', en: 'Note' },
  geometry,
  cityAdcode: '330100',
  cityName: '杭州',
  tags: ['citywalk'],
  stops: [{
    title: { 'zh-CN': '起点', en: 'Start' },
    description: { 'zh-CN': '树', en: 'Tree' },
    highlightTitle: '银杏',
    location: [119.73, 30.25] as Coordinate
  }]
} satisfies OfflinePackageBuildInput

describe('geometry/text-only offline package', () => {
  it('estimates only persisted geometry and text as UTF-8 bytes', () => {
    const bytes = estimateGeometryTextBytes(baseRoute)
    expect(bytes).toBeGreaterThan(0)
    expect(Number.isInteger(bytes)).toBe(true)
    expect(bytes).toBe(new TextEncoder().encode(JSON.stringify({
      title: baseRoute.title,
      description: baseRoute.description,
      geometry: baseRoute.geometry,
      cityAdcode: baseRoute.cityAdcode,
      cityName: baseRoute.cityName,
      tags: baseRoute.tags,
      stops: baseRoute.stops.map((stop) => ({ ...stop, category: undefined }))
    })).byteLength)
  })

  it('builds v2 metadata with no image selection or image byte fields', () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const meta = buildOfflinePackageMeta(baseRoute, '2026-07-21T00:00:00.000Z')
    expect(meta).toEqual({
      version: 2,
      packagedAt: '2026-07-21T00:00:00.000Z',
      geometryTextBytes: estimateGeometryTextBytes(baseRoute)
    })
    expect(meta).not.toHaveProperty('mediaSelection')
    expect(meta).not.toHaveProperty('knownImageBytes')
    expect(isOfflinePackageComplete(meta)).toBe(true)
    expect(estimateOfflinePackageBytes(baseRoute)).toEqual({
      geometryTextBytes: meta.geometryTextBytes,
      totalKnownBytes: meta.geometryTextBytes
    })
    expect(fetchSpy).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('normalizes legacy v1 metadata by discarding all media fields', () => {
    expect(normalizeOfflinePackageMeta({
      version: 1,
      packagedAt: '2026-07-01T00:00:00.000Z',
      geometryTextBytes: 10.8,
      mediaSelection: { selectedMediaIds: ['legacy-image'] },
      knownImageBytes: 50,
      unknownImageCount: 1
    })).toEqual({
      version: 2,
      packagedAt: '2026-07-01T00:00:00.000Z',
      geometryTextBytes: 10
    })
  })
})

describe('offline package staleness', () => {
  const complete: OfflinePackageMeta = {
    version: 2,
    packagedAt: '2026-07-01T00:00:00.000Z',
    geometryTextBytes: 10
  }

  it('treats missing or incomplete metadata as stale', () => {
    expect(isOfflinePackageStale({})).toBe(true)
    expect(isOfflinePackageComplete(undefined)).toBe(false)
    expect(normalizeOfflinePackageMeta({ version: 2 })).toBeUndefined()
  })

  it('compares valid timestamps by absolute time', () => {
    const local: Pick<DownloadedRoute, 'remoteUpdatedAt' | 'offlinePackage'> = {
      remoteUpdatedAt: '2026-07-01T08:00:00.000+08:00',
      offlinePackage: complete
    }
    expect(isOfflinePackageStale(local, '2026-07-01T00:00:00.000Z')).toBe(false)
    expect(isOfflinePackageStale(local, '2026-07-01T09:00:00.000+08:00')).toBe(true)
    expect(isOfflinePackageStale({
      remoteUpdatedAt: '2026-07-01T12:00:00.000Z',
      offlinePackage: complete
    }, '2026-07-01T09:00:00.000+08:00')).toBe(false)
  })

  it('does not false-stale on invalid remote stamps', () => {
    expect(isOfflinePackageStale({
      remoteUpdatedAt: '2026-07-01T00:00:00.000Z',
      offlinePackage: complete
    }, 'not-a-date')).toBe(false)
    expect(isOfflinePackageStale({
      remoteUpdatedAt: 'bogus-local',
      offlinePackage: complete
    }, '2026-07-02T00:00:00.000Z')).toBe(true)
  })
})
