import { useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { classifyAuthError, type AuthErrorKind } from '../auth/authError'
import { useAuth } from '../auth/AuthProvider'
import { formatChinaPhoneInput, maskChinaPhone, normalizeChinaPhone } from '../auth/phone'
import { Button } from '../components/core/Button'
import { TextField } from '../components/forms/TextField'
import { Panel } from '../components/surfaces/Panel'
import { supabase } from '../lib/supabase'

type AuthMode = 'login' | 'register' | 'forgot'
type OtpPurpose = 'signup' | 'recovery' | 'phone_change'
type PendingOtp = { phone: string; purpose: OtpPurpose }

const OTP_RESEND_SECONDS = 60
const ALLOWED_NEXT_PATHS = new Set(['/', '/discover', '/create', '/profile', '/workshop', '/admin', '/appearance-studio', '/legal'])
const ALLOWED_NEXT_PREFIXES = ['/create/', '/route/', '/guide/', '/legal/']

export function AuthScreen() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { configured, loading, user, profile, isAnonymous, refresh, signOut } = useAuth()
  const [mode, setMode] = useState<AuthMode>('login')
  const [phone, setPhone] = useState(formatChinaPhoneInput(user?.phone ?? ''))
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState(profile?.displayName ?? '')
  const [otp, setOtp] = useState('')
  const [pendingOtp, setPendingOtp] = useState<PendingOtp | null>(null)
  const [resetPassword, setResetPassword] = useState(false)
  const [resendSeconds, setResendSeconds] = useState(0)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const requestedNext = params.get('next')
  let next = '/profile'
  if (requestedNext) {
    try {
      const parsed = new URL(requestedNext, window.location.origin)
      if (
        parsed.origin === window.location.origin &&
        (ALLOWED_NEXT_PATHS.has(parsed.pathname) || ALLOWED_NEXT_PREFIXES.some((prefix) => parsed.pathname.startsWith(prefix)))
      ) {
        next = `${parsed.pathname}${parsed.search}${parsed.hash}`
      }
    } catch {
      // Keep the safe profile fallback for malformed or cross-origin targets.
    }
  }

  useEffect(() => {
    if (user?.phone && !phone) setPhone(formatChinaPhoneInput(user.phone))
  }, [phone, user?.phone])

  useEffect(() => {
    if (resendSeconds <= 0) return
    const timer = window.setTimeout(() => setResendSeconds((value) => Math.max(0, value - 1)), 1000)
    return () => window.clearTimeout(timer)
  }, [resendSeconds])

  const showError = (error: unknown) => {
    const classified = classifyAuthError(error)
    const message = t(`auth.errors.${classified.kind}`)
    setNotice({
      kind: 'error',
      text: classified.kind === 'unknown' && classified.code
        ? t('auth.errors.withCode', { message, code: classified.code })
        : message
    })
    if (import.meta.env.DEV) console.error('[auth]', error)
    return classified.kind
  }

  const requirePhone = (): string | null => {
    const normalized = normalizeChinaPhone(phone)
    if (!normalized) setNotice({ kind: 'error', text: t('auth.errors.invalidPhone') })
    return normalized
  }

  const validatePassword = (): boolean => {
    if (password.length >= 8) return true
    setNotice({ kind: 'error', text: t('auth.passwordLength') })
    return false
  }

  const validateDisplayName = (): boolean => {
    if (!displayName.trim()) {
      setNotice({ kind: 'error', text: t('auth.displayNameRequired') })
      return false
    }
    if (displayName.trim().length > 60) {
      setNotice({ kind: 'error', text: t('auth.displayNameLength') })
      return false
    }
    return true
  }

  const requestRecoveryCode = async (normalizedPhone: string): Promise<void> => {
    if (!supabase) return
    const { error } = await supabase.auth.signInWithOtp({
      phone: normalizedPhone,
      options: { shouldCreateUser: false }
    })
    if (error) {
      const classified = classifyAuthError(error).kind
      const serviceFailure: AuthErrorKind[] = ['invalidPhone', 'rateLimited', 'signupDisabled', 'network', 'smsUnavailable']
      if (serviceFailure.includes(classified)) throw error
      // Unknown phone numbers receive the same UI as registered numbers.
    }
  }

  const submitCredentials = async () => {
    if (!supabase) return
    const normalizedPhone = requirePhone()
    if (!normalizedPhone) return

    if (mode === 'forgot') {
      await requestRecoveryCode(normalizedPhone)
      setPendingOtp({ phone: normalizedPhone, purpose: 'recovery' })
      setResendSeconds(OTP_RESEND_SECONDS)
      setNotice({ kind: 'success', text: t('auth.recoverySent') })
      return
    }

    if (mode === 'register' || isAnonymous) {
      if (!validateDisplayName() || !validatePassword()) return
      if (isAnonymous) {
        const { error } = await supabase.auth.updateUser({
          phone: normalizedPhone,
          password,
          data: { display_name: displayName.trim() }
        })
        if (error) throw error
        setPendingOtp({ phone: normalizedPhone, purpose: 'phone_change' })
      } else {
        const { data, error } = await supabase.auth.signUp({
          phone: normalizedPhone,
          password,
          options: { data: { display_name: displayName.trim() } }
        })
        if (error) throw error
        if (data.session) {
          navigate(next, { replace: true })
          return
        }
        setPendingOtp({ phone: normalizedPhone, purpose: 'signup' })
      }
      setPassword('')
      setResendSeconds(OTP_RESEND_SECONDS)
      setNotice({ kind: 'success', text: t('auth.confirmationSent') })
      return
    }

    const { error } = await supabase.auth.signInWithPassword({ phone: normalizedPhone, password })
    if (error) throw error
    navigate(next, { replace: true })
  }

  const submitOtp = async () => {
    if (!supabase || !pendingOtp) return
    if (!/^\d{6}$/.test(otp)) {
      setNotice({ kind: 'error', text: t('auth.errors.invalidOtp') })
      return
    }
    const type = pendingOtp.purpose === 'phone_change' ? 'phone_change' : 'sms'
    const { error } = await supabase.auth.verifyOtp({ phone: pendingOtp.phone, token: otp, type })
    if (error) throw error
    setOtp('')
    if (pendingOtp.purpose === 'recovery') {
      setPendingOtp(null)
      setResetPassword(true)
      setPassword('')
      setNotice(null)
      return
    }
    await refresh()
    navigate(next, { replace: true })
  }

  const saveNewPassword = async () => {
    if (!supabase || !validatePassword()) return
    const { error } = await supabase.auth.updateUser({ password })
    if (error) throw error
    setResetPassword(false)
    setPassword('')
    await refresh()
    navigate(next, { replace: true })
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!supabase) {
      setNotice({ kind: 'error', text: t('auth.unconfigured') })
      return
    }
    setBusy(true)
    setNotice(null)
    try {
      if (resetPassword) await saveNewPassword()
      else if (pendingOtp) await submitOtp()
      else await submitCredentials()
    } catch (error) {
      showError(error)
    } finally {
      setBusy(false)
    }
  }

  const resend = async () => {
    if (!supabase || !pendingOtp || resendSeconds > 0) return
    setBusy(true)
    setNotice(null)
    try {
      if (pendingOtp.purpose === 'recovery') {
        await requestRecoveryCode(pendingOtp.phone)
      } else {
        const type = pendingOtp.purpose === 'phone_change' ? 'phone_change' : 'sms'
        const { error } = await supabase.auth.resend({ type, phone: pendingOtp.phone })
        if (error) throw error
      }
      setOtp('')
      setResendSeconds(OTP_RESEND_SECONDS)
      setNotice({ kind: 'success', text: t('auth.codeResent') })
    } catch (error) {
      showError(error)
    } finally {
      setBusy(false)
    }
  }

  const switchMode = (nextMode: AuthMode) => {
    setMode(nextMode)
    setPendingOtp(null)
    setResetPassword(false)
    setOtp('')
    setPassword('')
    setNotice(null)
  }

  if (loading) return <section className="screen" data-appearance-state="loading"><p role="status" data-appearance-hook="loading-state">{t('common.loading')}</p></section>

  if (user && !isAnonymous && !pendingOtp && !resetPassword) {
    return (
      <section className="screen auth-screen" data-appearance-state="signed-in">
        <header className="screen-heading" data-appearance-hook="top-bar"><h1>{t('auth.account')}</h1><p>{t('auth.accountHint')}</p></header>
        <Panel variant="dark" padding="16px">
          <dl className="account-summary">
            <div><dt>{t('auth.displayName')}</dt><dd>{profile?.displayName || '—'}</dd></div>
            <div><dt>{t('auth.phone')}</dt><dd>{maskChinaPhone(user.phone) || '—'}</dd></div>
            <div><dt>{t('auth.status')}</dt><dd>{t(`auth.statusValues.${profile?.status ?? 'active'}`)}</dd></div>
          </dl>
          <div className="auth-actions">
            <Button variant="solid" icon="arrow-left" onClick={() => navigate(next)}>{t('auth.returnToApp')}</Button>
            <Button variant="ghost" icon="lock" onClick={() => void signOut()}>{t('auth.signOut')}</Button>
          </div>
        </Panel>
      </section>
    )
  }

  const title = resetPassword
    ? t('auth.setPassword')
    : pendingOtp
      ? t('auth.verifyPhone')
      : isAnonymous
        ? t('auth.upgradeTitle')
        : t(`auth.modes.${mode}`)
  const appearanceState = notice?.kind === 'error'
    ? 'error'
    : resetPassword
      ? 'reset-password'
      : pendingOtp
        ? 'verify-phone'
        : mode

  return (
    <section className="screen auth-screen" data-appearance-state={appearanceState}>
      <header className="screen-heading" data-appearance-hook="top-bar"><h1>{title}</h1><p>{isAnonymous ? t('auth.upgradeHint') : t('auth.hint')}</p></header>
      {!configured ? <Panel variant="dark"><p className="quiet">{t('auth.unconfigured')}</p></Panel> : null}
      <Panel variant="dark" padding="16px">
        <form className="auth-form" onSubmit={(event) => void submit(event)}>
          {pendingOtp ? (
            <>
              <p className="quiet">{t('auth.codeSentTo', { phone: maskChinaPhone(pendingOtp.phone) })}</p>
              <TextField
                label={t('auth.verificationCode')}
                value={otp}
                onChange={(value) => setOtp(value.replace(/\D/g, '').slice(0, 6))}
                autoComplete="one-time-code"
                inputMode="numeric"
                required
                minLength={6}
                maxLength={6}
                disabled={busy}
              />
            </>
          ) : (
            <>
              {(mode === 'register' || isAnonymous) && !resetPassword ? (
                <TextField
                  label={t('auth.displayName')}
                  value={displayName}
                  onChange={setDisplayName}
                  autoComplete="nickname"
                  required
                  minLength={1}
                  maxLength={60}
                  disabled={busy}
                />
              ) : null}
              {!resetPassword ? (
                <TextField
                  label={t('auth.phone')}
                  value={phone}
                  onChange={setPhone}
                  placeholder="13800138000"
                  autoComplete="tel-national"
                  inputMode="tel"
                  autoCapitalize="none"
                  spellCheck={false}
                  required
                  maxLength={24}
                  disabled={busy}
                />
              ) : null}
              {mode !== 'forgot' || resetPassword ? (
                <TextField
                  label={resetPassword ? t('auth.newPassword') : t('auth.password')}
                  type="password"
                  value={password}
                  onChange={setPassword}
                  autoComplete={mode === 'login' && !resetPassword && !isAnonymous ? 'current-password' : 'new-password'}
                  required
                  minLength={8}
                  disabled={busy}
                />
              ) : null}
            </>
          )}
          {notice ? <p className={notice.kind === 'success' ? 'save-message' : 'form-error'} role={notice.kind === 'error' ? 'alert' : 'status'} data-appearance-hook={notice.kind === 'error' ? 'error-state' : 'toast'}>{notice.text}</p> : null}
          <Button type="submit" block disabled={busy || !configured} icon="lock">
            {busy ? t('auth.working') : t(resetPassword ? 'auth.savePassword' : pendingOtp ? 'auth.verifyCode' : isAnonymous ? 'auth.upgradeAction' : `auth.actions.${mode}`)}
          </Button>
          {pendingOtp ? (
            <Button type="button" block variant="ghost" disabled={busy || resendSeconds > 0} onClick={() => void resend()}>
              {resendSeconds > 0 ? t('auth.resendCountdown', { seconds: resendSeconds }) : t('auth.resendCode')}
            </Button>
          ) : null}
        </form>
      </Panel>
      {pendingOtp ? <Button variant="ghost" onClick={() => switchMode(pendingOtp.purpose === 'recovery' ? 'forgot' : 'register')}>{t('auth.changePhone')}</Button> : null}
      {!isAnonymous && !pendingOtp && !resetPassword ? (
        <div className="auth-mode-switch">
          {mode !== 'login' ? <Button variant="ghost" onClick={() => switchMode('login')}>{t('auth.backToLogin')}</Button> : null}
          {mode === 'login' ? <Button variant="ghost" onClick={() => switchMode('register')}>{t('auth.createAccount')}</Button> : null}
          {mode === 'login' ? <Button variant="ghost" onClick={() => switchMode('forgot')}>{t('auth.forgotPassword')}</Button> : null}
        </div>
      ) : null}
    </section>
  )
}
