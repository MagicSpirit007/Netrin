import { useEffect, useMemo, useRef, useState } from 'react'
import type { Coordinate, RouteSegment, TravelMode } from '../../data/types'
import { planRouteSegmentsForPoints } from './routePlanning'

export type RoutePreviewPoint = { id: string; location: Coordinate }
export type RoutePreviewStatus = 'idle' | 'loading' | 'ready' | 'error'

export function useAmapRoutePreview(
  points: RoutePreviewPoint[],
  travelMode: TravelMode = 'walking',
  enabled = true
) {
  const requestIdRef = useRef(0)
  const [segments, setSegments] = useState<RouteSegment[]>([])
  const [status, setStatus] = useState<RoutePreviewStatus>('idle')
  const [retryToken, setRetryToken] = useState(0)
  const pointKey = useMemo(
    () => points.map((point) => `${point.id}:${point.location[0].toFixed(6)},${point.location[1].toFixed(6)}`).join('|'),
    [points]
  )

  useEffect(() => {
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    if (!enabled || points.length < 2) {
      setSegments([])
      setStatus('idle')
      return
    }
    setStatus('loading')
    void planRouteSegmentsForPoints(
      points.map((point) => ({ id: point.id, final: point.location })),
      travelMode,
      'preview'
    )
      .then((nextSegments) => {
        if (requestIdRef.current !== requestId) return
        setSegments(nextSegments)
        setStatus('ready')
      })
      .catch(() => {
        if (requestIdRef.current !== requestId) return
        setSegments([])
        setStatus('error')
      })
  }, [enabled, pointKey, retryToken, travelMode])

  return {
    segments,
    status,
    retry: () => setRetryToken((value) => value + 1)
  }
}
