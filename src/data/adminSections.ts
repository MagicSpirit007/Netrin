import type { AdminFailure, DataResult } from './moderation'

export type AdminSectionStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error'

export type AdminSectionState<T> = {
  data: T
  status: AdminSectionStatus
  error: AdminFailure | null
}

export function adminSection<T>(data: T): AdminSectionState<T> {
  return { data, status: 'idle', error: null }
}

export function loadAdminSection<T>(current: AdminSectionState<T>): AdminSectionState<T> {
  return { ...current, status: 'loading', error: null }
}

export function settleAdminSection<T extends { length: number }>(
  current: AdminSectionState<T>,
  result: DataResult<T>
): AdminSectionState<T> {
  return result.ok
    ? { data: result.data, status: result.data.length > 0 ? 'ready' : 'empty', error: null }
    : { ...current, status: 'error', error: result.error }
}
