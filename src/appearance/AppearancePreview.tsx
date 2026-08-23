import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { localAppearanceRepository } from './repository'
import { mountAppearance, type MountedAppearance } from './runtimeStyle'
import { REQUIRED_APPEARANCE_SCREENS, type AppearanceScreenId } from './contract'
import type { AppearancePackage } from './types'

const PREVIEW_BASE_CSS = `
  :host { display: block; max-width:100%; color-scheme: dark; overflow:auto; }
  * { box-sizing: border-box; min-width:0; }
  button, input { font: inherit; }
  .app-frame {
    width: 390px; min-height: 844px; max-width:none; overflow-x:auto; overflow-y:visible; position: relative;
    padding: 28px 12px 86px; color: var(--foreground-default, #f4f5f2);
    background: var(--surface-app, #0b0c0e); font: 14px/1.35 system-ui, sans-serif;
  }
  .preview-top { display:flex; justify-content:space-between; align-items:center; gap:12px; margin-bottom:12px; }
  .preview-top > * { min-width:0; }
  .preview-brand { display:flex; flex-wrap:wrap; align-items:center; gap:6px; width:max-content; max-width:100%; padding:8px 10px; }
  .preview-brand-mark { width:10px; height:10px; display:inline-block; }
  h2,h3,p { margin:0; } h2 { font-size:22px; } h3 { font-size:15px; }
  h2,h3,p,small,code { overflow-wrap:anywhere; }
  .preview-grid { display:grid; gap:10px; max-width:100%; }
  .preview-screen-picker { display:flex; gap:6px; margin-bottom:10px; overflow-x:auto; }
  .preview-screen-picker button { flex:0 0 auto; font-size:11px; }
  .preview-card, .preview-map, .preview-sheet, .preview-dialog, .preview-toast {
    border:2px solid var(--panel-border, #f4f5f2); padding:10px;
    background:var(--panel-bg, #111315);
  }
  .preview-actions, .preview-gallery, .preview-map-controls, .preview-nav { display:flex; flex-wrap:wrap; gap:8px; }
  button, input, .preview-tab { min-width:var(--control-min-target, 44px); min-height:var(--control-min-target, 44px); border:1px solid currentColor; padding:8px 10px; }
  button { color:var(--button-fg, inherit); background:var(--button-bg, #171a1d); border-color:var(--button-border, currentColor); border-radius:var(--button-radius, 0); }
  button[disabled] { opacity:.55; }
  input { width:100%; color:inherit; background:transparent; }
  .preview-switch { border-radius:999px; min-width:54px; }
  .preview-map { min-height:140px; position:relative; background:#d9e1d0; color:#111; }
  .preview-map-controls { position:absolute; right:8px; top:8px; flex-direction:column; }
  .preview-provider { display:grid; place-items:center; min-height:90px; font-weight:700; }
  .amap-copyright { position:absolute; right:6px; bottom:4px; font-size:10px; color:#111; background:#fff; padding:2px 4px; }
  .preview-gallery > span { width:58px; height:42px; display:grid; place-items:center; background:#596d55; color:#fff; }
  .preview-status { display:grid; grid-template-columns:repeat(3,1fr); gap:6px; }
  .preview-status > div { min-height:54px; padding:6px; border:1px solid currentColor; }
  .preview-brand-fixtures { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; margin-bottom:10px; }
  .preview-brand-fixture { display:grid; align-content:start; gap:6px; min-height:82px; padding:8px; border:1px solid currentColor; }
  .preview-brand-fixture__target { display:inline-flex; align-items:center; justify-self:start; gap:6px; max-width:100%; padding:6px 8px; overflow-wrap:anywhere; }
  .preview-brand-fixture__mark { width:14px; height:14px; padding:0; background:var(--signal-success,#77d678); }
  .preview-dialog { outline:2px solid var(--focus-ring, #f0bd4f); }
  .preview-toast { border-color:var(--signal-success, #77d678); }
  .preview-nav { position:absolute; left:0; right:0; bottom:0; padding:8px 12px 20px; justify-content:space-around; background:var(--navigation-bg,#08090a); }
  .preview-tab { display:grid; place-items:center; border:0; }
  .quiet { color:var(--foreground-muted,#b6b9bd); }
  @media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation:none !important; transition:none !important; } }
`

