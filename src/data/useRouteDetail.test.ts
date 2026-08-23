import { describe, expect, it } from 'vitest'
import {
  formatPackageBytes,
  hasConfirmedGeometry,
  packageNeedsRedownloadPrompt,
  planOfflineSaveSource,
  shouldAdoptRemoteAsPrimary,
} from './useRouteDetail'
import type { CommunityRouteDetail, OfflinePackageMeta } from './types'

const completePackage: OfflinePackageMeta = {
  version: 2,
  packagedAt: '2026-07-01T00:00:00.000Z',
  geometryTextBytes: 10
}

const sampleRoute: CommunityRouteDetail = {
  id: 'r1',
  title: { 'zh-CN': 't', en: 't' },
  description: { 'zh-CN': '', en: '' },
  author: 'a',
  downloads: 0,
  travelMode: 'walking',
  geometry: {
    type: 'LineString',
    coordinates: [
      [1, 2],
      [3, 4]
    ]
  },
  stops: [
    {
      id: 's1',
      order: 1,
      location: [1, 2],
      title: { 'zh-CN': 'A', en: 'A' },
      description: { 'zh-CN': '', en: '' },
      media: [
        { id: 'm1', order: 1, url: 'https://example.test/1.jpg' },
        { id: 'm2', order: 2 },
        { id: 'm1', order: 3, url: 'https://example.test/1b.jpg' }
      ]
    }
  ]
}

describe('useRouteDetail offline/remote policy helpers', () => {
  it('detects confirmed local geometry', () => {
    expect(hasConfirmedGeometry(sampleRoute)).toBe(true)
    expect(hasConfirmedGeometry({ ...sampleRoute, geometry: undefined })).toBe(false)
    expect(
      hasConfirmedGeometry({
        ...sampleRoute,
        geometry: { type: 'LineString', coordinates: [[1, 2]] }
      })
    ).toBe(false)
  })

  it('never adopts remote as primary when local geometry is confirmed', () => {
    expect(shouldAdoptRemoteAsPrimary(true)).toBe(false)
    expect(shouldAdoptRemoteAsPrimary(false)).toBe(true)
  })

  it('uses remote on every explicit save when remote is available, with local-edit confirm', () => {
    // First save
    expect(
      planOfflineSaveSource({
        hasExistingDownload: false,
        existingIsLocalEdited: false,
        packageStale: false,
        remoteAvailable: true
      })
    ).toEqual({ useRemote: true, requiresLocalEditConfirm: false })

    // Explicit refresh while package is not stale still uses the current remote text/geometry.
    expect(
      planOfflineSaveSource({
        hasExistingDownload: true,
        existingIsLocalEdited: false,
        packageStale: false,
        remoteAvailable: true
      })
    ).toEqual({ useRemote: true, requiresLocalEditConfirm: false })

    // Local edits always require confirm when remote will replace them.
    expect(
      planOfflineSaveSource({
        hasExistingDownload: true,
        existingIsLocalEdited: true,
        packageStale: false,
        remoteAvailable: true
      })
    ).toEqual({ useRemote: true, requiresLocalEditConfirm: true })

    expect(
      planOfflineSaveSource({
        hasExistingDownload: true,
        existingIsLocalEdited: true,
        packageStale: true,
        remoteAvailable: true
      })
    ).toEqual({ useRemote: true, requiresLocalEditConfirm: true })

    // Offline / no remote: keep local package source, no confirm gate for remote.
    expect(
      planOfflineSaveSource({
        hasExistingDownload: true,
        existingIsLocalEdited: true,
        packageStale: true,
        remoteAvailable: false
      })
    ).toEqual({ useRemote: false, requiresLocalEditConfirm: false })
  })

  it('prompts redownload for stale or incomplete packages without auto-overwrite', () => {
    expect(
      packageNeedsRedownloadPrompt(
        { remoteUpdatedAt: '2026-07-01T00:00:00.000Z', offlinePackage: completePackage },
        '2026-07-02T00:00:00.000Z'
      )
    ).toBe(true)
    expect(
      packageNeedsRedownloadPrompt(
        { remoteUpdatedAt: '2026-07-01T00:00:00.000Z', offlinePackage: completePackage },
        '2026-07-01T00:00:00.000Z'
      )
    ).toBe(false)
    expect(
      packageNeedsRedownloadPrompt(
        { remoteUpdatedAt: '2026-07-01T00:00:00.000Z' },
        undefined
      )
    ).toBe(true)
    expect(packageNeedsRedownloadPrompt(undefined, '2026-07-02T00:00:00.000Z')).toBe(false)
  })

  it('formats package sizes with KiB (1024-based), not KB', () => {
    expect(formatPackageBytes(512)).toBe('512 B')
    expect(formatPackageBytes(2048)).toBe('2.0 KiB')
    expect(formatPackageBytes(1024 * 1024)).toBe('1.0 MiB')
  })
})
