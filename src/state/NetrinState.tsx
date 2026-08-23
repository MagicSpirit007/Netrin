import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  loadDownloads,
  patchDownloadedRoute,
  saveDownloads,
  type DownloadedRoutePatch
} from '../data/routeLibrary'
import {
  loadActiveRouteSelection,
  saveActiveRouteSelection
} from '../data/activeRouteSelection'
import { loadRouteDrafts, saveRouteDrafts } from '../data/drafts'
import { routes } from '../data/nature'
import {
  DEFAULT_APPEARANCE_SETTINGS,
  loadAppearanceSettings,
  saveAppearanceSettings
} from '../data/settings'
import type { AppearanceSettings, DownloadedRoute, RouteDraft } from '../data/types'

type NetrinStateValue = {
  activeRouteId: string
  setActiveRouteId: (id: string) => void
  navigationActive: boolean
  setNavigationActive: (active: boolean) => void
  snapToRoads: boolean
  setSnapToRoads: (enabled: boolean) => void
  routeDrafts: RouteDraft[]
  draftsReady: boolean
  addRouteDraft: (draft: RouteDraft) => void
  updateRouteDraft: (draft: RouteDraft) => void
  removeRouteDraft: (id: string) => void
  downloadedRoutes: DownloadedRoute[]
  downloadsReady: boolean
  downloadRoute: (route: DownloadedRoute) => void
  updateDownloadedRoute: (id: string, patch: DownloadedRoutePatch) => void
  removeDownload: (id: string) => void
  isDownloaded: (id: string) => boolean
  appearanceSettings: AppearanceSettings
  setAppearanceSettings: (settings: AppearanceSettings) => void
  updateAppearanceSettings: (patch: Partial<AppearanceSettings>) => void
}

const NetrinStateContext = createContext<NetrinStateValue | null>(null)
const ISOLATED_APPEARANCE_DEV = import.meta.env.DEV && import.meta.env.NETRIN_APPEARANCE_DEV_ISOLATED === '1'

export function NetrinStateProvider({ children }: { children: ReactNode }) {
  const [activeRouteId, setActiveRouteId] = useState('')
  const [navigationActive, setNavigationActive] = useState(false)
  const [snapToRoads, setSnapToRoads] = useState(true)
  const [routeDrafts, setRouteDrafts] = useState<RouteDraft[]>([])
  const [draftsReady, setDraftsReady] = useState(false)
  const [downloadedRoutes, setDownloadedRoutes] = useState<DownloadedRoute[]>([])
  const [downloadsReady, setDownloadsReady] = useState(false)
  const [selectionReady, setSelectionReady] = useState(false)
  const [selectionValidated, setSelectionValidated] = useState(false)
  const [appearanceSettings, setAppearanceSettings] = useState<AppearanceSettings>(
    DEFAULT_APPEARANCE_SETTINGS
  )
  const hydratedRef = useRef(false)
  const draftHydratedRef = useRef(false)
  const appearanceHydratedRef = useRef(false)

  useEffect(() => {
    if (ISOLATED_APPEARANCE_DEV) { setDraftsReady(true); return }
    let alive = true
    void loadRouteDrafts()
      .then((routesList) => {
        if (alive) setRouteDrafts(routesList)
      })
      .finally(() => {
        if (!alive) return
        draftHydratedRef.current = true
        setDraftsReady(true)
      })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (ISOLATED_APPEARANCE_DEV) return
    if (!draftHydratedRef.current) return
    void saveRouteDrafts(routeDrafts)
  }, [routeDrafts])

  useEffect(() => {
    if (ISOLATED_APPEARANCE_DEV) { setSelectionReady(true); return }
    let alive = true
    void loadActiveRouteSelection()
      .then((id) => {
        if (alive) setActiveRouteId(id)
      })
      .finally(() => {
        if (alive) setSelectionReady(true)
      })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (ISOLATED_APPEARANCE_DEV) { setDownloadsReady(true); return }
    let alive = true
    void loadDownloads()
      .then((list) => {
        if (alive) setDownloadedRoutes(list)
      })
      .finally(() => {
        if (!alive) return
        hydratedRef.current = true
        setDownloadsReady(true)
      })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (ISOLATED_APPEARANCE_DEV) return
    if (!hydratedRef.current) return
    void saveDownloads(downloadedRoutes)
  }, [downloadedRoutes])

  useEffect(() => {
    let alive = true
    loadAppearanceSettings().then((settings) => {
      if (!alive) return
      setAppearanceSettings(settings)
      appearanceHydratedRef.current = true
    })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (!appearanceHydratedRef.current) return
    void saveAppearanceSettings(appearanceSettings)
  }, [appearanceSettings])

  useEffect(() => {
    if (!draftsReady || !downloadsReady || !selectionReady) return
    const availableIds = new Set([
      ...routes.map((route) => route.id),
      ...downloadedRoutes.map((route) => route.id),
      ...routeDrafts.filter((draft) => draft.points.length > 0).map((draft) => draft.id)
    ])
    setActiveRouteId((current) => {
      if (current === '' || availableIds.has(current)) return current
      return ''
    })
    setSelectionValidated(true)
  }, [downloadedRoutes, downloadsReady, draftsReady, routeDrafts, selectionReady])

  useEffect(() => {
    if (ISOLATED_APPEARANCE_DEV) return
    if (!selectionValidated) return
    void saveActiveRouteSelection(activeRouteId)
  }, [activeRouteId, selectionValidated])

  const value = useMemo<NetrinStateValue>(
    () => ({
      activeRouteId,
      setActiveRouteId,
      navigationActive,
      setNavigationActive,
      snapToRoads,
      setSnapToRoads,
      routeDrafts,
      draftsReady,
      addRouteDraft: (draft) =>
        setRouteDrafts((current) => [draft, ...current.filter((item) => item.id !== draft.id)]),
      updateRouteDraft: (draft) =>
        setRouteDrafts((current) =>
          current.map((item) => (item.id === draft.id ? draft : item))
        ),
      removeRouteDraft: (id) =>
        setRouteDrafts((current) => current.filter((draft) => draft.id !== id)),
      downloadedRoutes,
      downloadsReady,
      downloadRoute: (route) =>
        setDownloadedRoutes((current) =>
          [route, ...current.filter((item) => item.id !== route.id)]
        ),
      updateDownloadedRoute: (id, patch) =>
        setDownloadedRoutes((current) =>
          current.map((route) => (route.id === id ? patchDownloadedRoute(route, patch) : route))
        ),
      removeDownload: (id) =>
        setDownloadedRoutes((current) => current.filter((route) => route.id !== id)),
      isDownloaded: (id) => downloadedRoutes.some((route) => route.id === id),
      appearanceSettings,
      setAppearanceSettings,
      updateAppearanceSettings: (patch) =>
        setAppearanceSettings((current) => ({ ...current, ...patch }))
    }),
    [
      activeRouteId,
      appearanceSettings,
      downloadedRoutes,
      downloadsReady,
      draftsReady,
      navigationActive,
      routeDrafts,
      snapToRoads
    ]
  )

  return <NetrinStateContext.Provider value={value}>{children}</NetrinStateContext.Provider>
}

export function useNetrinState(): NetrinStateValue {
  const value = useContext(NetrinStateContext)
  if (!value) throw new Error('useNetrinState must be used inside NetrinStateProvider')
  return value
}
