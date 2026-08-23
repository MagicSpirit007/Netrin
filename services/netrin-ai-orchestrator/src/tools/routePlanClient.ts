import { isCoordinate, type RoutePlanResponse as SegmentResponse } from '../../../../supabase/functions/netrin-route-plan/core.js'
import type { Coordinate, TravelMode, Wgs84LineString } from '../contracts/aiRoute.js'
import { AiRouteError } from '../errors.js'

export type PlannedRoute = {
  geometry: Wgs84LineString
  distanceMeters: number
  durationMinutes: number
}

export interface RoutePlanner {
  plan(stops: Coordinate[], travelMode: TravelMode, accessToken: string, signal?: AbortSignal): Promise<PlannedRoute>
}

function validateSegment(value: unknown): SegmentResponse {
  if (!value || typeof value !== 'object') throw new AiRouteError('AI_ROUTE_PROVIDER_UNAVAILABLE', 503)
  const segment = value as Partial<SegmentResponse>
  if (!segment.geometry || segment.geometry.type !== 'LineString' ||
      !Array.isArray(segment.geometry.coordinates) ||
      segment.geometry.coordinates.length < 2 ||
      segment.geometry.coordinates.length > 10_000 ||
      !segment.geometry.coordinates.every(isCoordinate) ||
      typeof segment.distanceM !== 'number' || !Number.isFinite(segment.distanceM)) {
    throw new AiRouteError('AI_ROUTE_PROVIDER_UNAVAILABLE', 503)
  }
  return segment as SegmentResponse
}

export class NetrinRoutePlanClient implements RoutePlanner {
  readonly #url: string
  readonly #anonKey: string
  readonly #fetch: typeof fetch

  constructor(url: string, anonKey: string, fetchImpl: typeof fetch = fetch) {
    this.#url = url
    this.#anonKey = anonKey
    this.#fetch = fetchImpl
  }

  async plan(
    stops: Coordinate[],
    travelMode: TravelMode,
    accessToken: string,
    signal?: AbortSignal
  ): Promise<PlannedRoute> {
    if (stops.length < 2) throw new AiRouteError('AI_REQUEST_INVALID', 400)
    const coordinates: Coordinate[] = []
    let distanceMeters = 0
    let durationSeconds = 0
    for (let index = 1; index < stops.length; index += 1) {
      let response: Response
      try {
        response = await this.#fetch(this.#url, {
          method: 'POST',
          signal,
          headers: {
            authorization: `Bearer ${accessToken}`,
            apikey: this.#anonKey,
            'content-type': 'application/json'
          },
          body: JSON.stringify({
            travelMode,
            from: stops[index - 1],
            to: stops[index],
            purpose: 'authoring'
          })
        })
      } catch {
        if (signal?.aborted) throw new AiRouteError('AI_ABORTED', 499)
        throw new AiRouteError('AI_ROUTE_PROVIDER_UNAVAILABLE', 503)
      }
      if (!response.ok) {
        throw new AiRouteError(
          response.status === 422 ? 'AI_ROUTE_UNREACHABLE' : 'AI_ROUTE_PROVIDER_UNAVAILABLE',
          response.status === 422 ? 422 : 503
        )
      }
      const segment = validateSegment(await response.json())
      segment.geometry.coordinates.forEach((coordinate) => {
        const previous = coordinates.at(-1)
        if (!previous || previous[0] !== coordinate[0] || previous[1] !== coordinate[1]) {
          coordinates.push([coordinate[0], coordinate[1]])
        }
      })
      distanceMeters += segment.distanceM
      durationSeconds += segment.durationS ?? 0
    }
    if (coordinates.length < 2 || coordinates.length > 50_000) {
      throw new AiRouteError('AI_ROUTE_PROVIDER_UNAVAILABLE', 503)
    }
    return {
      geometry: { type: 'LineString', coordinates },
      distanceMeters: Math.round(distanceMeters),
      durationMinutes: Math.ceil(durationSeconds / 60)
    }
  }
}
