import type { Coordinate } from '../../data/types'
import { wgs84ToGcj02 } from './coords'
import { loadAmap } from './loadAmap'
import type { AmapGeocoderResult } from './types'

const AMAP_GEOCODE_TIMEOUT_MS = 5000

export type AmapCityMetadata = {
  cityName?: string
  cityAdcode?: string
}

function firstNonEmptyString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

export function normalizeAmapCityMetadata(
  result: AmapGeocoderResult
): AmapCityMetadata {
  const component = result.regeocode?.addressComponent
  const city = Array.isArray(component?.city) ? undefined : component?.city
  return {
    cityName: firstNonEmptyString(city, component?.province, component?.district),
    cityAdcode: firstNonEmptyString(component?.adcode)
  }
}

export async function reverseGeocodeWgs84(
  coordinate: Coordinate
): Promise<AmapCityMetadata> {
  const AMap = await loadAmap()
  if (!AMap.Geocoder) throw new Error('AMap.Geocoder unavailable')
  const geocoder = new AMap.Geocoder()
  const gcjCoordinate = wgs84ToGcj02(coordinate)

  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (value: AmapCityMetadata) => {
      if (settled) return
      settled = true
      globalThis.clearTimeout(timer)
      resolve(value)
    }
    const fail = (error: unknown) => {
      if (settled) return
      settled = true
      globalThis.clearTimeout(timer)
      reject(error instanceof Error ? error : new Error('AMap reverse geocode failed'))
    }
    const timer = globalThis.setTimeout(
      () => fail(new Error('AMap reverse geocode failed: timeout')),
      AMAP_GEOCODE_TIMEOUT_MS
    )

    try {
      geocoder.getAddress(gcjCoordinate, (status, result) => {
        if (status === 'complete' && result.info === 'OK') {
          finish(normalizeAmapCityMetadata(result))
          return
        }
        fail(new Error(result.info || 'AMap reverse geocode failed'))
      })
    } catch (error) {
      fail(error)
    }
  })
}
