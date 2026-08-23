import { describe, expect, it } from 'vitest'
import {
  MAX_ROUTE_IMPORT_COORDINATES,
  RouteImportError,
  parseGeoJsonRoute,
  parseGpxRoute
} from './routeImport'

describe('route file import', () => {
  it('returns GPX tracks separately and keeps named waypoints as editable highlights', () => {
    const tracks = parseGpxRoute(`<?xml version="1.0"?>
      <gpx version="1.1">
        <wpt lat="30.20" lon="119.70"><name>银杏</name><desc>北门旁</desc><ele>99</ele></wpt>
        <trk><name>北线</name><trkseg>
          <trkpt lat="30.20" lon="119.70"><time>2026-01-01T00:00:00Z</time></trkpt>
          <trkpt lat="30.21" lon="119.71" />
        </trkseg></trk>
        <trk><name>南线</name><trkseg>
          <trkpt lat="30.22" lon="119.72" />
          <trkpt lat="30.23" lon="119.73" />
        </trkseg></trk>
      </gpx>`, 'campus.gpx')

    expect(tracks).toHaveLength(2)
    expect(tracks.map((track) => track.name)).toEqual(['北线', '南线'])
    expect(tracks[0].points.some((point) => point.highlightTitle === '银杏')).toBe(true)
    expect(tracks[0].summary.strippedMetadata).toContain('time')
    expect(JSON.stringify(tracks)).not.toContain('2026-01-01T00:00:00Z')
    expect(JSON.stringify(tracks)).not.toContain('"elevation":99')
  })

  it('accepts a GPX route and strips unnamed route metadata', () => {
    const [route] = parseGpxRoute(`<gpx><rte><name>环湖</name>
      <rtept lat="30" lon="120"><name>入口</name></rtept>
      <rtept lat="30.01" lon="120.01"><extensions><device>x</device></extensions></rtept>
    </rte></gpx>`)

    expect(route.geometryCandidate.source).toBe('gpx-import')
    expect(route.geometryCandidate.geometry.coordinates).toEqual([[120, 30], [120.01, 30.01]])
    expect(route.points.some((point) => point.highlightTitle === '入口')).toBe(true)
    expect(route.points.some((point) => point.text === 'x' || point.highlightTitle === 'x')).toBe(false)
  })

  it('keeps imported GPX names as plain text after nested entity and markup input', () => {
    const [route] = parseGpxRoute(`<gpx><rte><name>&lt;script&gt;alert(1)&lt;/script&gt; &amp;amp;</name>
      <rtept lat="30" lon="120"><name><![CDATA[<b>入口</b>]]></name></rtept>
      <rtept lat="30.01" lon="120.01" />
    </rte></gpx>`)

    expect(route.name).not.toMatch(/[<>]/)
    expect(route.name).not.toContain('&amp;')
    expect(route.points.find((point) => point.highlightTitle)?.highlightTitle).toBe('入口')
  })

  it.each([
    { type: 'MultiLineString', coordinates: [] },
    { type: 'FeatureCollection', features: [] },
    { type: 'Point', coordinates: [120, 30] }
  ])('rejects unsupported GeoJSON geometry: $type', (value) => {
    expect(() => parseGeoJsonRoute(JSON.stringify(value))).toThrowError(RouteImportError)
    try {
      parseGeoJsonRoute(JSON.stringify(value))
    } catch (error) {
      expect((error as RouteImportError).code).toBe('unsupported-geometry')
    }
  })

  it('keeps only 2D coordinates and selected name from a Feature', () => {
    const [route] = parseGeoJsonRoute(JSON.stringify({
      type: 'Feature',
      properties: { name: '山径', device: 'watch', private: 'drop' },
      geometry: { type: 'LineString', coordinates: [[120, 30, 77], [120.1, 30.1, 88]] }
    }), 'trail.geojson')

    expect(route.name).toBe('山径')
    expect(route.geometryCandidate.geometry.coordinates).toEqual([[120, 30], [120.1, 30.1]])
    expect(JSON.stringify(route)).not.toContain('watch')
    expect(JSON.stringify(route)).not.toContain('"private"')
  })

  it('simplifies a line above the confirmed geometry coordinate limit', () => {
    const coordinates = Array.from({ length: MAX_ROUTE_IMPORT_COORDINATES + 50 }, (_, index) => [
      120 + index / 1_000_000,
      30 + Math.sin(index / 20) / 100_000
    ])
    const [route] = parseGeoJsonRoute(JSON.stringify({ type: 'LineString', coordinates }))

    expect(route.summary.originalCoordinateCount).toBe(MAX_ROUTE_IMPORT_COORDINATES + 50)
    expect(route.summary.simplified).toBe(true)
    expect(route.geometryCandidate.geometry.coordinates.length).toBeLessThanOrEqual(MAX_ROUTE_IMPORT_COORDINATES)
    expect(route.geometryCandidate.geometry.coordinates.length).toBeGreaterThanOrEqual(2)
  })
})
