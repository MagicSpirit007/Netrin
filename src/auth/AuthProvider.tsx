import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { isSupabaseConfigured, supabase } from '../lib/supabase'

function clearAiProviderSessionData(): void {
  void import('../lib/ai-route/providerSession').then(({ clearAllProviderSessionData }) => {
    clearAllProviderSessionData()
  })
}

export type AccountProfile = {
  id: string
  displayName: string
  status: 'active' | 'suspended' | 'deleting'
}

type AuthValue = {
  configured: boolean
  loading: boolean
  session: Session | null
  user: User | null
  profile: AccountProfile | null
  isAnonymous: boolean
  isAdmin: boolean
  refresh: () => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true)
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<AccountProfile | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const hydrateGeneration = useRef(0)
  const credentialOwner = useRef<string | null | undefined>(undefined)

  const hydrate = useCallback(async (nextSession: Session | null) => {
    const nextOwner = nextSession?.user.id ?? null
    if (credentialOwner.current !== undefined && credentialOwner.current !== nextOwner) {
      clearAiProviderSessionData()
    }
    credentialOwner.current = nextOwner
    const generation = ++hydrateGeneration.current
    setLoading(true)
    setSession(nextSession)
    // Never let profile/role state from the previous session survive an
    // account switch while the new authorization queries are in flight.
    setProfile(null)
    setIsAdmin(false)
    if (!supabase || !nextSession?.user) {
      if (generation !== hydrateGeneration.current) return
      setLoading(false)
      return
    }
    const userId = nextSession.user.id
    const { data: account } = await supabase.rpc('get_my_account_v1')
    if (generation !== hydrateGeneration.current) return
    const row = account && typeof account === 'object' ? account as Record<string, unknown> : null
    setProfile(row && typeof row.displayName === 'string' && ['active', 'suspended', 'deleting'].includes(String(row.status)) ? {
      id: userId,
      displayName: row.displayName,
      status: row.status as AccountProfile['status']
    } : null)
    setIsAdmin(
      row?.isAdmin === true &&
      row?.status === 'active' &&
      Boolean(nextSession.user.phone_confirmed_at)
    )
    setLoading(false)
  }, [])

  const refresh = useCallback(async () => {
    if (!supabase) {
      setLoading(false)
      return
    }
    const { data } = await supabase.auth.getSession()
    await hydrate(data.session)
  }, [hydrate])

  useEffect(() => {
    void refresh()
    if (!supabase) return
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      void hydrate(nextSession)
    })
    return () => data.subscription.unsubscribe()
  }, [hydrate, refresh])

  const value = useMemo<AuthValue>(() => ({
    configured: isSupabaseConfigured,
    loading,
    session,
    user: session?.user ?? null,
    profile,
    isAnonymous: session?.user?.is_anonymous === true,
    isAdmin,
    refresh,
    signOut: async () => {
      if (supabase) await supabase.auth.signOut()
    }
  }), [isAdmin, loading, profile, refresh, session])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside AuthProvider')
  return value
}
