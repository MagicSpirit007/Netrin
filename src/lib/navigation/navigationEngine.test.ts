import { describe, expect, it } from 'vitest'
import type { ActiveRouteView } from '../../data/types'
import {
  acknowledgeOffRouteFalsePositive,
  advanceNavigation,
  createNavigationState,
  isFirstOffRouteAlert,
  OFF_ROUTE_STRIKE_LIMIT,
  reduceGuideFalsePositive,
  reduceGuideLocationFix,
  type NavigationState
} from './navigationEngine'

const route: ActiveRouteView = {
  id: 'route',
  title: { 'zh-CN': '路线', en: 'Route' },
  description: { 'zh-CN': '', en: '' },
  travelMode: 'walking',
  stops: [
    {
      id: 'a',
      location: [119.7, 30.2],
      title: { 'zh-CN': 'A', en: 'A' },
      description: { 'zh-CN': '', en: '' },
      order: 1,
      media: []
    },
    {
      id: 'b',
      location: [119.71, 30.21],
      title: { 'zh-CN': 'B', en: 'B' },
      description: { 'zh-CN': '', en: '' },
      order: 2,
      media: []
    }
  ]
}

describe('navigation uses only the active provider leg for off-route checks', () => {
  it('does not invent a straight route from stored points when no AMap leg exists', () => {
    const state = {
      ...createNavigationState(route.id),
      phase: 'following' as const,
      currentStopIndex: 1,
      offRouteCount: 2
    }
    const next = advanceNavigation(
      route,
      state,
      { coordinate: [119.72, 30.22], timestamp: Date.now() },
      []
    )
    expect(next.phase).toBe('following')
    expect(next.offRouteCount).toBe(0)
  })
})

describe('off-route false-positive helpers', () => {
  it('detects only the first transition into offRoute for alert counting', () => {
    const following = {
      ...createNavigationState(route.id),
      phase: 'following' as const,
      currentStopIndex: 1,
      offRouteCount: OFF_ROUTE_STRIKE_LIMIT - 1
    }
    const firstOffRoute = {
      ...following,
      phase: 'offRoute' as const,
      offRouteCount: OFF_ROUTE_STRIKE_LIMIT,
      resumePhase: 'following' as const
    }
    const stillOffRoute = {
      ...firstOffRoute,
      offRouteCount: OFF_ROUTE_STRIKE_LIMIT + 1
    }

    expect(isFirstOffRouteAlert(following, firstOffRoute)).toBe(true)
    expect(isFirstOffRouteAlert(firstOffRoute, stillOffRoute)).toBe(false)
    expect(isFirstOffRouteAlert(following, following)).toBe(false)
  })

  it('returns following with offRouteCount cleared when the user marks a false positive', () => {
    const offRoute = {
      ...createNavigationState(route.id),
      phase: 'offRoute' as const,
      currentStopIndex: 1,
      offRouteCount: OFF_ROUTE_STRIKE_LIMIT,
      resumePhase: 'following' as const,
      currentPosition: [119.72, 30.22] as [number, number]
    }

    const next = acknowledgeOffRouteFalsePositive(offRoute)
    expect(next.phase).toBe('following')
    expect(next.offRouteCount).toBe(0)
    expect(next.resumePhase).toBe('following')
    expect(next.currentPosition).toEqual(offRoute.currentPosition)
    expect(next.currentStopIndex).toBe(1)
  })

  it('leaves non-offRoute states unchanged', () => {
    const following = {
      ...createNavigationState(route.id),
      phase: 'following' as const,
      currentStopIndex: 0,
      offRouteCount: 1
    }
    expect(acknowledgeOffRouteFalsePositive(following)).toEqual(following)
  })
})

describe('pure guide reducers keep quality intents exact-once', () => {
  const leg: [number, number][] = [
    [119.7, 30.2],
    [119.71, 30.21]
  ]

  it('emits off-route-alert only on the first transition into offRoute', () => {
    let state: NavigationState = {
      ...createNavigationState(route.id),
      phase: 'following',
      currentStopIndex: 1,
      offRouteCount: 0
    }
    const far = { coordinate: [119.75, 30.25] as [number, number], accuracy: 8, timestamp: Date.now() }

    const intents: Array<string | null> = []
    for (let i = 0; i < OFF_ROUTE_STRIKE_LIMIT + 2; i += 1) {
      const result = reduceGuideLocationFix({
        route,
        state,
        fix: { ...far, timestamp: Date.now() + i },
        activeLeg: leg,
        allowAdvance: true
      })
      intents.push(result.qualityIntent)
      state = result.state
    }

    expect(intents.filter((intent) => intent === 'off-route-alert')).toHaveLength(1)
    expect(state.phase).toBe('offRoute')
    // Further far fixes while already offRoute must not re-alert.
    const again = reduceGuideLocationFix({
      route,
      state,
      fix: far,
      activeLeg: leg,
      allowAdvance: true
    })
    expect(again.qualityIntent).toBeNull()
    expect(again.state.phase).toBe('offRoute')
  })

  it('records false-positive intent once then ignores non-offRoute replays', () => {
    const offRoute = {
      ...createNavigationState(route.id),
      phase: 'offRoute' as const,
      currentStopIndex: 1,
      offRouteCount: OFF_ROUTE_STRIKE_LIMIT,
      resumePhase: 'following' as const
    }
    const first = reduceGuideFalsePositive(offRoute)
    expect(first.qualityIntent).toBe('off-route-false-positive')
    expect(first.state.phase).toBe('following')
    expect(first.state.offRouteCount).toBe(0)

    const second = reduceGuideFalsePositive(first.state)
    expect(second.qualityIntent).toBeNull()
    expect(second.state).toEqual(first.state)

    const third = reduceGuideFalsePositive(first.state)
    expect(third.qualityIntent).toBeNull()
  })

  it('does not advance or alert when allowAdvance is false', () => {
    const state = {
      ...createNavigationState(route.id),
      phase: 'following' as const,
      currentStopIndex: 1,
      offRouteCount: OFF_ROUTE_STRIKE_LIMIT - 1
    }
    const result = reduceGuideLocationFix({
      route,
      state,
      fix: { coordinate: [119.75, 30.25], accuracy: 8, timestamp: Date.now() },
      activeLeg: leg,
      allowAdvance: false
    })
    expect(result.qualityIntent).toBeNull()
    expect(result.state.phase).toBe('following')
    expect(result.state.offRouteCount).toBe(OFF_ROUTE_STRIKE_LIMIT - 1)
    expect(result.state.currentPosition).toEqual([119.75, 30.25])
  })
})
