import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getAmapStyleUrl } from '../lib/amap/mapStyles'
import { MAP_STYLE_IDS } from './types'

const mocks = vi.hoisted(() => ({ store: new Map<string, unknown>() }))

vi.mock('localforage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => mocks.store.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: unknown) => {
      mocks.store.set(key, value)
      return value
    })
  }
}))

import { loadAppearanceSettings } from './settings'

describe('map appearance settings', () => {
  beforeEach(() => mocks.store.clear())

  it('includes the seven selectable AMap styles in the required order', () => {
    expect(MAP_STYLE_IDS).toEqual([
      'normal',
      'dark',
      'light',
      'fresh',
      'grey',
      'macaron',
      'darkblue'
    ])
    expect(MAP_STYLE_IDS.map(getAmapStyleUrl)).toEqual(
      MAP_STYLE_IDS.map((styleId) => `amap://styles/${styleId}`)
    )
  })

  it.each([
    ['field-console', 'dark'],
    ['campus-atlas', 'normal'],
    ['forest-walk', 'fresh'],
    ['night-trace', 'darkblue']
  ] as const)('migrates the previous %s selection to %s', async (legacyId, expectedId) => {
    mocks.store.set('netrin.appearance', {
      mapStyleId: legacyId,
      appearanceId: 'field-guide-phenotype'
    })

    await expect(loadAppearanceSettings()).resolves.toMatchObject({ mapStyleId: expectedId })
  })

  it.each(['whitesmoke', 'graffiti', 'blue', 'wine'])(
    'migrates the removed %s selection to the default dark style',
    async (removedId) => {
      mocks.store.set('netrin.appearance', {
        mapStyleId: removedId,
        appearanceId: 'field-guide-phenotype'
      })

      await expect(loadAppearanceSettings()).resolves.toMatchObject({ mapStyleId: 'dark' })
    }
  )
})
