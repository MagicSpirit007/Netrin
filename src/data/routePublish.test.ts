import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RouteDraft } from './types'
import { ROUTE_DRAFT_VERSION } from './types'

type PublishRpcArgs = {
  p_route_id: string
  p_points: Array<{
    id: string
    media: Array<{ id: string; storagePath: string }>
    highlightTitle?: string
    speciesName?: string
  }>
  p_meta?: {
    travelMode: string
    geometrySource: string
    geometry: { type: string; coordinates: number[][] }
    coverMediaId?: string
  }
}

const mocks = vi.hoisted(() => {
  const store = new Map<string, unknown>()
  const upload = vi.fn(async (_path: string, _blob: Blob, _options?: unknown) => ({ error: null }))
  const remove = vi.fn(async (_paths: string[]) => ({ error: null }))
  const rpc = vi.fn(async (_name: string, _args: PublishRpcArgs) => ({
    data: null as string | null,
    error: null as unknown
  }))
  const getSession = vi.fn(async () => ({
    data: {
      session: {
        user: {
          id: 'user-1',
          phone: '+8613800138000',
          phone_confirmed_at: '2026-07-15T00:00:00Z',
          is_anonymous: false
        }
      }
    }
  }))
  const routeLookup = vi.fn(async () => ({
    data: null as { id: string } | null,
    error: null as unknown
  }))
  return {
    store,
    upload,
    remove,
    rpc,
    getSession,
    routeLookup,
    storageFrom: vi.fn(() => ({
      upload,
      remove,
      getPublicUrl: (path: string) => ({ data: { publicUrl: `https://example.test/${path}` } })
    }))
  }
})

vi.mock('localforage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => mocks.store.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: unknown) => {
      mocks.store.set(key, value)
      return value
    }),
    removeItem: vi.fn(async (key: string) => {
      mocks.store.delete(key)
    })
  }
}))

vi.mock('../lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabase: {
    auth: {
      getSession: mocks.getSession,
      signInAnonymously: vi.fn()
    },
    storage: { from: mocks.storageFrom },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({ maybeSingle: mocks.routeLookup }))
      }))
    })),
    rpc: mocks.rpc
  }
}))

vi.mock('./drafts', () => ({
  loadMediaBlob: vi.fn(async () => new Blob(['photo'], { type: 'image/jpeg' }))
}))

vi.mock('../lib/image', () => ({
  compressImage: vi.fn(async (blob: Blob) => blob)
}))

import { publishRouteDraft } from './routeLibrary'

