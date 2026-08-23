import { describe, expect, it } from 'vitest'
import {
  clearRouteCatalogFilters,
  cityParamsForPath,
  hasRouteCatalogFilters,
  legacyWorkshopParams,
  pathWithParams,
  readCityFilter,
  readRouteCatalogQuery,
  routeMatchesCatalogQuery,
  writeCityFilter
} from './routeCatalogParams'

describe('route catalog URL parameters', () => {
  it('stores a readable city name while keeping the adcode for the discovery RPC', () => {
    const next = writeCityFilter(
      new URLSearchParams('view=map'),
      { adcode: '330100', name: '杭州市' }
    )

    expect(next.toString()).toBe('view=map&city=330100&cityName=%E6%9D%AD%E5%B7%9E%E5%B8%82')
    expect(readCityFilter(next)).toEqual({ adcode: '330100', name: '杭州市' })
  })

  it('clears both city parameters without changing unrelated filters', () => {
    const next = writeCityFilter(
      new URLSearchParams('city=330100&cityName=%E6%9D%AD%E5%B7%9E%E5%B8%82&mode=walking'),
      undefined
    )

    expect(next.toString()).toBe('mode=walking')
  })

  it('preserves only the city when moving between discovery and workshop', () => {
    const next = cityParamsForPath(
      new URLSearchParams('city=330100&cityName=%E6%9D%AD%E5%B7%9E%E5%B8%82&mode=walking&q=lake')
    )

    expect(pathWithParams('/workshop', next)).toBe(
      '/workshop?city=330100&cityName=%E6%9D%AD%E5%B7%9E%E5%B8%82'
    )
  })

  it('moves legacy discovery recommendations to the workshop', () => {
    const migrated = legacyWorkshopParams(
      new URLSearchParams('recommend=nearby&nearLng=120.1&nearLat=30.2&city=330100&mode=walking')
    )

    expect(migrated?.toString()).toBe(
      'city=330100&recommend=nearby&nearLng=120.1&nearLat=30.2'
    )
    expect(legacyWorkshopParams(new URLSearchParams('mode=walking'))).toBeUndefined()
    expect(legacyWorkshopParams(new URLSearchParams('recommend=popular'))).toBeUndefined()
  })

  it('shares the same route filters between discovery and workshop without tags', () => {
    const params = new URLSearchParams(
      'q=lake&city=330100&cityName=%E6%9D%AD%E5%B7%9E%E5%B8%82&mode=walking&minDistanceM=3000&tags=old'
    )

    expect(readRouteCatalogQuery(params)).toMatchObject({
      cityAdcode: '330100',
      travelMode: 'walking',
      minDistanceM: 3000
    })
    expect(readRouteCatalogQuery(params).tags).toBeUndefined()
    expect(hasRouteCatalogFilters(params)).toBe(true)
    expect(clearRouteCatalogFilters(params).toString()).toBe('q=lake')
  })

  it('applies shared route filters to recommendation results', () => {
    const query = readRouteCatalogQuery(
      new URLSearchParams('mode=walking&maxDurationS=3600&difficulty=easy')
    )
    const route = {
      id: 'route-1',
      author: '',
      title: { 'zh-CN': '路线', en: 'Route' },
      description: { 'zh-CN': '', en: '' },
      downloads: 0,
      createdAt: '2026-07-01T00:00:00.000Z',
      travelMode: 'walking' as const,
      durationS: 1800,
      difficulty: 'easy' as const,
      tags: [],
      pointCount: 2
    }

    expect(routeMatchesCatalogQuery(route, query)).toBe(true)
    expect(routeMatchesCatalogQuery({ ...route, travelMode: 'cycling' }, query)).toBe(false)
  })
})
