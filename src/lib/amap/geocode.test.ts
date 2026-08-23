import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./loadAmap', () => ({ loadAmap: vi.fn() }))
import { loadAmap } from './loadAmap'
import {
  normalizeAmapCityMetadata,
  reverseGeocodeWgs84
} from './geocode'
import type { AMapNamespace } from './types'

describe('AMap reverse-geocode provider boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses the province name for municipalities whose city field is an array', () => {
    expect(normalizeAmapCityMetadata({
      regeocode: {
        addressComponent: {
          city: [],
          province: '上海市',
          district: '长宁区',
          adcode: '310105'
        }
      }
    })).toEqual({
      cityName: '上海市',
      cityAdcode: '310105'
    })
  })

  it('converts WGS-84 to the provider boundary and returns city metadata', async () => {
    let providerCoordinate: readonly [number, number] | undefined
    vi.mocked(loadAmap).mockResolvedValue({
      Geocoder: class {
        getAddress(
          coordinate: readonly [number, number],
          callback: (status: string, result: {
            info?: string
            regeocode?: {
              addressComponent?: {
                city?: string
                adcode?: string
              }
            }
          }) => void
        ) {
          providerCoordinate = coordinate
          callback('complete', {
            info: 'OK',
            regeocode: {
              addressComponent: {
                city: '酒泉市',
                adcode: '620900'
              }
            }
          })
        }
      }
    } as unknown as AMapNamespace)

    await expect(reverseGeocodeWgs84([98.49, 39.73])).resolves.toEqual({
      cityName: '酒泉市',
      cityAdcode: '620900'
    })
    expect(providerCoordinate).toBeDefined()
    expect(providerCoordinate).not.toEqual([98.49, 39.73])
  })

  it('rejects provider failures so authoring can continue without a city patch', async () => {
    vi.mocked(loadAmap).mockResolvedValue({
      Geocoder: class {
        getAddress(
          _coordinate: readonly [number, number],
          callback: (status: string, result: { info?: string }) => void
        ) {
          callback('error', { info: 'SERVICE_NOT_AVAILABLE' })
        }
      }
    } as unknown as AMapNamespace)

    await expect(reverseGeocodeWgs84([98.49, 39.73])).rejects.toThrow(
      'SERVICE_NOT_AVAILABLE'
    )
  })
})