function createDraft(overrides: Partial<RouteDraft> = {}): RouteDraft {
  return {
    version: ROUTE_DRAFT_VERSION,
    id: 'draft-1',
    authoringMode: 'map',
    title: 'Route',
    note: 'Note',
    points: [
      {
        id: 'point-a',
        index: 1,
        raw: [119.7, 30.2],
        final: [119.7, 30.2],
        snapped: false,
        text: 'A',
        highlightTitle: 'A',
        media: [{ id: 'photo-a', order: 1, photoId: 'blob-a' }]
      },
      {
        id: 'point-b',
        index: 2,
        raw: [119.8, 30.3],
        final: [119.8, 30.3],
        snapped: false,
        text: 'B',
        media: []
      }
    ],
    snapToRoads: false,
    travelMode: 'walking',
    geometryStatus: 'confirmed',
    geometry: {
      type: 'LineString',
      coordinates: [[119.7, 30.2], [119.8, 30.3]]
    },
    geometrySource: 'amap-planned',
    distanceM: 1200,
    durationS: 900,
    syncState: 'local',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

beforeEach(() => {
  mocks.store.clear()
  mocks.upload.mockClear()
  mocks.remove.mockClear()
  mocks.rpc.mockReset()
  mocks.getSession.mockClear()
  mocks.routeLookup.mockReset()
  mocks.routeLookup.mockResolvedValue({ data: null, error: null })
  mocks.storageFrom.mockClear()
})

describe('publishRouteDraft M2 pipeline', () => {
  it('rejects publishing before the phone number is confirmed', async () => {
    mocks.getSession.mockResolvedValueOnce({
      data: {
        session: {
          user: {
            id: 'user-1',
            phone: '+8613800138000',
            phone_confirmed_at: null,
            is_anonymous: false
          }
        }
      }
    } as never)

    const result = await publishRouteDraft(createDraft(), 'Untitled')

    expect(result).toEqual({ ok: false, error: 'auth' })
    expect(mocks.upload).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('missing geometry is rejected before auth, upload, or RPC', async () => {
    const result = await publishRouteDraft(createDraft({
      geometryStatus: 'missing',
      geometry: undefined,
      geometrySource: undefined
    }), 'Untitled')

    expect(result).toEqual({ ok: false, error: 'invalid' })
    expect(mocks.getSession).not.toHaveBeenCalled()
    expect(mocks.upload).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('keeps stable IDs and paths when the RPC result is ambiguous, then retries safely', async () => {
    mocks.rpc
      .mockRejectedValueOnce(new Error('connection lost after request'))
      .mockResolvedValueOnce({ data: 'remote-route', error: null })

    const first = await publishRouteDraft(createDraft(), 'Untitled')
    const firstRpcArgs = mocks.rpc.mock.calls[0][1] as PublishRpcArgs
    const firstPath = mocks.upload.mock.calls[0][0]

    expect(first).toEqual({ ok: false, error: 'network' })
    expect(mocks.remove).not.toHaveBeenCalled()

    const second = await publishRouteDraft(createDraft(), 'Untitled')
    const secondRpcArgs = mocks.rpc.mock.calls[1][1] as PublishRpcArgs
    const secondPath = secondRpcArgs.p_points[0].media[0].storagePath

    expect(second).toEqual({ ok: true, id: 'remote-route' })
    expect(mocks.rpc.mock.calls[1][0]).toBe('submit_route_v4')
    expect(secondRpcArgs.p_route_id).toBe(firstRpcArgs.p_route_id)
    expect(secondRpcArgs.p_points[0].id).toBe(firstRpcArgs.p_points[0].id)
    expect(secondRpcArgs.p_points[0].media[0].id).toBe(firstRpcArgs.p_points[0].media[0].id)
    expect(secondPath).toBe(firstPath)
    expect(mocks.upload).toHaveBeenCalledTimes(1)
    expect(mocks.remove).not.toHaveBeenCalled()
  })

  it('reclaims uploaded objects after a definitive RPC error', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'validation failed' } })

    const result = await publishRouteDraft(createDraft(), 'Untitled')
    const uploadedPath = mocks.upload.mock.calls[0][0]

    expect(result).toEqual({ ok: false, error: 'server' })
    expect(mocks.remove).toHaveBeenCalledWith([uploadedPath])
  })

  it('treats a committed route as success when the RPC response contains an error', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'response lost' } })
    mocks.routeLookup.mockResolvedValueOnce({ data: { id: 'committed-route' }, error: null })

    const result = await publishRouteDraft(createDraft(), 'Untitled')
    const attemptedId = (mocks.rpc.mock.calls[0][1] as PublishRpcArgs).p_route_id

    expect(result).toEqual({ ok: true, id: attemptedId })
    expect(mocks.remove).not.toHaveBeenCalled()
  })

  it('confirmed valid draft uses submit_route_v4 with mapped cover media UUID', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: 'remote-v4', error: null })
    const draft = createDraft({
      geometryStatus: 'confirmed',
      geometry: {
        type: 'LineString',
        coordinates: [[119.7, 30.2], [119.8, 30.3]]
      },
      geometrySource: 'field-recorded',
      travelMode: 'cycling',
      coverMediaId: 'photo-a',
      tags: ['citywalk'],
      distanceM: 1200,
      durationS: 900,
      difficulty: 'easy',
      isLoop: false
    })

    const result = await publishRouteDraft(draft, 'Untitled')
    const args = mocks.rpc.mock.calls[0][1] as PublishRpcArgs

    expect(result).toEqual({ ok: true, id: 'remote-v4' })
    expect(mocks.rpc.mock.calls[0][0]).toBe('submit_route_v4')
    expect(args.p_meta?.travelMode).toBe('cycling')
    expect(args.p_meta?.geometrySource).toBe('field-recorded')
    expect(args.p_meta?.geometry.coordinates).toHaveLength(2)
    expect(args.p_meta?.coverMediaId).toBe(args.p_points[0].media[0].id)
    expect(args.p_points[0].highlightTitle).toBe('A')
    expect(args.p_points[0]).not.toHaveProperty('speciesName')
  })

  it('confirmed invalid draft never uploads or RPCs', async () => {
    const draft = createDraft({
      geometryStatus: 'confirmed',
      geometry: undefined,
      geometrySource: 'field-recorded'
    })

    const result = await publishRouteDraft(draft, 'Untitled')

    expect(result).toEqual({ ok: false, error: 'invalid' })
    expect(mocks.upload).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.getSession).not.toHaveBeenCalled()
  })

  it('confirmed cover without serializable media never uploads or RPCs', async () => {
    const draft = createDraft({
      geometryStatus: 'confirmed',
      geometry: {
        type: 'LineString',
        coordinates: [[119.7, 30.2], [119.8, 30.3]]
      },
      geometrySource: 'field-recorded',
      coverMediaId: 'cover-url-only',
      points: [
        {
          id: 'point-a',
          index: 1,
          raw: [119.7, 30.2],
          final: [119.7, 30.2],
          snapped: false,
          text: 'A',
          highlightTitle: 'A',
          media: [{ id: 'cover-url-only', order: 1, url: 'https://example.test/x' }]
        },
        {
          id: 'point-b',
          index: 2,
          raw: [119.8, 30.3],
          final: [119.8, 30.3],
          snapped: false,
          text: 'B',
          media: []
        }
      ]
    })

    const result = await publishRouteDraft(draft, 'Untitled')

    expect(result).toEqual({ ok: false, error: 'invalid' })
    expect(mocks.upload).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.getSession).not.toHaveBeenCalled()
  })

  it('confirmed non-cover media without a local blob or storage path never uploads or RPCs', async () => {
    const draft = createDraft({
      geometryStatus: 'confirmed',
      geometry: {
        type: 'LineString',
        coordinates: [[119.7, 30.2], [119.8, 30.3]]
      },
      geometrySource: 'field-recorded',
      points: [
        {
          id: 'point-a',
          index: 1,
          raw: [119.7, 30.2],
          final: [119.7, 30.2],
          snapped: false,
          text: 'A',
          highlightTitle: 'A',
          media: [
            { id: 'photo-a', order: 1, photoId: 'blob-a' },
            { id: 'url-only', order: 2, url: 'https://example.test/x' }
          ]
        },
        {
          id: 'point-b',
          index: 2,
          raw: [119.8, 30.3],
          final: [119.8, 30.3],
          snapped: false,
          text: 'B',
          media: []
        }
      ]
    })

    const result = await publishRouteDraft(draft, 'Untitled')

    expect(result).toEqual({ ok: false, error: 'invalid' })
    expect(mocks.upload).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.getSession).not.toHaveBeenCalled()
  })

  it('v4 includes empty tags array to clear server tags', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: 'remote-v4', error: null })
    const draft = createDraft({
      geometryStatus: 'confirmed',
      geometry: {
        type: 'LineString',
        coordinates: [[119.7, 30.2], [119.8, 30.3]]
      },
      geometrySource: 'field-recorded',
      tags: undefined
    })

    await publishRouteDraft(draft, 'Untitled')
    const args = mocks.rpc.mock.calls[0][1] as PublishRpcArgs & {
      p_meta: { tags: string[] }
    }
    expect(mocks.rpc.mock.calls[0][0]).toBe('submit_route_v4')
    expect(args.p_meta.tags).toEqual([])
  })

  it('ambiguous v4 retry reuses route/point/media IDs, path and meta', async () => {
    mocks.rpc
      .mockRejectedValueOnce(new Error('lost after v4'))
      .mockResolvedValueOnce({ data: 'remote-v4', error: null })

    const draft = createDraft({
      geometryStatus: 'confirmed',
      geometry: {
        type: 'LineString',
        coordinates: [[119.7, 30.2], [119.8, 30.3]]
      },
      geometrySource: 'amap-planned',
      travelMode: 'walking',
      coverMediaId: 'photo-a'
    })

    const first = await publishRouteDraft(draft, 'Untitled')
    const firstArgs = mocks.rpc.mock.calls[0][1] as PublishRpcArgs
    const firstPath = mocks.upload.mock.calls[0][0]

    expect(first).toEqual({ ok: false, error: 'network' })
    expect(mocks.rpc.mock.calls[0][0]).toBe('submit_route_v4')

    const second = await publishRouteDraft(draft, 'Untitled')
    const secondArgs = mocks.rpc.mock.calls[1][1] as PublishRpcArgs

    expect(second).toEqual({ ok: true, id: 'remote-v4' })
    expect(mocks.rpc.mock.calls[1][0]).toBe('submit_route_v4')
    expect(secondArgs.p_route_id).toBe(firstArgs.p_route_id)
    expect(secondArgs.p_points[0].id).toBe(firstArgs.p_points[0].id)
    expect(secondArgs.p_points[0].media[0].id).toBe(firstArgs.p_points[0].media[0].id)
    expect(secondArgs.p_points[0].media[0].storagePath).toBe(firstPath)
    expect(secondArgs.p_meta).toEqual(firstArgs.p_meta)
    expect(mocks.upload).toHaveBeenCalledTimes(1)
  })
})
