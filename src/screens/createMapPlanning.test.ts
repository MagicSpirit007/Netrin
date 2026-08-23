import { describe, expect, it } from 'vitest'
import {
  candidateFromAmapResult,
  candidateFromMapTap,
  cityPatchFromCandidate,
  createMapPlanningPoint,
  mapPlanningPointRole
} from './createMapPlanning'

describe('map-planning candidate helpers', () => {
  it('keeps an AMap result transient while preserving its WGS-84 display data', () => {
    const candidate = candidateFromAmapResult({
      id: 'poi-1',
      kind: 'place',
      label: '中山公园',
      address: '长宁路 780 号',
      coordinate: [121.42, 31.22],
      cityName: '上海市',
      cityAdcode: '310000'
    })

    expect(candidate).toEqual({
      source: 'amap-place',
      label: '中山公园',
      address: '长宁路 780 号',
      coordinate: [121.42, 31.22],
      cityName: '上海市',
      cityAdcode: '310000'
    })
    expect(candidate).not.toHaveProperty('id')
  })

  it('rejects city results and place results without a usable coordinate', () => {
    expect(candidateFromAmapResult({
      id: 'city-1',
      kind: 'city',
      label: '上海市',
      cityName: '上海市',
      cityAdcode: '310000',
      coordinate: [121.47, 31.23]
    })).toBeUndefined()
    expect(candidateFromAmapResult({
      id: 'poi-2',
      kind: 'place',
      label: '无坐标地点'
    })).toBeUndefined()
  })

  it('prefills only the highlight title when confirming a searched place', () => {
    const candidate = candidateFromAmapResult({
      id: 'poi-1',
      kind: 'place',
      label: ' 中山公园 ',
      address: '不应进入说明',
      coordinate: [121.42, 31.22]
    })!
    const point = createMapPlanningPoint({
      candidate,
      id: 'point-1',
      index: 2
    })

    expect(point).toMatchObject({
      id: 'point-1',
      index: 2,
      raw: [121.42, 31.22],
      final: [121.42, 31.22],
      highlightTitle: '中山公园',
      text: '',
      snapped: false,
      media: []
    })
    expect(point).not.toHaveProperty('address')
  })

  it('keeps a map-tap point unnamed for later editing', () => {
    const candidate = candidateFromMapTap([104.1, 35.2])
    const point = createMapPlanningPoint({
      candidate,
      id: 'point-2',
      index: 1
    })

    expect(candidate.source).toBe('map-tap')
    expect(point.highlightTitle).toBeUndefined()
  })

  it('fills route city only when the draft does not already have one', () => {
    const candidate = {
      source: 'amap-place' as const,
      coordinate: [121.42, 31.22] as [number, number],
      cityName: '上海市',
      cityAdcode: '310000'
    }
    expect(cityPatchFromCandidate({}, candidate)).toEqual({
      cityName: '上海市',
      cityAdcode: '310000'
    })
    expect(cityPatchFromCandidate({
      cityName: '杭州市',
      cityAdcode: '330100'
    }, candidate)).toEqual({})
  })

  it('labels an ordered list as start, via, and end', () => {
    expect(mapPlanningPointRole(0, 1)).toBe('start')
    expect(mapPlanningPointRole(0, 3)).toBe('start')
    expect(mapPlanningPointRole(1, 3)).toBe('via')
    expect(mapPlanningPointRole(2, 3)).toBe('end')
  })
})
