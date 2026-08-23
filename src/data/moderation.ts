import { supabase } from '../lib/supabase'
import type {
  GeometrySource,
  LocalizedText,
  ModerationStatus,
  RouteDifficulty,
  RoutePublicV2PointRow,
  TravelMode,
  Wgs84LineString
} from './types'
import { readHighlightFields } from './types'

/** Admin editor runtime point — highlightTitle only, no speciesName. */
export type AdminRoutePoint = {
  id: string
  order: number
  lng: number
  lat: number
  title?: string | null
  text?: string | null
  highlightTitle?: string | null
  category?: string | null
  media?: RoutePublicV2PointRow['media']
}
export type AdminRoute = {
  id: string
  ownerId: string | null
  author: string
  title: LocalizedText
  description: LocalizedText
  status: ModerationStatus
  rejectionReason?: string
  createdAt: string
  updatedAt: string
  travelMode: TravelMode
  geometrySource?: GeometrySource
  geometry?: Wgs84LineString
  cityAdcode?: string
  cityName?: string
  distanceM?: number
  durationS?: number
  difficulty?: RouteDifficulty | null
  isLoop?: boolean
  tags: string[]
  coverMediaId?: string
  needsGeometryReview: boolean
  points: AdminRoutePoint[]
}

export type AppearanceSubmission = {
  id: string
  ownerId: string | null
  packageId: string
  packageVersion: string
  displayName: string
  summary: string
  declaredAuthor: string
  license: string
  sha256: string
  bytes: number
  storagePath?: string
  auditReport: Record<string, unknown>
  status: ModerationStatus
  rejectionReason?: string
  createdAt: string
  updatedAt: string
}

export type AppearanceCatalogItem = Pick<AppearanceSubmission,
  'id' | 'packageId' | 'packageVersion' | 'displayName' | 'summary' | 'declaredAuthor' |
  'license' | 'sha256' | 'bytes' | 'updatedAt'
>

export type AdminUser = {
  id: string
  phone: string
  displayName: string
  status: 'active' | 'suspended' | 'deleting'
  role: 'admin' | 'user'
  isAnonymous: boolean
  createdAt: string
  lastSignInAt?: string
}

export type ModerationEvent = {
  id: number
  actorId: string | null
  subjectType: 'route' | 'appearance' | 'account' | 'role'
  subjectId: string
  action: string
  note?: string
  createdAt: string
}

export type AdminOperation =
  | 'load-routes' | 'review-route' | 'confirm-route-geometry'
  | 'load-appearances' | 'load-appearance-catalog' | 'download-appearance' | 'review-appearance'
  | 'load-audit-log' | 'admin-action' | 'load-accounts' | 'submit-appearance' | 'load-my-appearances'

export type AdminFailure = {
  operation: AdminOperation
  requestId: string
  message: string
}

export type DataResult<T> = { ok: true; data: T } | { ok: false; error: AdminFailure }

const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{8,128}$/

function requestId(): string {
  return crypto.randomUUID()
}

function failure(operation: AdminOperation, id: string, data?: unknown): DataResult<never> {
  const responseId = data && typeof data === 'object' && typeof (data as { requestId?: unknown }).requestId === 'string'
    ? (data as { requestId: string }).requestId
    : ''
  return {
    ok: false,
    error: {
      operation,
      requestId: SAFE_REQUEST_ID.test(responseId) ? responseId : id,
      message: 'Request failed'
    }
  }
}

export function adminFailureText(error: AdminFailure): string {
  return `${error.operation}: ${error.message} (${error.requestId})`
}

function localized(value: unknown): LocalizedText {
  const record = value && typeof value === 'object' ? value as Partial<LocalizedText> : {}
  return { 'zh-CN': record['zh-CN'] ?? '', en: record.en ?? '' }
}

async function signAdminRouteMedia(routes: AdminRoute[]): Promise<AdminRoute[]> {
  if (!supabase) return routes
  const mediaIds = routes.flatMap((route) => route.points)
    .flatMap((point) => point.media ?? [])
    .map((media) => media.id)
  if (mediaIds.length === 0) return routes
  const batches = []
  for (let index = 0; index < Math.min(mediaIds.length, 1000); index += 200) {
    batches.push(supabase.functions.invoke('netrin-media', {
      body: { mediaIds: mediaIds.slice(index, index + 200) }
    }))
  }
  const responses = await Promise.all(batches)
  const items = responses.flatMap(({ data, error }) =>
    !error && Array.isArray(data?.items) ? data.items as Array<{ mediaId: string; url: string }> : []
  )
  const urls = new Map<string, string>(items.map((item) => [item.mediaId, item.url]))
  return routes.map((route) => ({
    ...route,
    points: route.points.map((point) => ({
      ...point,
      media: (point.media ?? []).map((media) => ({ ...media, url: urls.get(media.id) }))
    }))
  }))
}

