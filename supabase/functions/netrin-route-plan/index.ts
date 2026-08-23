import { createClient } from 'npm:@supabase/supabase-js@2.55.0'
import { authorizeRoutePlanRequest, type RoutePlanAuthorization } from './auth.ts'
import { createRoutePlanHandler } from './handler.ts'

const url = Deno.env.get('SUPABASE_URL') ?? ''
const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const amapKey = Deno.env.get('AMAP_WEB_SERVICE_KEY') ?? ''
const dailyAlertThreshold = Number(Deno.env.get('AMAP_ROUTE_DAILY_ALERT_THRESHOLD') ?? 0)

async function authorize(request: Request): Promise<RoutePlanAuthorization> {
  if (!url || !anonKey) {
    return { ok: false, status: 503, error: 'Account validation is unavailable.' }
  }
  const authorization = request.headers.get('authorization') ?? ''
  const caller = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false }
  })
  return authorizeRoutePlanRequest(request, {
    async getUser(token) {
      const { data, error } = await caller.auth.getUser(token)
      return { user: data.user, error }
    },
    async getAccountStatus(userId) {
      const { data, error } = await caller.from('profiles')
        .select('account_status')
        .eq('id', userId)
        .maybeSingle()
      return { status: data?.account_status ?? null, error }
    }
  })
}

Deno.serve(createRoutePlanHandler({
  amapKey,
  authorize,
  dailyAlertThreshold
}))