export function AppearancePreview({ packageId, appearance }: { packageId: string; appearance?: AppearancePackage }) {
  const { t } = useTranslation()
  const hostRef = useRef<HTMLDivElement>(null)
  const [shadow, setShadow] = useState<ShadowRoot | null>(null)
  const [screenId, setScreenId] = useState<AppearanceScreenId>('map-navigation')

  useEffect(() => {
    const host = hostRef.current
    if (!host) return undefined
    const root = host.shadowRoot ?? host.attachShadow({ mode: 'open' })
    const baseStyle = document.createElement('style')
    baseStyle.dataset.netrinPreviewBase = 'true'
    baseStyle.textContent = PREVIEW_BASE_CSS
    root.append(baseStyle)
    setShadow(root)
    return () => {
      setShadow(null)
      root.replaceChildren()
    }
  }, [])

  useEffect(() => {
    if (!shadow) return undefined
    let active = true
    let mounted: MountedAppearance | undefined
    const frame = shadow.querySelector<HTMLElement>('.app-frame')
    if (!frame) return undefined
    if (appearance) mounted = mountAppearance(appearance, frame, shadow)
    else void localAppearanceRepository.get(packageId).then((storedAppearance) => {
      if (!active || !storedAppearance) return
      mounted = mountAppearance(storedAppearance, frame, shadow)
    })
    return () => {
      active = false
      mounted?.dispose()
    }
  }, [appearance, packageId, shadow])

  return (
    <div className="appearance-preview-shadow" ref={hostRef}>
      {shadow ? createPortal(
        <div className="app-frame" data-appearance={packageId} data-appearance-hook="app-shell">
          <header className="preview-top" data-appearance-hook="top-bar">
            <div className="preview-brand" data-appearance-slot="brand-wordmark">
              <b data-appearance-slot="brand-title">NETRIN</b>
              <span data-appearance-slot="brand-name">{t('app.name')}</span>
              <span className="preview-brand-mark" data-appearance-slot="brand-mark" aria-label={t('app.live')} />
            </div>
            <div>
              <small>390 × 844 · {t(`appearanceStudio.previewScreens.${screenId}`)}</small>
              <h2>{t('profile.appearancePreview')}</h2>
            </div>
            <button type="button" data-appearance-hook="icon-button" aria-label={t('profile.closeAppearancePreview')}>×</button>
          </header>
          <nav className="preview-screen-picker" aria-label={t('appearanceStudio.previewScreenPicker')} data-appearance-slot="tabs">
            {REQUIRED_APPEARANCE_SCREENS.map((id) => (
              <button
                key={id}
                type="button"
                data-appearance-hook="button"
                aria-selected={id === screenId}
                onClick={() => setScreenId(id)}
              >
                {t(`appearanceStudio.previewScreens.${id}`)}
              </button>
            ))}
          </nav>
          <section className="preview-brand-fixtures" aria-label={t('appearanceStudio.brandSlotFixtures')}>
            <article className="preview-brand-fixture" data-brand-slot-fixture="brand-wordmark">
              <small>brand-wordmark</small>
              <span className="preview-brand-fixture__target" data-appearance-slot="brand-wordmark">NETRIN · {t('app.name')}</span>
            </article>
            <article className="preview-brand-fixture" data-brand-slot-fixture="brand-title">
              <small>brand-title</small>
              <b className="preview-brand-fixture__target" data-appearance-slot="brand-title">NETRIN</b>
            </article>
            <article className="preview-brand-fixture" data-brand-slot-fixture="brand-name">
              <small>brand-name</small>
              <span className="preview-brand-fixture__target" data-appearance-slot="brand-name">{t('app.name')}</span>
            </article>
            <article className="preview-brand-fixture" data-brand-slot-fixture="brand-mark">
              <small>brand-mark</small>
              <span className="preview-brand-fixture__target preview-brand-fixture__mark" data-appearance-slot="brand-mark" aria-label={t('app.live')} />
            </article>
          </section>
          <main
            className="preview-grid"
            data-appearance-hook="screen-content"
            data-appearance-screen={screenId}
            data-appearance-state="ready"
          >
            <section className="preview-actions" aria-label={t('profile.appearancePreviewStates')}>
              <button type="button" data-appearance-hook="button">{t('common.choose')}</button>
              <button type="button" data-appearance-hook="button" disabled>{t('common.loading')}</button>
              <button type="button" data-appearance-hook="button" aria-busy="true">•••</button>
            </section>
            <label data-appearance-hook="text-field">
              <span>{t('profile.routeTitle')}</span>
              <input value={t('profile.appearancePreviewValue')} readOnly />
            </label>
            <button className="preview-switch" type="button" role="switch" aria-checked="true" data-appearance-hook="switch">
              {t('profile.appearancePreviewSwitch')}
            </button>
            <article className="preview-card" data-appearance-hook="route-card">
              <h3>{t('profile.appearanceSampleRoute')}</h3>
              <p className="quiet">3 {t('profile.appearanceSamplePoints')}</p>
            </article>
            <article className="preview-card" data-appearance-hook="route-point-card">
              <h3>01 · {t('profile.appearanceSamplePoint')}</h3>
              <p>{t('profile.appearanceSampleSpecies')}</p>
              <div className="preview-gallery" data-appearance-hook="media-gallery"><span>1</span><span>2</span><span>3</span></div>
            </article>
            <section className="preview-map" data-appearance-hook="map-frame">
              <div className="preview-provider">{t('profile.appearanceSampleProvider')}</div>
              <div className="preview-map-controls" data-appearance-hook="map-controls">
                <button type="button">⌖</button><button type="button">N</button>
              </div>
              <span className="amap-copyright">高德地图 © AutoNavi</span>
            </section>
            <section className="preview-card" data-appearance-hook="recorder-panel">
              <b>{t('profile.appearanceSampleRecorder')}</b><p className="quiet">03:28 · {t('profile.appearanceSamplePointCount', { count: 3 })}</p>
            </section>
            <section className="preview-card" data-appearance-hook="route-plan-confirmation" data-appearance-state="valid">
              <b>{t('profile.appearanceSampleRoute')}</b><p className="quiet">WGS-84 · 3 points · ready</p>
            </section>
            <section className="preview-card" data-appearance-hook="navigation-instruction">
              <b>{t('profile.appearanceSampleNavigation')}</b><p>120 m</p>
            </section>
            <section className="preview-sheet" data-appearance-hook="sheet">{t('profile.appearanceSampleSheet')}</section>
            <section className="preview-dialog" data-appearance-hook="dialog">{t('profile.appearanceSampleDialog')}</section>
            <section className="preview-toast" data-appearance-hook="toast">{t('profile.appearanceSampleToast')}</section>
            <section className="preview-status">
              <div data-appearance-hook="loading-state">{t('common.loading')}</div>
              <div data-appearance-hook="empty-state">{t('profile.appearanceSampleEmpty')}</div>
              <div data-appearance-hook="error-state">{t('profile.appearanceSampleError')}</div>
            </section>
          </main>
          <nav className="preview-nav" data-appearance-hook="bottom-navigation">
            <span className="preview-tab">⌖</span><span className="preview-tab">☷</span><span className="preview-tab">＋</span><span className="preview-tab">◎</span>
          </nav>
        </div>,
        shadow
      ) : null}
    </div>
  )
}
