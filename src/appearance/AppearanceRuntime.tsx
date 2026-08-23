import { useEffect, useState } from 'react'
import { APPEARANCE_REPOSITORY_EVENT, localAppearanceRepository } from './repository'
import { mountAppearance, type MountedAppearance } from './runtimeStyle'
import { useNetrinState } from '../state/NetrinState'

export function AppearanceRuntime() {
  const { appearanceSettings, updateAppearanceSettings } = useNetrinState()
  const [repositoryRevision, setRepositoryRevision] = useState(0)

  useEffect(() => {
    const refresh = () => setRepositoryRevision((current) => current + 1)
    window.addEventListener(APPEARANCE_REPOSITORY_EVENT, refresh)
    return () => window.removeEventListener(APPEARANCE_REPOSITORY_EVENT, refresh)
  }, [])

  useEffect(() => {
    let active = true
    let mounted: MountedAppearance | undefined
    const root = document.querySelector<HTMLElement>('.app-frame')
    if (!root) return undefined

    void localAppearanceRepository.resolveActive(appearanceSettings.appearanceId).then((result) => {
      if (!active) return
      mounted = mountAppearance(result.appearance, root)
      if (result.fellBack) {
        updateAppearanceSettings({ appearanceId: result.appearance.manifest.id })
        window.dispatchEvent(new CustomEvent('netrin:appearance-fallback', {
          detail: { previousId: result.previousId, activeId: result.appearance.manifest.id }
        }))
      }
      window.dispatchEvent(new CustomEvent('netrin:appearance-change'))
    })

    return () => {
      active = false
      mounted?.dispose()
      window.dispatchEvent(new CustomEvent('netrin:appearance-change'))
    }
  }, [appearanceSettings.appearanceId, repositoryRevision])

  return null
}