export async function fetchAdminRoutes(): Promise<DataResult<AdminRoute[]>> {
  const id = requestId()
  if (!supabase) return failure('load-routes', id)
  const { data, error } = await supabase.from('routes_admin_v1').select('*').order('created_at', { ascending: false })
  if (error) return failure('load-routes', id)
  const routes: AdminRoute[] = (data ?? []).map((row): AdminRoute => ({
    id: row.id,
    ownerId: row.created_by,
    author: row.author ?? '',
    title: localized(row.title),
    description: localized(row.description),
    status: row.moderation_status,
    rejectionReason: row.rejection_reason ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    travelMode: row.travel_mode === 'cycling' ? 'cycling' : 'walking',
    geometrySource: typeof row.geometry_source === 'string' ? row.geometry_source as GeometrySource : undefined,
    geometry: row.geometry?.type === 'LineString' && Array.isArray(row.geometry.coordinates) ? row.geometry : undefined,
    cityAdcode: row.city_adcode ?? undefined,
    cityName: row.city_name ?? undefined,
    distanceM: typeof row.distance_m === 'number' ? row.distance_m : undefined,
    durationS: typeof row.duration_s === 'number' ? row.duration_s : undefined,
    difficulty: ['easy', 'moderate', 'hard'].includes(row.difficulty) ? row.difficulty : undefined,
    isLoop: typeof row.is_loop === 'boolean' ? row.is_loop : undefined,
    tags: Array.isArray(row.tags) ? row.tags.filter((tag: unknown): tag is string => typeof tag === 'string') : [],
    coverMediaId: row.cover_media_id ?? undefined,
    needsGeometryReview: row.needs_geometry_review === true,
    points: (Array.isArray(row.points) ? row.points : []).map(
      (point: RoutePublicV2PointRow): AdminRoutePoint => {
        const fields = readHighlightFields({
          highlightTitle: point.highlightTitle,
          speciesName: point.speciesName,
          title: point.title,
          category: point.category
        })
        return {
          id: point.id,
          order: point.order,
          lng: point.lng,
          lat: point.lat,
          title: point.title,
          text: point.text,
          highlightTitle: fields.highlightTitle ?? null,
          category: fields.category ?? null,
          media: point.media
        }
      }
    )
  }))
  return {
    ok: true,
    data: await signAdminRouteMedia(routes)
  }
}

export async function reviewRoute(id: string, decision: 'approved' | 'rejected', reason: string): Promise<DataResult<null>> {
  const correlationId = requestId()
  if (!supabase) return failure('review-route', correlationId)
  const { error } = await supabase.rpc('review_route', { p_route_id: id, p_decision: decision, p_reason: reason || null })
  return error ? failure('review-route', correlationId) : { ok: true, data: null }
}

export async function confirmAdminRouteGeometry(input: {
  routeId: string
  navigable: boolean
  reason: string
  travelMode?: TravelMode
  geometrySource?: GeometrySource
  geometry?: Wgs84LineString
  meta?: Record<string, unknown>
}): Promise<DataResult<null>> {
  const id = requestId()
  if (!supabase) return failure('confirm-route-geometry', id)
  const { error } = await supabase.rpc('admin_confirm_route_geometry_v1', {
    p_route_id: input.routeId,
    p_navigable: input.navigable,
    p_travel_mode: input.travelMode ?? null,
    p_geometry_source: input.geometrySource ?? null,
    p_geometry: input.geometry ?? null,
    p_meta: input.meta ?? {},
    p_reason: input.reason
  })
  return error ? failure('confirm-route-geometry', id) : { ok: true, data: null }
}

export async function fetchAppearanceSubmissions(): Promise<DataResult<AppearanceSubmission[]>> {
  const id = requestId()
  if (!supabase) return failure('load-appearances', id)
  const { data, error } = await supabase.from('appearance_submissions_private_v1').select('*').order('created_at', { ascending: false })
  if (error) return failure('load-appearances', id)
  return {
    ok: true,
    data: (data ?? []).map((row) => ({
      id: row.id, ownerId: row.owner_id, packageId: row.package_id,
      packageVersion: row.package_version, displayName: row.display_name,
      summary: row.summary ?? '', declaredAuthor: row.declared_author, license: row.license,
      sha256: row.package_sha256, bytes: row.byte_size, storagePath: row.storage_path,
      auditReport: row.audit_report ?? {}, status: row.moderation_status,
      rejectionReason: row.rejection_reason ?? undefined,
      createdAt: row.created_at, updatedAt: row.updated_at
    }))
  }
}

