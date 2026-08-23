import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation } from 'react-router-dom'

function setMeta(name: string, value: string) {
  const selector = `meta[name="${name}"]`
  let element = document.head.querySelector<HTMLMetaElement>(selector)
  if (!element) {
    element = document.createElement('meta')
    element.name = name
    document.head.appendChild(element)
  }
  element.content = value
}

export function DocumentMetadata() {
  const { i18n, t } = useTranslation()
  const location = useLocation()

  useEffect(() => {
    const locale = i18n.language.startsWith('en') ? 'en' : 'zh-CN'
    const base = import.meta.env.BASE_URL.endsWith('/')
      ? import.meta.env.BASE_URL
      : `${import.meta.env.BASE_URL}/`
    document.documentElement.lang = locale
    document.title = location.pathname === '/appearance-studio'
      ? t('appearanceStudio.documentTitle')
      : t('app.documentTitle')
    setMeta('application-name', t('app.name'))
    setMeta('description', t('app.tagline'))
    const manifest = document.getElementById('app-manifest') as HTMLLinkElement | null
    if (manifest) manifest.href = `${base}manifest.${locale}.webmanifest`
  }, [i18n.language, location.pathname, t])

  return null
}
