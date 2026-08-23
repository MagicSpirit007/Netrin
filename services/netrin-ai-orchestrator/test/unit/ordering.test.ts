import { describe, expect, it } from 'vitest'
import { buildTimeWarnings, orderResolvedStops, type ResolvedStop } from '../../src/harness/ordering.js'

function stop(id: string, lng: number, lat: number, priority: ResolvedStop['priority'] = 'preferred'): ResolvedStop {
  return {
    candidateId: id,
    reason: id,
    priority,
    poi: { poiId: id, name: id, wgs84: [lng, lat] }
  }
}

describe('deterministic route ordering and time budget', () => {
  it('optimizes an unlocked semantic order without moving the first stop', () => {
    const ordered = orderResolvedStops([
      stop('a', 120, 30),
      stop('b', 120.2, 30),
      stop('c', 120.1, 30)
    ], ['a', 'b', 'c'])
    expect(ordered.map((item) => item.candidateId)).toEqual(['a', 'c', 'b'])
  })

  it('preserves required semantic order and reports optional removal candidates', () => {
    const stops = [
      stop('required', 120, 30, 'required'),
      { ...stop('optional', 120.1, 30, 'optional'), estimatedStayMinutes: 80 }
    ]
    expect(orderResolvedStops(stops, ['required', 'optional']).map((item) => item.candidateId))
      .toEqual(['required', 'optional'])
    expect(buildTimeWarnings({
      region: '杭州',
      travelMode: 'walking',
      maximumStops: 2,
      durationMinutes: 60
    }, stops, 20).warnings).toEqual(['TIME_BUDGET_EXCEEDED_OPTIONAL:optional'])
  })
})
