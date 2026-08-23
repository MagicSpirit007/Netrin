import { describe, expect, it } from 'vitest'
import { routeLineFromSegments } from './routeSegments'

describe('runtime AMap walking legs', () => {
  it('joins adjacent WGS-84 legs without duplicating their shared point', () => {
    const line = routeLineFromSegments([
      {
        id: 'a-b',
        fromPointId: 'a',
        toPointId: 'b',
        coordinates: [[119.7, 30.2], [119.71, 30.21]],
        kind: 'network',
        distanceMeters: 10,
        provider: 'amap-walking'
      },
      {
        id: 'b-c',
        fromPointId: 'b',
        toPointId: 'c',
        coordinates: [[119.71, 30.21], [119.72, 30.22]],
        kind: 'network',
        distanceMeters: 10,
        provider: 'amap-walking'
      }
    ])
    expect(line).toEqual([[119.7, 30.2], [119.71, 30.21], [119.72, 30.22]])
  })
})
