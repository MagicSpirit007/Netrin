const CHINA_MOBILE = /^1[3-9]\d{9}$/

function compactPhone(value: string): string {
  return value.trim().replace(/[\s()-]/g, '')
}
/** Normalize a mainland China mobile number to the E.164 value Supabase stores. */
export function normalizeChinaPhone(value: string): string | null {
  let compact = compactPhone(value)
  if (compact.startsWith('0086')) compact = compact.slice(4)
  else if (compact.startsWith('+86')) compact = compact.slice(3)
  else if (compact.startsWith('86') && compact.length === 13) compact = compact.slice(2)
  if (!CHINA_MOBILE.test(compact)) return null
  return `+86${compact}`
}

export function formatChinaPhoneInput(value: string): string {
  const normalized = normalizeChinaPhone(value)
  return normalized ? normalized.slice(3) : value
}

export function maskChinaPhone(value: string | null | undefined): string {
  if (!value) return ''
  const normalized = normalizeChinaPhone(value)
  if (!normalized) return ''
  const local = normalized.slice(3)
  return `${local.slice(0, 3)}****${local.slice(-4)}`
}
