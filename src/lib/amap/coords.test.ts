import { describe, expect, it } from 'vitest'
import { gcj02PathToWgs84, gcj02ToWgs84, wgs84PathToGcj02, wgs84ToGcj02 } from './coords'

describe('AMap coordinate boundary', () => {
  it('round-trips a Hangzhou WGS-84 coordinate with sub-meter drift', () => {
    const wgs84 = [119.7314, 30.2577] as const
    const restored = gcj02ToWgs84(wgs84ToGcj02(wgs84))

    expect(restored[0]).toBeCloseTo(wgs84[0], 6)
    expect(restored[1]).toBeCloseTo(wgs84[1], 6)
  })

  it('does not shift coordinates outside mainland China', () => {
    const coordinate = [2.3522, 48.8566] as const
    expect(wgs84ToGcj02(coordinate)).toEqual(coordinate)
    expect(gcj02ToWgs84(coordinate)).toEqual(coordinate)
  })

  it('converts every point in a route without mutating the source', () => {
    const source = [
      [119.7314, 30.2577],
      [119.732, 30.2582]
    ] as const
    const gcj = wgs84PathToGcj02(source)
    const restored = gcj02PathToWgs84(gcj)

    expect(gcj).not.toBe(source)
    expect(restored[0][0]).toBeCloseTo(source[0][0], 6)
    expect(restored[1][1]).toBeCloseTo(source[1][1], 6)
  })
})
