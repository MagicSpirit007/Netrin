import { createClient } from 'npm:@supabase/supabase-js@2.55.0'
import { corsHeaders, isAllowedOrigin, json, requestFailure } from '../_shared/http.ts'
import { drainStorageCleanup, queueStorageCleanup } from '../_shared/storage-cleanup.ts'

const url = Deno.env.get('SUPABASE_URL') ?? ''
const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

type AdminRequest = {
  action?: 'list-users' | 'suspend-user' | 'reactivate-user' | 'delete-user' | 'delete-route' | 'delete-appearance' | 'save-route' | 'cleanup-route-media'
  targetId?: string
  reason?: string
  page?: number
  paths?: string[]
  route?: {
    id: string
    title: Record<string, string>
    description: Record<string, string>
    author: string
    status: string
    points: Array<Record<string, unknown> & { media?: Array<{ storagePath?: string }> }>
  }
}

function routePaths(rows: Array<{ route_points?: Array<{ route_point_media?: Array<{ storage_path?: string }> }> }>): string[] {
  return rows.flatMap((route) => route.route_points ?? [])
    .flatMap((point) => point.route_point_media ?? [])
    .flatMap((media) => media.storage_path ? [media.storage_path] : [])
}

function maskPhone(value: string | undefined): string {
  if (!value || !/^\+861[3-9]\d{9}$/.test(value)) return ''
  const local = value.slice(3)
  return `${local.slice(0, 3)}****${local.slice(-4)}`
}

