import type { ActiveRouteView, ActiveStop, Coordinate } from '../../data/types'
import {
  distanceMeters,
  distanceToTargetAlongLine,
  projectPointToLine,
  type LocationFix
} from './geo'

export type NavigationPhase =
  | 'idle'
  | 'acquiring'
  | 'toStart'
  | 'following'
  | 'atStop'
  | 'offRoute'
  | 'lowAccuracy'
  | 'completed'
  | 'locationError'

type ResumableNavigationPhase = 'toStart' | 'following'

export type NavigationState = {
  phase: NavigationPhase
  routeId?: string
  currentStopIndex: number
  currentPosition?: Coordinate
  accuracyMeters?: number
  heading?: number
  timestamp?: number
  offRouteCount: number
  resumePhase?: ResumableNavigationPhase
  arrivedStopId?: string
}

export type NavigationOutput = {
  phase: NavigationPhase
  visibleStop?: ActiveStop
  visibleStopIndex: number
  targetStop?: ActiveStop
  targetStopIndex: number
  activeMapStopId?: string
  targetCoordinate?: Coordinate
  targetDistanceMeters?: number
  offRouteDistanceMeters?: number
  accuracyMeters?: number
  hasNextStop: boolean
}

export const START_RADIUS_METERS = 35
export const ARRIVAL_RADIUS_METERS = 25
export const ARRIVAL_MAX_RADIUS_METERS = 45
export const LOW_ACCURACY_THRESHOLD_METERS = 50
export const OFF_ROUTE_THRESHOLD_METERS = 30
export const OFF_ROUTE_STRIKE_LIMIT = 3

export function createNavigationState(routeId?: string): NavigationState {
  return {
    phase: 'idle',
    routeId,
    currentStopIndex: 0,
    offRouteCount: 0
  }
}

export function setNavigationLocationError(state: NavigationState): NavigationState {
  return {
    ...state,
    phase: 'locationError',
    offRouteCount: 0,
    resumePhase: undefined
  }
}

/**
 * True only on the first transition into `offRoute` (strike limit just crossed).
 * Callers use this to count a single off-route alert without re-counting while
 * the user remains off route.
 */
export function isFirstOffRouteAlert(
  previous: NavigationState,
  next: NavigationState
): boolean {
  return previous.phase !== 'offRoute' && next.phase === 'offRoute'
}

/**
 * User marks the current off-route signal as a false positive.
 * Returns navigation to `following` with strike counter cleared.
 */
export function acknowledgeOffRouteFalsePositive(state: NavigationState): NavigationState {
  if (state.phase !== 'offRoute') return state
  return {
    ...state,
    phase: 'following',
    offRouteCount: 0,
    resumePhase: 'following',
    arrivedStopId: undefined
  }
}

/** Quality side-effect intent produced by pure guide reducers (never fire inside React updaters). */
export type GuideQualityIntent = 'off-route-alert' | 'off-route-false-positive' | null

export type GuideLocationReduceInput = {
  route: ActiveRouteView
  state: NavigationState
  fix: LocationFix
  activeLeg?: Coordinate[]
  /** When false, only stamp the fix onto state (no advanceNavigation). */
  allowAdvance: boolean
}

export type GuideReduceResult = {
  state: NavigationState
  qualityIntent: GuideQualityIntent
}

/**
 * Pure guide location reducer. Computes next navigation state and whether the
 * caller should record exactly one off-route alert for this transition.
 */
export function reduceGuideLocationFix(input: GuideLocationReduceInput): GuideReduceResult {
  const { route, state, fix, activeLeg = [], allowAdvance } = input

  if (state.routeId !== route.id) {
    return { state, qualityIntent: null }
  }

  if (!allowAdvance) {
    return {
      state: {
        ...state,
        currentPosition: fix.coordinate,
        accuracyMeters: fix.accuracy,
        heading: fix.heading,
        timestamp: fix.timestamp
      },
      qualityIntent: null
    }
  }

  const next = advanceNavigation(route, state, fix, activeLeg)
  return {
    state: next,
    qualityIntent: isFirstOffRouteAlert(state, next) ? 'off-route-alert' : null
  }
}

/**
 * Pure false-positive reducer. Records intent only when currently offRoute so
 * double-clicks after recovery produce no second quality event.
 */
export function reduceGuideFalsePositive(state: NavigationState): GuideReduceResult {
  if (state.phase !== 'offRoute') {
    return { state, qualityIntent: null }
  }
  return {
    state: acknowledgeOffRouteFalsePositive(state),
    qualityIntent: 'off-route-false-positive'
  }
}

export function shouldAdvanceNavigation(phase: NavigationPhase): boolean {
  return phase !== 'idle' && phase !== 'locationError' && phase !== 'completed'
}

export function startNavigation(route: ActiveRouteView, fix?: LocationFix): NavigationState {
  const state: NavigationState = {
    ...createNavigationState(route.id),
    phase: 'acquiring'
  }
  return fix ? advanceNavigation(route, state, fix) : state
}

