import { describe, expect, it } from 'vitest'
import {
  createEmptyRouteDraft,
  migrateLegacyDraft,
  normalizeRouteDraftRecord
} from './drafts'
import { ROUTE_DRAFT_VERSION } from './types'

describe('route draft v5 normalization', () => {
  it('removes persisted provider segments and migrates a legacy photo', () => {
    const legacy = {
      id: 'draft-1',
      title: 'Route',
      note: '',
      points: [{
        id: 'point-1',
        index: 1,
        raw: [119.7, 30.2],
        final: [119.7, 30.2],
        snapped: false,
        text: 'note',
        photoId: 'legacy-photo'
      }],
      segments: [{
        id: 'segment-1',
        fromPointId: 'a',
        toPointId: 'b',
        coordinates: [[119.7, 30.2], [119.8, 30.3]],
        kind: 'network',
        distanceMeters: 10,
        provider: 'amap-walking'
      }],
      snapToRoads: true,
      syncState: 'local',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    }

    const normalized = normalizeRouteDraftRecord(legacy)

    expect(normalized.version).toBe(ROUTE_DRAFT_VERSION)
    expect(normalized.travelMode).toBe('walking')
    expect(normalized.geometryStatus).toBe('missing')
    expect(normalized.geometry).toBeUndefined()
    expect(normalized.geometrySource).toBeUndefined()
    expect(normalized).not.toHaveProperty('segments')
    expect(normalized.points[0]).not.toHaveProperty('photoId')
    expect(normalized.points[0]).not.toHaveProperty('speciesName')
    expect(normalized.points[0].media).toEqual([
      { id: 'legacy-photo', order: 1, photoId: 'legacy-photo' }
    ])
  })

  it('maps legacy speciesName input to highlightTitle only', () => {
    const legacy = {
      id: 'draft-2',
      title: 'Route',
      note: '',
      points: [{
        id: 'point-1',
        index: 1,
        raw: [119.7, 30.2],
        final: [119.7, 30.2],
        snapped: false,
        text: 'note',
        speciesName: '银杏',
        media: []
      }],
      snapToRoads: true,
      syncState: 'local',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    }

    const normalized = normalizeRouteDraftRecord(legacy)

    expect(normalized.points[0].highlightTitle).toBe('银杏')
    expect(normalized.points[0]).not.toHaveProperty('speciesName')
    expect(JSON.stringify(normalized)).not.toContain('speciesName')
  })

  it('versionless drafts ignore stray confirmed geometry and stay walking+missing', () => {
    const draft = {
      id: 'draft-3',
      title: 'Route',
      note: 'note',
      points: [{
        id: 'point-1',
        index: 7,
        raw: [119.7, 30.2],
        final: [119.7, 30.2],
        snapped: false,
        text: '',
        highlightTitle: '城墙角',
        speciesName: '旧物种',
        media: [{ id: 'm1', order: 3, photoId: 'blob-1' }]
      }],
      snapToRoads: true,
      syncState: 'pending',
      remoteId: 'remote-1',
      rejectionReason: 'fix',
      travelMode: 'cycling',
      geometryStatus: 'confirmed',
      geometry: {
        type: 'LineString',
        coordinates: [[119.7, 30.2], [119.8, 30.3]]
      },
      geometrySource: 'field-recorded',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z'
    }

    const normalized = normalizeRouteDraftRecord(draft)
    expect(normalized.version).toBe(ROUTE_DRAFT_VERSION)
    expect(normalized.authoringMode).toBe('field')
    expect(normalized.travelMode).toBe('walking')
    expect(normalized.points[0].highlightTitle).toBe('城墙角')
    expect(normalized.points[0].index).toBe(7)
    expect(normalized.points[0].media[0].order).toBe(3)
    expect(normalized.points[0].media[0].id).toBe('m1')
    expect(normalized.syncState).toBe('pending')
    expect(normalized.remoteId).toBe('remote-1')
    expect(normalized.rejectionReason).toBe('fix')
    expect(normalized.geometryStatus).toBe('missing')
    expect(normalized.geometry).toBeUndefined()
    expect(normalized.geometrySource).toBeUndefined()
    expect(normalized.points[0]).not.toHaveProperty('speciesName')
  })

  it('migrates v3 confirmed geometry unchanged into v5', () => {
    const draft = {
      version: 3,
      id: 'draft-4',
      title: 'Route',
      note: '',
      points: [
        {
          id: 'p1',
          index: 1,
          raw: [98.5, 39.7],
          final: [98.5, 39.7],
          snapped: false,
          text: '',
          media: []
        },
        {
          id: 'p2',
          index: 2,
          raw: [98.51, 39.71],
          final: [98.51, 39.71],
          snapped: false,
          text: '',
          media: []
        }
      ],
      travelMode: 'cycling',
      geometryStatus: 'confirmed',
      geometry: {
        type: 'LineString',
        coordinates: [[98.5, 39.7], [98.51, 39.71]]
      },
      geometrySource: 'field-recorded',
      snapToRoads: false,
      syncState: 'local',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    }

    const normalized = normalizeRouteDraftRecord(draft)
    expect(normalized.version).toBe(ROUTE_DRAFT_VERSION)
    expect(normalized.authoringMode).toBe('field')
    expect(normalized.travelMode).toBe('cycling')
    expect(normalized.geometryStatus).toBe('confirmed')
    expect(normalized.geometry?.coordinates).toHaveLength(2)
    expect(normalized.geometrySource).toBe('field-recorded')
  })

  it('version 3 confirmed with invalid geometry stays confirmed (no silent v3 downgrade)', () => {
    const draft = {
      version: 3,
      id: 'draft-confirmed-invalid',
      title: 'Route',
      note: '',
      points: [
        {
          id: 'p1',
          index: 1,
          raw: [98.5, 39.7],
          final: [98.5, 39.7],
          snapped: false,
          text: '',
          media: []
        },
        {
          id: 'p2',
          index: 2,
          raw: [98.51, 39.71],
          final: [98.51, 39.71],
          snapped: false,
          text: '',
          media: []
        }
      ],
      travelMode: 'walking',
      geometryStatus: 'confirmed',
      geometry: { type: 'LineString', coordinates: [[1, 1]] },
      geometrySource: 'not-a-source',
      snapToRoads: false,
      syncState: 'local',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    }

    const normalized = normalizeRouteDraftRecord(draft)
    expect(normalized.geometryStatus).toBe('confirmed')
    expect(normalized.geometry).toBeUndefined()
    expect(normalized.geometrySource).toBeUndefined()
  })

  it('preserves v3 tags and media counts without silent truncation', () => {
    const longCategory = 'x'.repeat(81)
    const draft = {
      version: 3,
      id: 'draft-tags',
      title: 'Route',
      note: '',
      points: [{
        id: 'p1',
        index: 1,
        raw: [1, 2],
        final: [1, 2],
        snapped: false,
        text: '',
        category: `  ${longCategory}  `,
        media: Array.from({ length: 9 }, (_, i) => ({
          id: `m${i}`,
          order: i + 1,
          photoId: `blob-${i}`
        }))
      }],
      tags: [' ok ', '', 'ok', 'y'.repeat(33), 'a', 'b', 'c', 'd', 'e', 'f', 'g'],
      travelMode: 'walking',
      geometryStatus: 'missing',
      snapToRoads: true,
      syncState: 'local',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    }

    const normalized = normalizeRouteDraftRecord(draft)
    expect(normalized.tags).toEqual([
      'ok',
      '',
      'ok',
      'y'.repeat(33),
      'a',
      'b',
      'c',
      'd',
      'e',
      'f',
      'g'
    ])
    expect(normalized.points[0].media).toHaveLength(9)
    expect(normalized.points[0].category).toBe(longCategory)
  })

  it('preserves legacy stop media id/order without speciesName', () => {
    const migrated = migrateLegacyDraft(
      {
        id: 'legacy-media-draft',
        title: 'Route',
        note: '',
        waypoints: [[119.7, 30.2], [119.8, 30.3]],
        stops: [
          {
            id: 'stop-keep',
            order: 5,
            lng: 119.7,
            lat: 30.2,
            text: 'a',
            speciesName: '旧名',
            media: [
              { id: 'media-keep', order: 4, photoId: 'blob-keep' },
              { id: 'media-path', order: 7, storagePath: 'routes/u/r/p/1.jpg' }
            ]
          },
          {
            lng: 119.8,
            lat: 30.3,
            photo: 'legacy-single-photo'
          }
        ],
        createdAt: '2026-01-01T00:00:00.000Z'
      },
      0
    )

    expect(migrated.geometryStatus).toBe('missing')
    expect(migrated.points[0].id).toBe('stop-keep')
    expect(migrated.points[0].index).toBe(5)
    expect(migrated.points[0].highlightTitle).toBe('旧名')
    expect(migrated.points[0]).not.toHaveProperty('speciesName')
    expect(migrated.points[0].media[0]).toMatchObject({
      id: 'media-keep',
      order: 4,
      photoId: 'blob-keep'
    })
    expect(migrated.points[0].media[1]).toMatchObject({
      id: 'media-path',
      order: 7,
      storagePath: 'routes/u/r/p/1.jpg'
    })
    expect(migrated.points[1].media[0]).toMatchObject({
      id: 'legacy-single-photo',
      order: 1,
      photoId: 'legacy-single-photo'
    })
  })

  it('creates empty v5 drafts in the requested authoring mode with missing geometry', () => {
    const draft = createEmptyRouteDraft({
      id: 'new-1',
      authoringMode: 'map',
      title: 'Untitled',
      now: '2026-01-01T00:00:00.000Z'
    })
    expect(draft.version).toBe(ROUTE_DRAFT_VERSION)
    expect(draft.authoringMode).toBe('map')
    expect(draft.travelMode).toBe('walking')
    expect(draft.geometryStatus).toBe('missing')
    expect(draft.geometry).toBeUndefined()
    expect(draft.geometrySource).toBeUndefined()
    expect(draft.points).toEqual([])
    expect(draft).not.toHaveProperty('offlineMediaAllowed')
  })

  it('drops legacy offline-photo authorization from drafts', () => {
    const normalized = normalizeRouteDraftRecord({
      version: 4,
      id: 'offline-default',
      authoringMode: 'field',
      title: 'Older draft',
      note: '',
      points: [],
      snapToRoads: false,
      travelMode: 'walking',
      geometryStatus: 'missing',
      offlineMediaAllowed: false,
      syncState: 'local',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    })

    expect(normalized).not.toHaveProperty('offlineMediaAllowed')
  })

  it('keeps candidates distinct from confirmed geometry', () => {
    const normalized = normalizeRouteDraftRecord({
      version: 4,
      id: 'candidate-1',
      authoringMode: 'import',
      title: 'Imported',
      note: '',
      points: [],
      snapToRoads: false,
      travelMode: 'walking',
      geometryStatus: 'missing',
      geometryCandidate: {
        geometry: { type: 'LineString', coordinates: [[119.7, 30.2], [119.8, 30.3]] },
        source: 'gpx-import',
        generatedAt: '2026-01-01T00:00:00.000Z'
      },
      syncState: 'local',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    })

    expect(normalized.geometryStatus).toBe('missing')
    expect(normalized.geometry).toBeUndefined()
    expect(normalized.geometryCandidate?.source).toBe('gpx-import')
  })

  it('migrates v4 candidates and import summaries without loss', () => {
    const normalized = normalizeRouteDraftRecord({
      version: 4,
      id: 'v4-import',
      authoringMode: 'import',
      title: 'Imported',
      note: '',
      points: [],
      snapToRoads: false,
      travelMode: 'cycling',
      geometryStatus: 'missing',
      geometryCandidate: {
        geometry: { type: 'LineString', coordinates: [[119.7, 30.2], [119.8, 30.3]] },
        source: 'geojson-import',
        generatedAt: '2026-01-01T00:00:00.000Z'
      },
      importSummary: {
        format: 'geojson',
        fileName: 'route.geojson',
        originalCoordinateCount: 2,
        coordinateCount: 2,
        simplified: false,
        strippedMetadata: ['timestamps']
      },
      syncState: 'local',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    })
    expect(normalized.version).toBe(5)
    expect(normalized.geometryCandidate?.source).toBe('geojson-import')
    expect(normalized.importSummary?.fileName).toBe('route.geojson')
    expect(normalized.aiProvenance).toBeUndefined()
  })

  it('normalizes AI provenance without retaining unsafe source paths', () => {
    const normalized = normalizeRouteDraftRecord({
      version: 5,
      id: 'v5-ai',
      authoringMode: 'ai',
      title: 'AI route',
      note: '',
      points: [],
      snapToRoads: false,
      travelMode: 'walking',
      geometryStatus: 'pending',
      aiProvenance: {
        inputKind: 'prompt',
        providerId: 'deepseek-cn',
        modelId: 'deepseek-v4-flash',
        generatedAt: '2026-07-29T00:00:00.000Z',
        sourceRefs: [
          { kind: 'file-name', label: 'route.docx' },
          { kind: 'file-name', label: 'C:\\private\\route.docx' },
          { kind: 'url-origin', label: 'https://example.com' }
        ],
        candidateCount: 3,
        ambiguityCount: 1,
        harnessVersion: 'h1',
        promptVersion: 'p1'
      },
      syncState: 'local',
      createdAt: '2026-07-29T00:00:00.000Z',
      updatedAt: '2026-07-29T00:00:00.000Z'
    })
    expect(normalized.geometryStatus).toBe('pending')
    expect(normalized.aiProvenance?.sourceRefs).toEqual([{ kind: 'file-name', label: 'route.docx' }])
    expect(normalized.aiProvenance).not.toHaveProperty('providerId')
    expect(normalized.aiProvenance).not.toHaveProperty('modelId')
  })
})
