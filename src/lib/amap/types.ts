export type AmapLngLat = readonly [number, number]

export type AmapLoadStatus = 'idle' | 'loading' | 'ready' | 'missing-key' | 'failed'
export type AmapErrorCode = 'missing-key' | 'load-failed' | 'location-failed' | 'route-failed' | 'uri-unavailable'

export type AmapRuntimeConfig = {
  key: string
  hasKey: boolean
  serviceHost?: string
  securityJsCode?: string
}

export type AmapLngLatObject = {
  getLng?: () => number | string
  getLat?: () => number | string
  lng?: number | string
  lat?: number | string
}

export type AmapBoundsInstance = {
  extend: (position: AmapLngLat | AmapLngLatObject) => AmapBoundsInstance
  getSouthWest?: () => AmapLngLat | AmapLngLatObject
  getNorthEast?: () => AmapLngLat | AmapLngLatObject
}

export type AmapLocationFix = {
  position: AmapLngLat
  accuracy?: number
  heading?: number
  timestamp?: number
  source?: 'amap-geolocation' | 'browser-geolocation'
  raw: unknown
}

export type AmapEventTarget = {
  on: (eventName: string, handler: (event: unknown) => void) => void
  off?: (eventName: string, handler: (event: unknown) => void) => void
}

export type AmapMapInstance = AmapEventTarget & {
  destroy: () => void
  add?: (overlay: unknown | unknown[]) => void
  remove?: (overlay: unknown | unknown[]) => void
  clearMap?: () => void
  setCenter: (position: AmapLngLat) => void
  panTo?: (position: AmapLngLat) => void
  setZoom?: (zoom: number) => void
  getZoom?: () => number
  getBounds?: () => AmapBoundsInstance
  setBounds?: (
    bounds: AmapBoundsInstance,
    immediately?: boolean,
    duration?: number,
    avoid?: [number, number, number, number]
  ) => void
  setZoomAndCenter?: (zoom: number, center: AmapLngLat) => void
  setMapStyle?: (style: string) => void
  setFitView?: (
    overlays?: unknown[] | null,
    immediately?: boolean,
    avoid?: [number, number, number, number],
    maxZoom?: number
  ) => void
  setRotation?: (rotation: number) => void
  getRotation?: () => number
  setStatus?: (status: Record<string, boolean>) => void
  addControl?: (control: unknown) => void
}

export type AmapOverlayInstance = AmapEventTarget & {
  setMap?: (map: AmapMapInstance | null) => void
  show?: () => void
  hide?: () => void
}

export type AmapMarkerInstance = AmapOverlayInstance & {
  setPosition?: (position: AmapLngLat) => void
  getContent?: () => HTMLElement | string
}

export type AmapPolylineInstance = AmapOverlayInstance & {
  setPath?: (path: AmapLngLat[]) => void
}

export type AmapGeolocationResult = {
  position?: AmapLngLat | AmapLngLatObject
  accuracy?: number
  heading?: number
  info?: string
  message?: string
}

export type AmapGeolocationInstance = {
  getCurrentPosition: (
    callback: (status: 'complete' | 'error' | string, result: AmapGeolocationResult) => void
  ) => void
}

export type AmapConvertResult = {
  locations?: Array<AmapLngLat | AmapLngLatObject>
  info?: string
}

export type AmapWalkStepResult = {
  instruction?: string
  distance?: number
  time?: number
  path?: Array<AmapLngLat | AmapLngLatObject>
}

export type AmapWalkRouteResult = {
  distance?: number
  time?: number
  steps?: AmapWalkStepResult[]
}

export type AmapWalkingResult = {
  routes?: AmapWalkRouteResult[]
  info?: string
}

export type AmapWalkingInstance = {
  search: (
    origin: AmapLngLat,
    destination: AmapLngLat,
    callback: (status: 'complete' | 'error' | 'no_data' | string, result: AmapWalkingResult) => void
  ) => void
  clear?: () => void
}

export type AmapPoiWire = {
  id?: string
  name?: string
  address?: string
  adcode?: string
  cityname?: string
  location?: AmapLngLat | AmapLngLatObject
}

export type AmapPlaceSearchResult = {
  info?: string
  poiList?: { pois?: AmapPoiWire[] }
}

export type AmapPlaceSearchInstance = {
  search: (keyword: string, callback: (status: string, result: AmapPlaceSearchResult) => void) => void
  searchNearBy?: (
    keyword: string,
    center: AmapLngLat,
    radius: number,
    callback: (status: string, result: AmapPlaceSearchResult) => void
  ) => void
  searchInBounds?: (
    keyword: string,
    bounds: readonly [number, number, number, number],
    callback: (status: string, result: AmapPlaceSearchResult) => void
  ) => void
}

export type AmapDistrictWire = {
  adcode?: string
  name?: string
  level?: string
  center?: AmapLngLat | AmapLngLatObject
  boundaries?: Array<Array<AmapLngLat | AmapLngLatObject>>
  districtList?: AmapDistrictWire[]
}

export type AmapDistrictSearchResult = {
  info?: string
  districtList?: AmapDistrictWire[]
}

export type AmapDistrictSearchInstance = {
  search: (keyword: string, callback: (status: string, result: AmapDistrictSearchResult) => void) => void
}

export type AmapAddressComponentWire = {
  adcode?: string
  city?: string | string[]
  province?: string
  district?: string
}

export type AmapGeocoderResult = {
  info?: string
  regeocode?: {
    addressComponent?: AmapAddressComponentWire
  }
}

export type AmapGeocoderInstance = {
  getAddress: (
    location: AmapLngLat,
    callback: (status: string, result: AmapGeocoderResult) => void
  ) => void
}

export type AMapNamespace = {
  Map: new (container: HTMLElement | string, options: Record<string, unknown>) => AmapMapInstance
  Marker: new (options: Record<string, unknown>) => AmapMarkerInstance
  Polyline: new (options: Record<string, unknown>) => AmapPolylineInstance
  Pixel: new (x: number, y: number) => unknown
  Bounds?: new (southWest?: AmapLngLat, northEast?: AmapLngLat) => AmapBoundsInstance
  plugin?: (plugins: string | string[], callback: () => void) => void
  convertFrom?: (
    position: AmapLngLat | AmapLngLat[],
    type: 'gps' | 'baidu' | 'mapbar',
    callback: (status: 'complete' | 'error' | string, result: AmapConvertResult) => void
  ) => void
  Geolocation?: new (options?: Record<string, unknown>) => AmapGeolocationInstance
  Walking?: new (options?: Record<string, unknown>) => AmapWalkingInstance
  PlaceSearch?: new (options?: Record<string, unknown>) => AmapPlaceSearchInstance
  DistrictSearch?: new (options?: Record<string, unknown>) => AmapDistrictSearchInstance
  Geocoder?: new (options?: Record<string, unknown>) => AmapGeocoderInstance
}

export function amapLngLatTuple(value: AmapLngLat | AmapLngLatObject | undefined): AmapLngLat | undefined {
  if (!value) return undefined
  let rawLng: unknown
  let rawLat: unknown
  if (Array.isArray(value)) {
    rawLng = value[0]
    rawLat = value[1]
  } else {
    const point = value as AmapLngLatObject
    if (typeof point.getLng === 'function' && typeof point.getLat === 'function') {
      rawLng = point.getLng()
      rawLat = point.getLat()
    } else {
      rawLng = point.lng
      rawLat = point.lat
    }
  }
  const lng = Number(rawLng)
  const lat = Number(rawLat)
  return Number.isFinite(lng) && Number.isFinite(lat) ? [lng, lat] : undefined
}
