import { loadAmap } from './loadAmap'
import { gcj02ToWgs84, wgs84ToGcj02 } from './coords'
import { amapLngLatTuple } from './types'
import type { AMapNamespace, AmapLngLat, AmapLngLatObject, AmapLocationFix } from './types'
import type { LocationFix } from '../navigation/geo'

function toLngLat(position: AmapLngLat | AmapLngLatObject | undefined): AmapLngLat | undefined {
  return amapLngLatTuple(position)
}

function isGeolocationError(error: unknown): error is GeolocationPositionError {
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'number'
}

function errorMessage(error: unknown): string {
  if (isGeolocationError(error)) {
    if (error.code === error.PERMISSION_DENIED) return '浏览器定位权限被拒绝。'
    if (error.code === error.POSITION_UNAVAILABLE) return '浏览器暂时无法获取当前位置。'
    if (error.code === error.TIMEOUT) return '定位超时。'
  }
  if (error instanceof Error) {
    const message = error.message
    const normalized = message.toLowerCase()
    if (normalized.includes('permission denied')) return '浏览器定位权限被拒绝。'
    if (normalized.includes('timeout')) return '定位超时。'
    if (normalized.includes('iplocation')) return '高德 IP 定位暂时不可用。'
    return message
  }
  return '定位失败。'
}

function ensureGeolocationPlugin(AMap: AMapNamespace): Promise<void> {
  if (AMap.Geolocation) return Promise.resolve()
  const plugin = AMap.plugin
  if (typeof plugin !== 'function') return Promise.reject(new Error('AMap.Geolocation is not available.'))

  return new Promise((resolve, reject) => {
    plugin('AMap.Geolocation', () => {
      if (AMap.Geolocation) {
        resolve()
        return
      }
      reject(new Error('AMap.Geolocation is not available.'))
    })
  })
}

function getAmapPluginPosition(AMap: AMapNamespace): Promise<AmapLocationFix> {
  const Geolocation = AMap.Geolocation
  if (!Geolocation) return Promise.reject(new Error('AMap.Geolocation is not available.'))

  const geolocation = new Geolocation({
    enableHighAccuracy: true,
    timeout: 10000,
    convert: true,
    showButton: false,
    showMarker: false,
    showCircle: false,
    panToLocation: false,
    zoomToAccuracy: false
  })

  return new Promise((resolve, reject) => {
    geolocation.getCurrentPosition((status, result) => {
      const position = toLngLat(result.position)
      if (status === 'complete' && position) {
        resolve({ position, accuracy: result.accuracy, raw: result, source: 'amap-geolocation' })
        return
      }
      reject(new Error(result.message || result.info || 'AMap geolocation failed.'))
    })
  })
}

function getBrowserGpsPosition(): Promise<Omit<AmapLocationFix, 'source'>> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('当前浏览器不支持定位。'))
      return
    }

    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          position: [position.coords.longitude, position.coords.latitude],
          accuracy: position.coords.accuracy,
          raw: position
        }),
      reject,
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
    )
  })
}

function convertGpsPosition(AMap: AMapNamespace, position: AmapLngLat): Promise<AmapLngLat> {
  if (typeof AMap.convertFrom !== 'function') return Promise.resolve(wgs84ToGcj02(position))

  return new Promise((resolve) => {
    AMap.convertFrom?.(position, 'gps', (status, result) => {
      const converted = toLngLat(result.locations?.[0])
      if (status === 'complete' && converted) {
        resolve(converted)
        return
      }
      resolve(wgs84ToGcj02(position))
    })
  })
}

async function getBrowserPositionOnAmap(AMap: AMapNamespace): Promise<AmapLocationFix> {
  const browserFix = await getBrowserGpsPosition()
  return {
    ...browserFix,
    position: await convertGpsPosition(AMap, browserFix.position),
    source: 'browser-geolocation'
  }
}

export async function getAmapCurrentPosition(): Promise<AmapLocationFix> {
  const AMap = await loadAmap()
  const failures: string[] = []

  try {
    await ensureGeolocationPlugin(AMap)
    return await getAmapPluginPosition(AMap)
  } catch (error) {
    failures.push(errorMessage(error))
  }

  try {
    return await getBrowserPositionOnAmap(AMap)
  } catch (error) {
    failures.push(errorMessage(error))
  }

  throw new Error(Array.from(new Set(failures.filter(Boolean))).join('；') || '定位失败。')
}

/** Provider-neutral location fix for the rest of Netrin. */
export async function getCurrentWgs84Fix(): Promise<LocationFix> {
  const fix = await getAmapCurrentPosition()
  const coordinate = gcj02ToWgs84(fix.position)
  return {
    coordinate: [coordinate[0], coordinate[1]],
    accuracy: fix.accuracy,
    heading: fix.heading,
    timestamp: fix.timestamp ?? Date.now()
  }
}
