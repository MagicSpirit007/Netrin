export type SendSmsHookPayload = {
  user?: { phone?: string | null }
  sms?: { otp?: string | null; phone?: string | null }
}

export type SmsProviderBody = {
  code?: string | null
  success?: boolean | null
  requestId?: string | null
  model?: { requestId?: string | null } | null
}

export type SmsProviderError = {
  code?: unknown
  requestId?: unknown
  data?: { Code?: unknown; RequestId?: unknown }
}

export const PHONE_PATTERN = /^(?:\+86|86)1[3-9]\d{9}$/
export const OTP_PATTERN = /^\d{6}$/

export function maskPhone(phone: string): string {
  const local = phone.slice(3)
  return `${local.slice(0, 3)}****${local.slice(-4)}`
}

export function webhookSigningSecret(value: string): string {
  return value.replace(/^v1,whsec_/, '')
}

export function readHookTarget(payload: SendSmsHookPayload): { phone: string; otp: string } | null {
  const rawPhone = payload.sms?.phone ?? payload.user?.phone ?? ''
  const otp = payload.sms?.otp ?? ''
  if (!PHONE_PATTERN.test(rawPhone) || !OTP_PATTERN.test(otp)) return null
  const phone = rawPhone.startsWith('+') ? rawPhone : `+${rawPhone}`
  return { phone, otp }
}

export function buildProviderRequest(
  phone: string,
  otp: string,
  signName: string,
  templateCode: string,
  outId: string
) {
  return {
    autoRetry: 1,
    codeLength: 6,
    countryCode: '86',
    duplicatePolicy: 1,
    interval: 60,
    outId,
    phoneNumber: phone.slice(3),
    returnVerifyCode: false,
    signName,
    templateCode,
    templateParam: JSON.stringify({ code: otp, min: '5' }),
    validTime: 300
  }
}

export function providerAccepted(body: SmsProviderBody | null | undefined): boolean {
  return body?.success === true && body.code === 'OK'
}

export function resolveProviderRequestId(body: SmsProviderBody | null | undefined, fallback: string): string {
  return body?.requestId ?? body?.model?.requestId ?? fallback
}

export function safeProviderError(error: unknown): { code: string; requestId?: string } {
  const value = error && typeof error === 'object' ? error as SmsProviderError : {}
  const rawCode = typeof value.code === 'string' ? value.code : value.data?.Code
  const rawRequestId = typeof value.requestId === 'string' ? value.requestId : value.data?.RequestId
  const code = typeof rawCode === 'string' && /^[A-Z0-9_.-]{2,80}$/i.test(rawCode)
    ? rawCode
    : 'PROVIDER_REQUEST_FAILED'
  const requestId = typeof rawRequestId === 'string' && /^[A-Z0-9-]{8,80}$/i.test(rawRequestId)
    ? rawRequestId
    : undefined
  return { code, requestId }
}