export function continueFromStop(route: ActiveRouteView, state: NavigationState): NavigationState {
  if (state.phase !== 'atStop') return state

  return moveToNextStop(route, state)
}

export function moveToNextStop(
  route: ActiveRouteView,
  state: NavigationState
): NavigationState {
  if (state.phase === 'idle' || state.phase === 'completed') return state

  const nextIndex = state.currentStopIndex + 1
  if (nextIndex >= route.stops.length) {
    return {
      ...state,
      phase: 'completed',
      currentStopIndex: route.stops.length,
      offRouteCount: 0,
      resumePhase: undefined,
      arrivedStopId: undefined
    }
  }

  const nextState: NavigationState = {
    ...state,
    phase: 'following',
    currentStopIndex: nextIndex,
    offRouteCount: 0,
    resumePhase: 'following',
    arrivedStopId: undefined
  }

  if (!state.currentPosition) return nextState
  return advanceNavigation(route, nextState, {
    coordinate: state.currentPosition,
    accuracy: state.accuracyMeters,
    heading: state.heading,
    timestamp: state.timestamp ?? Date.now()
  })
}

export function moveToPreviousStop(
  route: ActiveRouteView,
  state: NavigationState
): NavigationState {
  if (state.phase === 'idle' || route.stops.length === 0) return state

  const previousIndex = Math.min(route.stops.length - 1, state.currentStopIndex - 1)
  if (previousIndex < 0) return state

  const previousState: NavigationState = {
    ...state,
    phase: 'following',
    currentStopIndex: previousIndex,
    offRouteCount: 0,
    resumePhase: 'following',
    arrivedStopId: undefined
  }

  if (!state.currentPosition) return previousState
  return advanceNavigation(route, previousState, {
    coordinate: state.currentPosition,
    accuracy: state.accuracyMeters,
    heading: state.heading,
    timestamp: state.timestamp ?? Date.now()
  })
}

export function advanceNavigation(
  route: ActiveRouteView,
  state: NavigationState,
  fix: LocationFix,
  activeLeg: Coordinate[] = []
): NavigationState {
  const base = state.routeId === route.id ? state : createNavigationState(route.id)
  const withFix = applyFix(base, fix)

  if (base.phase === 'idle' || base.phase === 'locationError') return withFix
  if (base.phase === 'completed') return { ...withFix, phase: 'completed' }
  if (base.phase === 'atStop') return { ...withFix, phase: 'atStop', arrivedStopId: base.arrivedStopId }

  const routeStart = getRouteStart(route)
  if (!routeStart) return { ...withFix, phase: 'completed' }

  if (isLowAccuracy(fix.accuracy)) {
    return {
      ...withFix,
      phase: 'lowAccuracy',
      resumePhase: getResumePhase(base),
      arrivedStopId: undefined
    }
  }

  if (base.phase === 'offRoute') {
    const projection = projectPointToLine(fix.coordinate, activeLeg)
    if (projection && projection.distanceMeters > OFF_ROUTE_THRESHOLD_METERS) {
      return {
        ...withFix,
        phase: 'offRoute',
        offRouteCount: Math.max(base.offRouteCount + 1, OFF_ROUTE_STRIKE_LIMIT),
        resumePhase: 'following',
        arrivedStopId: undefined
      }
    }
    return evaluateFollowing(route, { ...withFix, phase: 'following', offRouteCount: 0 }, activeLeg)
  }

  if (base.phase === 'lowAccuracy') {
    const resumePhase = base.resumePhase ?? 'following'
    return resumePhase === 'toStart'
      ? evaluateToStart(route, { ...withFix, phase: 'toStart' }, fix.coordinate, activeLeg)
      : evaluateFollowing(route, { ...withFix, phase: 'following', offRouteCount: 0 }, activeLeg)
  }

  if (base.phase === 'acquiring') {
    return distanceMeters(fix.coordinate, routeStart) > START_RADIUS_METERS
      ? {
          ...withFix,
          phase: 'toStart',
          currentStopIndex: 0,
          offRouteCount: 0,
          resumePhase: 'toStart',
          arrivedStopId: undefined
        }
      : evaluateFollowing(route, { ...withFix, phase: 'following', currentStopIndex: 0 }, activeLeg)
  }

  if (base.phase === 'toStart') {
    return evaluateToStart(route, withFix, fix.coordinate, activeLeg)
  }

  return evaluateFollowing(route, withFix, activeLeg)
}

