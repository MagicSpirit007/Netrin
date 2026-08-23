import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FeatureCollection, LineString } from 'geojson'
import {
  resetSnapPathCacheForTests,
  SNAP_APPLY_THRESHOLD_METERS,
  SNAP_LOW_ACCURACY_METERS,
  SNAP_PROBE_RADIUS_METERS,
  snapPoint
} from './snap'

/** ~111.32 m per degree latitude; local longitude scale near 30°N. */
const METERS_PER_DEG_LAT = 111_320
const METERS_PER_DEG_LNG = 111_320 * Math.cos((30 * Math.PI) / 180)

function pathCollection(
  segments: Array<[[number, number], [number, number]]>
): FeatureCollection<LineString> {
  return {
    type: 'FeatureCollection',
    features: segments.map((coordinates, index) => ({
      type: 'Feature',
      properties: { id: `path-${index}` },
      geometry: {
        type: 'LineString',
        coordinates
      }
    }))
  }
}

function stubPaths(payload: unknown, ok = true): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      ok
        ? new Response(JSON.stringify(payload), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          })
        : new Response('missing', { status: 404 })
    )
  )
}

describe('snapPoint', () => {
  beforeEach(() => {
    resetSnapPathCacheForTests()
    vi.unstubAllGlobals()
  })

  afterEach(() => {
    resetSnapPathCacheForTests()
    vi.unstubAllGlobals()
  })

  it('exposes the approved apply/probe/accuracy constants', () => {
    expect(SNAP_APPLY_THRESHOLD_METERS).toBe(15)
    expect(SNAP_PROBE_RADIUS_METERS).toBe(50)
    expect(SNAP_LOW_ACCURACY_METERS).toBe(50)
  })

  it('snaps when the nearest path is within the 15 m apply threshold', async () => {
    const origin: [number, number] = [120, 30]
    const along: [number, number] = [120 + 40 / METERS_PER_DEG_LNG, 30]
    stubPaths(pathCollection([[origin, along]]))

    const offsetMeters = 8
    const raw: [number, number] = [120, 30 + offsetMeters / METERS_PER_DEG_LAT]
    const result = await snapPoint(raw)

    expect(result.snapped).toBe(true)
    expect(result.reason).toBe('snapped')
    expect(result.final[0]).toBeCloseTo(120, 6)
    expect(result.final[1]).toBeCloseTo(30, 6)
    expect(result.distance).not.toBeNull()
    expect(result.distance!).toBeLessThanOrEqual(SNAP_APPLY_THRESHOLD_METERS)
    // Source-compatible fields remain present.
    expect(result).toMatchObject({ final: expect.any(Array), snapped: true })
  })

  it('retains the raw point when the nearest path is beyond 15 m but inside the 50 m probe', async () => {
    const origin: [number, number] = [120, 30]
    const along: [number, number] = [120 + 40 / METERS_PER_DEG_LNG, 30]
    stubPaths(pathCollection([[origin, along]]))

    const offsetMeters = 25
    const raw: [number, number] = [120, 30 + offsetMeters / METERS_PER_DEG_LAT]
    const result = await snapPoint(raw)

    expect(result).toMatchObject({
      final: raw,
      snapped: false,
      reason: 'over-threshold'
    })
    expect(result.distance).not.toBeNull()
    expect(result.distance!).toBeGreaterThan(SNAP_APPLY_THRESHOLD_METERS)
    expect(result.distance!).toBeLessThanOrEqual(SNAP_PROBE_RADIUS_METERS)
  })

  it('returns outside-coverage when the fix is far from the path network', async () => {
    const origin: [number, number] = [120, 30]
    const along: [number, number] = [120 + 40 / METERS_PER_DEG_LNG, 30]
    stubPaths(pathCollection([[origin, along]]))

    const raw: [number, number] = [121, 31]
    const result = await snapPoint(raw)

    expect(result).toEqual({
      final: raw,
      snapped: false,
      distance: null,
      reason: 'outside-coverage'
    })
  })

  it('returns no-nearby-path when coverage exists but no path is inside the probe', async () => {
    // Two short paths create a large coverage box with an empty interior gap.
    const west: [[number, number], [number, number]] = [
      [120, 30],
      [120 + 10 / METERS_PER_DEG_LNG, 30]
    ]
    const east: [[number, number], [number, number]] = [
      [120 + 300 / METERS_PER_DEG_LNG, 30],
      [120 + 310 / METERS_PER_DEG_LNG, 30]
    ]
    stubPaths(pathCollection([west, east]))

    const raw: [number, number] = [120 + 155 / METERS_PER_DEG_LNG, 30]
    const result = await snapPoint(raw)

    expect(result).toMatchObject({
      final: raw,
      snapped: false,
      reason: 'no-nearby-path'
    })
  })

  it('returns path-data-unavailable when fetch fails and keeps the raw coordinate', async () => {
    stubPaths(null, false)
    const raw: [number, number] = [120, 30]
    await expect(snapPoint(raw)).resolves.toEqual({
      final: raw,
      snapped: false,
      distance: null,
      reason: 'path-data-unavailable'
    })
  })

  it('returns path-data-unavailable when the payload fails validation', async () => {
    stubPaths({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] } }] })
    const raw: [number, number] = [120, 30]
    await expect(snapPoint(raw)).resolves.toEqual({
      final: raw,
      snapped: false,
      distance: null,
      reason: 'path-data-unavailable'
    })
  })

  it('skips snapping when GPS accuracy is worse than 50 m', async () => {
    const origin: [number, number] = [120, 30]
    const along: [number, number] = [120 + 40 / METERS_PER_DEG_LNG, 30]
    stubPaths(pathCollection([[origin, along]]))

    const raw: [number, number] = [120, 30]
    const result = await snapPoint(raw, {
      accuracyMeters: SNAP_LOW_ACCURACY_METERS + 1
    })

    expect(result).toEqual({
      final: raw,
      snapped: false,
      distance: null,
      reason: 'low-accuracy'
    })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('still attempts snap when GPS accuracy is exactly 50 m (boundary is exclusive >50)', async () => {
    const origin: [number, number] = [120, 30]
    const along: [number, number] = [120 + 40 / METERS_PER_DEG_LNG, 30]
    stubPaths(pathCollection([[origin, along]]))

    const raw: [number, number] = [120, 30 + 8 / METERS_PER_DEG_LAT]
    const result = await snapPoint(raw, {
      accuracyMeters: SNAP_LOW_ACCURACY_METERS
    })

    expect(result.reason).toBe('snapped')
    expect(result.snapped).toBe(true)
    expect(fetch).toHaveBeenCalled()
  })

  it('accepts the legacy numeric threshold argument without breaking callers', async () => {
    const origin: [number, number] = [120, 30]
    const along: [number, number] = [120 + 40 / METERS_PER_DEG_LNG, 30]
    stubPaths(pathCollection([[origin, along]]))

    const raw: [number, number] = [120, 30 + 8 / METERS_PER_DEG_LAT]
    const result = await snapPoint(raw, SNAP_APPLY_THRESHOLD_METERS)
    expect(result.snapped).toBe(true)
    expect(result.reason).toBe('snapped')
  })
})