Deno.serve(async (request) => {
  const reply = (body: unknown, status = 200) => json(request, body, status)
  if (!isAllowedOrigin(request)) return reply({ error: 'Origin not allowed.' }, 403)
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(request) })
  if (request.method !== 'POST') return reply({ error: 'Method not allowed.' }, 405)
  if (!url || !anonKey || !serviceKey) return reply({ error: 'Service unavailable.' }, 503)
  const authorization = request.headers.get('authorization') ?? ''
  const token = authorization.replace(/^Bearer\s+/i, '')
  const service = createClient(url, serviceKey, { auth: { persistSession: false } })
  const caller = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } }, auth: { persistSession: false }
  })
  const { data: authData, error: authError } = await caller.auth.getUser(token)
  const actor = authData.user
  if (authError || !actor) return reply({ error: 'Authentication required.' }, 401)
  if (!actor.phone_confirmed_at) return reply({ error: 'A confirmed phone number is required.' }, 403)
  const { data: adminRole } = await service.from('user_roles').select('role')
    .eq('user_id', actor.id).eq('role', 'admin').maybeSingle()
  const { data: actorProfile } = await service.from('profiles').select('account_status').eq('id', actor.id).maybeSingle()
  if (!adminRole || actorProfile?.account_status !== 'active') return reply({ error: 'Administrator access required.' }, 403)

  try {
    await drainStorageCleanup(service)
    if (request.headers.get('x-admin-action') === 'upload-route-media') {
      const routeId = request.headers.get('x-route-id') ?? ''
      const pointId = request.headers.get('x-point-id') ?? ''
      const order = Number(request.headers.get('x-media-order'))
      const mimeType = request.headers.get('x-media-type') ?? 'image/jpeg'
      if (!/^[0-9a-f-]{36}$/i.test(routeId) || !/^[0-9a-f-]{36}$/i.test(pointId) || order < 1 || order > 8) {
        return reply({ error: 'Invalid route media target.' }, 400)
      }
      if (mimeType !== 'image/jpeg') return reply({ error: 'Only normalized JPEG images are accepted.' }, 400)
      const bytes = new Uint8Array(await request.arrayBuffer())
      if (!bytes.length || bytes.length > 5 * 1024 * 1024) return reply({ error: 'Image must be no larger than 5 MiB.' }, 400)
      if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) {
        return reply({ error: 'Invalid JPEG content.' }, 400)
      }
      const { data: route } = await service.from('routes').select('created_by').eq('id', routeId).maybeSingle()
      if (!route) return reply({ error: 'Route not found.' }, 404)
      const extension = 'jpg'
      const owner = route.created_by ?? actor.id
      const path = `routes/${owner}/${routeId}/${pointId}/${order}-admin-${crypto.randomUUID()}.${extension}`
      const uploaded = await service.storage.from('route-media').upload(path, bytes, { contentType: mimeType, upsert: false })
      if (uploaded.error) throw uploaded.error
      return reply({ path })
    }

    const body = await request.json() as AdminRequest
    if (body.action === 'list-users') {
      const page = Math.max(1, Math.min(body.page ?? 1, 10000))
      const { data, error } = await service.auth.admin.listUsers({ page, perPage: 50 })
      if (error) throw error
      const ids = data.users.map((user) => user.id)
      const [{ data: profiles }, { data: roles }] = await Promise.all([
        service.from('profiles').select('id, display_name, account_status, created_at').in('id', ids),
        service.from('user_roles').select('user_id, role').in('user_id', ids)
      ])
      const profileMap = new Map((profiles ?? []).map((profile) => [profile.id, profile]))
      const roleMap = new Map((roles ?? []).map((role) => [role.user_id, role.role]))
      return reply({
        users: data.users.map((user) => ({
          id: user.id, phone: maskPhone(user.phone), createdAt: user.created_at,
          lastSignInAt: user.last_sign_in_at, isAnonymous: user.is_anonymous,
          displayName: profileMap.get(user.id)?.display_name ?? '',
          status: profileMap.get(user.id)?.account_status ?? 'active',
          role: roleMap.get(user.id) ?? 'user'
        })),
        page, total: data.total
      })
    }
    if (!body.targetId) return reply({ error: 'targetId is required.' }, 400)
    if (body.action === 'save-route') {
      const route = body.route
      if (!route || route.id !== body.targetId || !Array.isArray(route.points)) return reply({ error: 'Route payload is required.' }, 400)
      const { data: before, error: beforeError } = await service.from('routes')
        .select('route_points(route_point_media(storage_path))').eq('id', route.id)
      if (beforeError) throw beforeError
      const oldPaths = routePaths(before ?? [])
      const saved = await caller.rpc('admin_save_route', {
        p_route_id: route.id,
        p_title: route.title,
        p_description: route.description,
        p_author: route.author,
        p_points: route.points,
        p_status: route.status
      })
      if (saved.error) throw saved.error
      const kept = new Set(route.points.flatMap((point) => point.media ?? []).flatMap((media) => media.storagePath ? [media.storagePath] : []))
      const obsolete = oldPaths.filter((path) => !kept.has(path))
      await queueStorageCleanup(service, 'route-media', obsolete, actor.id, `admin-save-route:${route.id}`)
      return reply({ ok: true, removedObjects: obsolete.length })
    }
    if (body.action === 'cleanup-route-media') {
      const routeId = body.targetId
      const candidates = (body.paths ?? []).filter((path) => path.includes(`/${routeId}/`) && path.startsWith('routes/'))
      const removable: string[] = []
      for (const path of candidates) {
        const { count } = await service.from('route_point_media').select('*', { count: 'exact', head: true }).eq('storage_path', path)
        if ((count ?? 0) === 0) removable.push(path)
      }
      await queueStorageCleanup(service, 'route-media', removable, actor.id, `cancel-route-edit:${routeId}`)
      return reply({ ok: true, removedObjects: removable.length })
    }
    if (body.action === 'suspend-user' || body.action === 'reactivate-user') {
      if (body.targetId === actor.id) return reply({ error: 'You cannot change your own administrator account.' }, 409)
      const suspended = body.action === 'suspend-user'
      if (suspended) {
        // Block all RLS-protected writes first. If the Auth update fails, the
        // account remains safely blocked and the action can be retried.
        const profileUpdate = await service.from('profiles').update({
          account_status: 'suspended', updated_at: new Date().toISOString()
        }).eq('id', body.targetId)
        if (profileUpdate.error) throw profileUpdate.error
        const authUpdate = await service.auth.admin.updateUserById(body.targetId, { ban_duration: '876000h' })
        if (authUpdate.error) throw authUpdate.error
      } else {
        // Restore Auth first; database writes remain blocked until both steps succeed.
        const authUpdate = await service.auth.admin.updateUserById(body.targetId, { ban_duration: 'none' })
        if (authUpdate.error) throw authUpdate.error
        const profileUpdate = await service.from('profiles').update({
          account_status: 'active', updated_at: new Date().toISOString()
        }).eq('id', body.targetId)
        if (profileUpdate.error) throw profileUpdate.error
      }
      await service.from('moderation_events').insert({
        actor_id: actor.id, subject_type: 'account', subject_id: body.targetId,
        action: suspended ? 'suspend' : 'reactivate', note: body.reason ?? null
      })
      return reply({ ok: true })
    }
    if (body.action === 'delete-route') {
      const { data: routes, error } = await service.from('routes')
        .select('route_points(route_point_media(storage_path))').eq('id', body.targetId)
      if (error) throw error
      const paths = routePaths(routes ?? [])
      const deleted = await caller.rpc('admin_delete_route', { p_route_id: body.targetId, p_reason: body.reason ?? null })
      if (deleted.error) throw deleted.error
      await drainStorageCleanup(service)
      return reply({ ok: true, removedObjects: paths.length })
    }
    if (body.action === 'delete-appearance') {
      const { data: submission, error } = await service.from('appearance_submissions')
        .select('storage_path').eq('id', body.targetId).maybeSingle()
      if (error || !submission) return reply({ error: 'Appearance not found.' }, 404)
      const deleted = await caller.rpc('admin_delete_appearance', {
        p_submission_id: body.targetId,
        p_reason: body.reason ?? null
      })
      if (deleted.error) throw deleted.error
      await drainStorageCleanup(service)
      return reply({ ok: true, removedObjects: 1 })
    }
    if (body.action === 'delete-user') {
      if (body.targetId === actor.id) return reply({ error: 'You cannot delete your own administrator account.' }, 409)
      const { data: targetRole } = await service.from('user_roles').select('role')
        .eq('user_id', body.targetId).eq('role', 'admin').maybeSingle()
      if (targetRole) {
        const { count } = await service.from('user_roles').select('*', { count: 'exact', head: true }).eq('role', 'admin')
        if ((count ?? 0) <= 1) return reply({ error: 'The last administrator cannot be deleted.' }, 409)
      }
      const [{ data: unpublishedRoutes, error: routesError }, { data: unpublishedAppearances, error: appearanceError }] = await Promise.all([
        service.from('routes').select('route_points(route_point_media(storage_path))')
          .eq('created_by', body.targetId).in('moderation_status', ['pending', 'rejected']),
        service.from('appearance_submissions').select('storage_path')
          .eq('owner_id', body.targetId).in('moderation_status', ['pending', 'rejected'])
      ])
      if (routesError) throw routesError
      if (appearanceError) throw appearanceError
      const paths = routePaths(unpublishedRoutes ?? [])
      const appearancePaths = (unpublishedAppearances ?? []).map((item) => item.storage_path)
      const finalized = await caller.rpc('admin_prepare_delete_user', { p_target_id: body.targetId })
      if (finalized.error) throw finalized.error
      const deleted = await service.auth.admin.deleteUser(body.targetId, false)
      if (deleted.error) throw deleted.error
      await drainStorageCleanup(service)
      return reply({ ok: true, removedObjects: paths.length + appearancePaths.length })
    }
    return reply({ error: 'Unsupported action.' }, 400)
  } catch (error) {
    return requestFailure(request, error)
  }
})
