import localforage from 'localforage'

export const ACTIVE_ROUTE_SELECTION_KEY = 'netrin.activeRouteSelection'

export async function loadActiveRouteSelection(): Promise<string> {
  try {
    const value = await localforage.getItem<string>(ACTIVE_ROUTE_SELECTION_KEY)
    return typeof value === 'string' ? value : ''
  } catch {
    return ''
  }
}

export async function saveActiveRouteSelection(activeRouteId: string): Promise<void> {
  try {
    await localforage.setItem(ACTIVE_ROUTE_SELECTION_KEY, activeRouteId)
  } catch {
    // Selection persistence is local-only. The in-memory route state remains authoritative for this session.
  }
}
