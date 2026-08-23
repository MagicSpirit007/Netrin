import type { Coordinate, RecordedPoint, RouteDraft } from '../data/types'
import type { AmapSearchResult } from '../lib/amap/search'

export type MapPlanningCandidate = {
  source: 'amap-place' | 'map-tap'
  coordinate: Coordinate
  label?: string
  address?: string
  cityName?: string
  cityAdcode?: string
}

export type MapPlanningPointRole = 'start' | 'via' | 'end'

export function candidateFromAmapResult(
  result: AmapSearchResult
): MapPlanningCandidate | undefined {
  if (result.kind !== 'place' || !result.coordinate) return undefined
  return {
    source: 'amap-place',
    coordinate: [result.coordinate[0], result.coordinate[1]],
    label: result.label,
    address: result.address,
    cityName: result.cityName,
    cityAdcode: result.cityAdcode
  }
}

export function candidateFromMapTap(coordinate: Coordinate): MapPlanningCandidate {
  return {
    source: 'map-tap',
    coordinate: [coordinate[0], coordinate[1]]
  }
}

export function createMapPlanningPoint(input: {
  candidate: MapPlanningCandidate
  id: string
  index: number
}): RecordedPoint {
  const coordinate: Coordinate = [
    input.candidate.coordinate[0],
    input.candidate.coordinate[1]
  ]
  return {
    id: input.id,
    index: input.index,
    raw: coordinate,
    final: [coordinate[0], coordinate[1]],
    snapped: false,
    text: '',
    highlightTitle: input.candidate.label?.trim() || undefined,
    media: []
  }
}

export function cityPatchFromCandidate(
  draft: Pick<RouteDraft, 'cityName' | 'cityAdcode'>,
  candidate: MapPlanningCandidate
): Pick<RouteDraft, 'cityName' | 'cityAdcode'> {
  if (draft.cityName || draft.cityAdcode) return {}
  return {
    cityName: candidate.cityName?.trim() || undefined,
    cityAdcode: candidate.cityAdcode?.trim() || undefined
  }
}

export function mapPlanningPointRole(
  index: number,
  total: number
): MapPlanningPointRole {
  if (index === 0) return 'start'
  if (index === total - 1) return 'end'
  return 'via'
}