export function getNavigationOutput(
  route: ActiveRouteView,
  state: NavigationState,
  fallbackStop?: ActiveStop,
  activeLeg: Coordinate[] = []
): NavigationOutput {
  const targetStopIndex = clampStopIndex(route, state.currentStopIndex)
  const targetStop = route.stops[targetStopIndex]
  const routeStart = getRouteStart(route)
  const currentPosition = state.currentPosition
  const stopPhase = isStopTargetPhase(state)
  const startPhase = state.phase === 'toStart' || (state.phase === 'lowAccuracy' && state.resumePhase === 'toStart')
  const targetCoordinate = stopPhase ? targetStop?.location : startPhase ? routeStart : undefined
  const offRouteProjection =
    currentPosition && activeLeg.length >= 2 ? projectPointToLine(currentPosition, activeLeg) : undefined
  const targetDistanceMeters =
    currentPosition && targetCoordinate
      ? startPhase
        ? distanceMeters(currentPosition, targetCoordinate)
        : distanceToTargetAlongLine(
            currentPosition,
            targetCoordinate,
            activeLeg,
            OFF_ROUTE_THRESHOLD_METERS
          )
      : undefined

  const visibleStop = stopPhase ? targetStop : fallbackStop
  const visibleStopIndex = visibleStop ? Math.max(0, route.stops.findIndex((stop) => stop.id === visibleStop.id)) : 0

  return {
    phase: state.phase,
    visibleStop,
    visibleStopIndex,
    targetStop: stopPhase ? targetStop : undefined,
    targetStopIndex,
    activeMapStopId: stopPhase ? targetStop?.id : undefined,
    targetCoordinate,
    targetDistanceMeters,
    offRouteDistanceMeters: offRouteProjection?.distanceMeters,
    accuracyMeters: state.accuracyMeters,
    hasNextStop: state.currentStopIndex + 1 < route.stops.length
  }
}

function applyFix(state: NavigationState, fix: LocationFix): NavigationState {
  return {
    ...state,
    currentPosition: fix.coordinate,
    accuracyMeters: fix.accuracy,
    heading: fix.heading,
    timestamp: fix.timestamp
  }
}

function evaluateToStart(
  route: ActiveRouteView,
  state: NavigationState,
  coordinate: Coordinate,
  activeLeg: Coordinate[] = []
): NavigationState {
  const routeStart = getRouteStart(route)
  if (!routeStart) return { ...state, phase: 'completed' }
  if (distanceMeters(coordinate, routeStart) > START_RADIUS_METERS) {
    return {
      ...state,
      phase: 'toStart',
      currentStopIndex: 0,
      offRouteCount: 0,
      resumePhase: 'toStart',
      arrivedStopId: undefined
    }
  }
  return evaluateFollowing(
    route,
    {
      ...state,
      phase: 'following',
      currentStopIndex: 0,
      offRouteCount: 0,
      resumePhase: 'following',
      arrivedStopId: undefined
    },
    activeLeg
  )
}

function evaluateFollowing(
  route: ActiveRouteView,
  state: NavigationState,
  activeLeg: Coordinate[] = []
): NavigationState {
  const targetStop = route.stops[state.currentStopIndex]
  if (!targetStop) {
    return {
      ...state,
      phase: 'completed',
      offRouteCount: 0,
      resumePhase: undefined,
      arrivedStopId: undefined
    }
  }

  if (
    state.currentPosition &&
    distanceMeters(state.currentPosition, targetStop.location) <=
      effectiveArrivalRadiusMeters(state.accuracyMeters)
  ) {
    return {
      ...state,
      phase: 'atStop',
      offRouteCount: 0,
      resumePhase: 'following',
      arrivedStopId: targetStop.id
    }
  }

  const projection =
    state.currentPosition && activeLeg.length >= 2
      ? projectPointToLine(state.currentPosition, activeLeg)
      : undefined
  const offRouteCount =
    projection && projection.distanceMeters > OFF_ROUTE_THRESHOLD_METERS ? state.offRouteCount + 1 : 0

  if (offRouteCount >= OFF_ROUTE_STRIKE_LIMIT) {
    return {
      ...state,
      phase: 'offRoute',
      offRouteCount,
      resumePhase: 'following',
      arrivedStopId: undefined
    }
  }

  return {
    ...state,
    phase: 'following',
    offRouteCount,
    resumePhase: 'following',
    arrivedStopId: undefined
  }
}

function getRouteStart(route: ActiveRouteView): Coordinate | undefined {
  return route.stops[0]?.location
}

function getResumePhase(state: NavigationState): ResumableNavigationPhase {
  if (state.phase === 'acquiring') return 'toStart'
  if (state.phase === 'toStart' || state.phase === 'following') return state.phase
  return state.resumePhase ?? 'following'
}

function isLowAccuracy(accuracy?: number): boolean {
  return typeof accuracy === 'number' && accuracy > LOW_ACCURACY_THRESHOLD_METERS
}

function effectiveArrivalRadiusMeters(accuracy?: number): number {
  return Math.max(ARRIVAL_RADIUS_METERS, Math.min(ARRIVAL_MAX_RADIUS_METERS, accuracy ?? 0))
}

function clampStopIndex(route: ActiveRouteView, index: number): number {
  if (route.stops.length === 0) return 0
  return Math.max(0, Math.min(route.stops.length - 1, index))
}

function isStopTargetPhase(state: NavigationState): boolean {
  return (
    state.phase === 'following' ||
    state.phase === 'atStop' ||
    state.phase === 'offRoute' ||
    (state.phase === 'lowAccuracy' && state.resumePhase !== 'toStart')
  )
}
