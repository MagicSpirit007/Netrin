import type { AmapLngLat } from './types'

const PI = Math.PI
const SEMI_MAJOR_AXIS = 6378245.0
const ECCENTRICITY_SQUARED = 0.00669342162296594323

function outsideChina(lng: number, lat: number): boolean {
  return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271
}

function transformLat(lng: number, lat: number): number {
  let ret = -100.0 + 2.0 * lng + 3.0 * lat + 0.2 * lat * lat + 0.1 * lng * lat + 0.2 * Math.sqrt(Math.abs(lng))
  ret += ((20.0 * Math.sin(6.0 * lng * PI) + 20.0 * Math.sin(2.0 * lng * PI)) * 2.0) / 3.0
  ret += ((20.0 * Math.sin(lat * PI) + 40.0 * Math.sin((lat / 3.0) * PI)) * 2.0) / 3.0
  ret += ((160.0 * Math.sin((lat / 12.0) * PI) + 320 * Math.sin((lat * PI) / 30.0)) * 2.0) / 3.0
  return ret
}

function transformLng(lng: number, lat: number): number {
  let ret = 300.0 + lng + 2.0 * lat + 0.1 * lng * lng + 0.1 * lng * lat + 0.1 * Math.sqrt(Math.abs(lng))
  ret += ((20.0 * Math.sin(6.0 * lng * PI) + 20.0 * Math.sin(2.0 * lng * PI)) * 2.0) / 3.0
  ret += ((20.0 * Math.sin(lng * PI) + 40.0 * Math.sin((lng / 3.0) * PI)) * 2.0) / 3.0
  ret += ((150.0 * Math.sin((lng / 12.0) * PI) + 300.0 * Math.sin((lng / 30.0) * PI)) * 2.0) / 3.0
  return ret
}

export function wgs84ToGcj02(position: AmapLngLat): AmapLngLat {
  const [lng, lat] = position
  if (outsideChina(lng, lat)) return position

  let dLat = transformLat(lng - 105.0, lat - 35.0)
  let dLng = transformLng(lng - 105.0, lat - 35.0)
  const radLat = (lat / 180.0) * PI
  let magic = Math.sin(radLat)
  magic = 1 - ECCENTRICITY_SQUARED * magic * magic
  const sqrtMagic = Math.sqrt(magic)
  dLat = (dLat * 180.0) / (((SEMI_MAJOR_AXIS * (1 - ECCENTRICITY_SQUARED)) / (magic * sqrtMagic)) * PI)
  dLng = (dLng * 180.0) / ((SEMI_MAJOR_AXIS / sqrtMagic) * Math.cos(radLat) * PI)

  return [lng + dLng, lat + dLat]
}

/**
 * Iterative inverse of the public WGS-84 -> GCJ-02 transform.
 * Keeping the inverse here prevents provider coordinates from leaking into
 * route drafts, Supabase rows, or the navigation engine.
 */
export function gcj02ToWgs84(position: AmapLngLat): AmapLngLat {
  const [lng, lat] = position
  if (outsideChina(lng, lat)) return [lng, lat]

  let estimateLng = lng
  let estimateLat = lat
  for (let iteration = 0; iteration < 6; iteration += 1) {
    const [projectedLng, projectedLat] = wgs84ToGcj02([estimateLng, estimateLat])
    estimateLng -= projectedLng - lng
    estimateLat -= projectedLat - lat
  }
  return [estimateLng, estimateLat]
}

export function wgs84PathToGcj02(path: ReadonlyArray<AmapLngLat>): AmapLngLat[] {
  return path.map(wgs84ToGcj02)
}

export function gcj02PathToWgs84(path: ReadonlyArray<AmapLngLat>): AmapLngLat[] {
  return path.map(gcj02ToWgs84)
}