export async function fetchAppearanceCatalog(): Promise<DataResult<AppearanceCatalogItem[]>> {
  const id = requestId()
  if (!supabase) return failure('load-appearance-catalog', id)
  const { data, error } = await supabase.from('appearance_catalog_public').select('*').order('updated_at', { ascending: false })
  if (error) return failure('load-appearance-catalog', id)
  return {
    ok: true,
    data: (data ?? []).map((row) => ({
      id: row.id, packageId: row.package_id, packageVersion: row.package_version,
      displayName: row.display_name, summary: row.summary ?? '', declaredAuthor: row.declared_author,
      license: row.license, sha256: row.package_sha256, bytes: row.byte_size,
      updatedAt: row.updated_at
    }))
  }
}

export async function downloadAppearancePackage(id: string): Promise<DataResult<Blob>> {
  const correlationId = requestId()
  if (!supabase) return failure('download-appearance', correlationId)
  const { data, error } = await supabase.functions.invoke('netrin-appearance', {
    body: { action: 'download', id },
    headers: { 'x-request-id': correlationId }
  })
  if (error) return failure('download-appearance', correlationId, data)
  if (!data?.url) return failure('download-appearance', correlationId, data)
  try {
    const response = await fetch(data.url)
    if (!response.ok) return failure('download-appearance', correlationId)
    return { ok: true, data: await response.blob() }
  } catch {
    return failure('download-appearance', correlationId)
  }
}

export async function reviewAppearance(
  id: string,
  decision: 'approved' | 'rejected',
  reason: string,
  displayName: string,
  summary: string,
  reviewReport?: File
): Promise<DataResult<null>> {
  const correlationId = requestId()
  if (!supabase) return failure('review-appearance', correlationId)
  const body = new FormData()
  body.set('action', 'review')
  body.set('submissionId', id)
  body.set('decision', decision)
  body.set('reason', reason)
  body.set('displayName', displayName)
  body.set('summary', summary)
  if (reviewReport) body.set('review', reviewReport)
  const { data, error } = await supabase.functions.invoke('netrin-appearance', {
    body,
    headers: { 'x-request-id': correlationId }
  })
  return error || data?.error ? failure('review-appearance', correlationId, data) : { ok: true, data: null }
}

export async function fetchModerationEvents(): Promise<DataResult<ModerationEvent[]>> {
  const id = requestId()
  if (!supabase) return failure('load-audit-log', id)
  const { data, error } = await supabase.from('moderation_events')
    .select('id,actor_id,subject_type,subject_id,action,note,created_at')
    .order('created_at', { ascending: false }).limit(200)
  if (error) return failure('load-audit-log', id)
  return {
    ok: true,
    data: (data ?? []).map((row) => ({
      id: row.id, actorId: row.actor_id, subjectType: row.subject_type,
      subjectId: row.subject_id, action: row.action,
      note: row.note ?? undefined, createdAt: row.created_at
    }))
  }
}


export async function callAdmin<T>(body: Record<string, unknown>): Promise<DataResult<T>> {
  const id = requestId()
  if (!supabase) return failure('admin-action', id)
  try {
    const { data, error } = await supabase.functions.invoke('netrin-admin', { body, headers: { 'x-request-id': id } })
    if (error || data?.error) return failure('admin-action', id, data)
    return { ok: true, data: data as T }
  } catch {
    return failure('admin-action', id)
  }
}

export async function fetchAdminUsers(page = 1): Promise<DataResult<{ users: AdminUser[]; total: number }>> {
  const result = await callAdmin<{ users: AdminUser[]; total: number }>({ action: 'list-users', page })
  return result.ok ? result : { ok: false, error: { ...result.error, operation: 'load-accounts' } }
}

export async function submitAppearancePackage(file: File, reviewReport: File, replacementId?: string): Promise<DataResult<{ id: string; status: 'pending' }>> {
  const id = requestId()
  if (!supabase) return failure('submit-appearance', id)
  try {
    const body = new FormData()
    body.set('package', file)
    body.set('review', reviewReport)
    if (replacementId) body.set('replacementId', replacementId)
    const { data, error } = await supabase.functions.invoke('netrin-appearance', {
      body,
      headers: { 'x-request-id': id }
    })
    if (error || data?.error) return failure('submit-appearance', id, data)
    return { ok: true, data }
  } catch {
    return failure('submit-appearance', id)
  }
}

export async function fetchMyAppearanceSubmissions(): Promise<DataResult<AppearanceSubmission[]>> {
  const id = requestId()
  if (!supabase) return failure('load-my-appearances', id)
  const { data: authData } = await supabase.auth.getUser()
  const userId = authData.user?.id
  if (!userId) return { ok: true, data: [] }
  const result = await fetchAppearanceSubmissions()
  return result.ok ? { ok: true, data: result.data.filter((submission) => submission.ownerId === userId) } : failure('load-my-appearances', id)
}
