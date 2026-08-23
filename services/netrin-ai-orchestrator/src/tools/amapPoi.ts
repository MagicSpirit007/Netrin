import { randomUUID } from 'node:crypto'
import { setTimeout as sleep } from 'node:timers/promises'
import { gcj02ToWgs84, isCoordinate } from '../../../../supabase/functions/netrin-route-plan/core.js'
import type { Coordinate } from '../contracts/aiRoute.js'
import { AiRouteError } from '../errors.js'

export type TrustedPoi = {
  poiId: string
  name: string
  category?: string
  district?: string
  displayAddress?: string
  wgs84: Coordinate
}

export type AgentPoiOption = Omit<TrustedPoi, 'poiId' | 'wgs84'> & {
  poiRef: string
}

export interface PoiProvider {
  search(query: string, region: string, signal?: AbortSignal): Promise<AgentPoiOption[]>
  resolveAgentRef(poiRef: string): TrustedPoi | undefined
  getById(poiId: string, region: string, signal?: AbortSignal): Promise<TrustedPoi>
}

type AmapPoiRecord = {
  id?: unknown
  name?: unknown
  type?: unknown
  adname?: unknown
  address?: unknown
  location?: unknown
}

const AMAP_QPS_LIMIT_INFOCODES = new Set(['10014', '10015', '10019', '10020', '10021', '10022', '10023'])
const AMAP_QPS_RETRY_DELAY_MS = 1_100

function parsePoi(raw: AmapPoiRecord): TrustedPoi | undefined {
  if (typeof raw.id !== 'string' || typeof raw.name !== 'string' || typeof raw.location !== 'string') {
    return undefined
  }
  const gcj = raw.location.split(',').map(Number)
  if (!isCoordinate(gcj)) return undefined
  const address = Array.isArray(raw.address) ? raw.address.join('') : raw.address
  return {
    poiId: raw.id,
    name: raw.name.trim(),
    ...(typeof raw.type === 'string' && raw.type.trim() ? { category: raw.type.trim() } : {}),
    ...(typeof raw.adname === 'string' && raw.adname.trim() ? { district: raw.adname.trim() } : {}),
    ...(typeof address === 'string' && address.trim() ? { displayAddress: address.trim() } : {}),
    wgs84: gcj02ToWgs84([gcj[0], gcj[1]])
  }
}

export class AmapPoiClient implements PoiProvider {
  readonly #key: string
  readonly #fetch: typeof fetch
  readonly #agentRefs = new Map<string, TrustedPoi>()

  constructor(key: string, fetchImpl: typeof fetch = fetch) {
    this.#key = key
    this.#fetch = fetchImpl
  }

  async search(query: string, region: string, signal?: AbortSignal): Promise<AgentPoiOption[]> {
    const url = new URL('https://restapi.amap.com/v5/place/text')
    url.searchParams.set('key', this.#key)
    url.searchParams.set('keywords', query.slice(0, 200))
    url.searchParams.set('region', region.slice(0, 80))
    url.searchParams.set('city_limit', 'true')
    url.searchParams.set('show_fields', 'business')
    url.searchParams.set('page_size', '5')
    const data = await this.#request(url, signal)
    const pois = Array.isArray(data.pois)
      ? data.pois.flatMap((raw): TrustedPoi[] => {
          const poi = parsePoi(raw as AmapPoiRecord)
          return poi ? [poi] : []
        })
      : []
    return pois.map((poi) => {
      const poiRef = randomUUID()
      this.#agentRefs.set(poiRef, poi)
      return {
        poiRef,
        name: poi.name,
        ...(poi.category ? { category: poi.category } : {}),
        ...(poi.district ? { district: poi.district } : {}),
        ...(poi.displayAddress ? { displayAddress: poi.displayAddress } : {})
      }
    })
  }

  resolveAgentRef(poiRef: string): TrustedPoi | undefined {
    return this.#agentRefs.get(poiRef)
  }

  async getById(poiId: string, region: string, signal?: AbortSignal): Promise<TrustedPoi> {
    const url = new URL('https://restapi.amap.com/v5/place/detail')
    url.searchParams.set('key', this.#key)
    url.searchParams.set('id', poiId)
    url.searchParams.set('show_fields', 'business')
    const data = await this.#request(url, signal)
    const poi = Array.isArray(data.pois)
      ? data.pois.map((raw) => parsePoi(raw as AmapPoiRecord)).find(Boolean)
      : undefined
    if (!poi) throw new AiRouteError('AI_POI_NOT_FOUND', 404)
    if (region && !JSON.stringify([poi.district, poi.displayAddress]).includes(region) &&
        !region.includes(poi.district ?? '')) {
      // AMap POI ids are trusted; a region mismatch remains visible for user disambiguation.
    }
    return poi
  }

  async #request(url: URL, signal?: AbortSignal): Promise<Record<string, unknown>> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let response: Response
      try {
        response = await this.#fetch(url, { signal })
      } catch {
        if (signal?.aborted) throw new AiRouteError('AI_ABORTED', 499)
        throw new AiRouteError('AI_POI_PROVIDER_UNAVAILABLE', 503)
      }
      if (!response.ok) throw new AiRouteError('AI_POI_PROVIDER_UNAVAILABLE', 503)
      const data = await response.json() as Record<string, unknown>
      if (String(data.status) === '1') return data
      if (attempt === 0 && AMAP_QPS_LIMIT_INFOCODES.has(String(data.infocode))) {
        try {
          await sleep(AMAP_QPS_RETRY_DELAY_MS, undefined, { signal })
        } catch {
          if (signal?.aborted) throw new AiRouteError('AI_ABORTED', 499)
          throw new AiRouteError('AI_POI_PROVIDER_UNAVAILABLE', 503)
        }
        continue
      }
      throw new AiRouteError('AI_POI_PROVIDER_UNAVAILABLE', 503)
    }
    throw new AiRouteError('AI_POI_PROVIDER_UNAVAILABLE', 503)
  }
}
