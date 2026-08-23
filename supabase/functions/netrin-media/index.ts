import { createClient } from 'npm:@supabase/supabase-js@2.55.0'
import { corsHeaders, isAllowedOrigin, json, publicServiceUrl, requestFailure } from '../_shared/http.ts'

const url = Deno.env.get('SUPABASE_URL') ?? ''
const publicUrl = Deno.env.get('SUPABASE_PUBLIC_URL') ?? ''
const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MAX_MEDIA_IDS = 200
const SIGNED_URL_SECONDS = 5 * 60

type MediaRow = { id: string; point_id: string; storage_path: string }
type PointRow = { id: string; route_id: string }
type RouteRow = { id: string; created_by: string | null; moderation_status: string }

Deno.serve(async (request) => {
  const reply = (body: unknown, status = 200) => json(request, body, status)
  if (!isAllowedOrigin(request)) return reply({ error: 'Origin not allowed.' }, 403)
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(request) })
  if (request.method !== 'POST') return reply({ error: 'Method not allowed.' }, 405)
  if (!url || !publicUrl || !anonKey || !serviceKey) return reply({ error: 'Service unavailable.' }, 503)

  try {
    const body = await request.json() as { mediaIds?: unknown }
    if (!Array.isArray(body.mediaIds) || body.mediaIds.length > MAX_MEDIA_IDS) {
      return reply({ error: `mediaIds must contain at most ${MAX_MEDIA_IDS} ids.` }, 400)
    }
    if (!body.mediaIds.every((id) => typeof id === 'string' && UUID.test(id))) {
      return reply({ error: 'Invalid media id.' }, 400)
    }
    const mediaIds = [...new Set(body.mediaIds as string[])]
    if (mediaIds.length === 0) return reply({ items: [] })

    const authorization = request.headers.get('authorization') ?? ''
    const token = authorization.replace(/^Bearer\s+/i, '')
    const service = createClient(url, serviceKey, { auth: { persistSession: false } })
    const caller = createClient(url, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false }
    })
    const { data: authData } = token ? await caller.auth.getUser(token) : { data: { user: null } }
    const user = authData.user
    const [{ data: role }, { data: profile }] = user ? await Promise.all([
      service.from('user_roles').select('role').eq('user_id', user.id).eq('role', 'admin').maybeSingle(),
      service.from('profiles').select('account_status').eq('id', user.id).maybeSingle()
    ]) : [{ data: null }, { data: null }]
    const isActiveConfirmedAdmin = Boolean(role) &&
      profile?.account_status === 'active' &&
      Boolean(user?.phone_confirmed_at)

    const mediaResult = await service.from('route_point_media')
      .select('id,point_id,storage_path').in('id', mediaIds)
    if (mediaResult.error) throw mediaResult.error
    const media = (mediaResult.data ?? []) as MediaRow[]
    const pointIds = [...new Set(media.map((item) => item.point_id))]
    const pointResult = await service.from('route_points').select('id,route_id').in('id', pointIds)
    if (pointResult.error) throw pointResult.error
    const points = (pointResult.data ?? []) as PointRow[]
    const routeIds = [...new Set(points.map((item) => item.route_id))]
    const routeResult = await service.from('routes')
      .select('id,created_by,moderation_status').in('id', routeIds)
    if (routeResult.error) throw routeResult.error
    const routes = (routeResult.data ?? []) as RouteRow[]

    const routeById = new Map(routes.map((route) => [route.id, route]))
    const pointById = new Map(points.map((point) => [point.id, point]))
    const readable = media.filter((item) => {
      const route = routeById.get(pointById.get(item.point_id)?.route_id ?? '')
      return route?.moderation_status === 'approved' ||
        Boolean(user && route?.created_by === user.id) ||
        isActiveConfirmedAdmin
    })
    const expiresAt = new Date(Date.now() + SIGNED_URL_SECONDS * 1000).toISOString()
    const items = (await Promise.all(readable.map(async (item) => {
      const signed = await service.storage.from('route-media')
        .createSignedUrl(item.storage_path, SIGNED_URL_SECONDS)
      return signed.error || !signed.data?.signedUrl
        ? null
        : { mediaId: item.id, url: publicServiceUrl(signed.data.signedUrl, publicUrl), expiresAt }
    }))).filter(Boolean)

    return reply({ items })
  } catch (error) {
    return requestFailure(request, error)
  }
})
