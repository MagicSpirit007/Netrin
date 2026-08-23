import { load as loadAmapJsApi } from '@amap/amap-jsapi-loader'
import type { AMapNamespace, AmapErrorCode, AmapRuntimeConfig } from './types'

declare global {
  interface Window {
    _AMapSecurityConfig?: {
      serviceHost?: string
      securityJsCode?: string
    }
  }
}

const AMAP_JSAPI_VERSION = '2.0'
const AMAP_PLUGINS = [
  'AMap.Geolocation',
  'AMap.Walking',
  'AMap.PlaceSearch',
  'AMap.DistrictSearch',
  'AMap.Geocoder'
]

let cachedAmapPromise: Promise<AMapNamespace> | null = null

export class AmapLoadFailure extends Error {
  readonly code: AmapErrorCode
  readonly causeValue?: unknown

  constructor(code: AmapErrorCode, message: string, causeValue?: unknown) {
    super(message)
    this.name = 'AmapLoadFailure'
    this.code = code
    this.causeValue = causeValue
  }
}

const trimEnv = (value: string | undefined): string => value?.trim() ?? ''

export function getAmapRuntimeConfig(): AmapRuntimeConfig {
  const key = trimEnv(import.meta.env.VITE_AMAP_KEY)
  const serviceHost = trimEnv(import.meta.env.VITE_AMAP_SERVICE_HOST)
  // Keep the development-only jscode behind a compile-time DEV guard so a
  // production Rollup build can remove both the branch and the inlined value.
  const securityJsCode = import.meta.env.DEV
    ? trimEnv(import.meta.env.VITE_AMAP_SECURITY_JSCODE)
    : ''
  return {
    key,
    hasKey: key.length > 0,
    serviceHost: serviceHost || undefined,
    securityJsCode: securityJsCode || undefined
  }
}

export async function loadAmap(): Promise<AMapNamespace> {
  const config = getAmapRuntimeConfig()

  if (!config.hasKey) {
    throw new AmapLoadFailure('missing-key', 'VITE_AMAP_KEY is not configured.')
  }

  if (typeof window !== 'undefined') {
    if (config.serviceHost) {
      window._AMapSecurityConfig = {
        ...window._AMapSecurityConfig,
        serviceHost: config.serviceHost
      }
    } else if (import.meta.env.DEV && config.securityJsCode) {
      window._AMapSecurityConfig = {
        ...window._AMapSecurityConfig,
        securityJsCode: config.securityJsCode
      }
    }
  }

  cachedAmapPromise ??= loadAmapJsApi({
    key: config.key,
    version: AMAP_JSAPI_VERSION,
    plugins: AMAP_PLUGINS
  }) as Promise<AMapNamespace>

  try {
    return await cachedAmapPromise
  } catch (error) {
    cachedAmapPromise = null
    throw new AmapLoadFailure('load-failed', 'AMap JS API failed to load.', error)
  }
}
