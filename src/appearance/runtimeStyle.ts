import { ASSET_URL_MARKER } from './cssSecurity'
import { CONTRACT_CSS_VARIABLES } from './tokenContract'
import type { AppearancePackage } from './types'

export type MountedAppearance = {
  dispose: () => void
}

const LEGACY_TOKEN_ALIASES: Partial<Record<`--${string}`, readonly `--${string}`[]>> = {
  '--foreground-default': ['--fg', '--fg-ink'],
  '--foreground-muted': ['--fg-muted', '--fg-ink-muted'],
  '--border-default': ['--line-ink'],
  '--border-soft': ['--line-ink-soft'],
  '--border-hairline': ['--hairline'],
  '--border-strong': ['--hairline-strong'],
  '--signal-success': ['--signal-green'],
  '--signal-warning': ['--signal-amber'],
  '--signal-info': ['--signal-blue'],
  '--signal-danger': ['--signal-red'],
  '--foreground-on-signal': ['--on-signal'],
  '--focus-ring': ['--signal-amber'],
  '--control-min-target': ['--tap-min'],
  '--duration-fast': ['--dur-fast'],
  '--duration-normal': ['--dur-normal']
}

function asArrayBuffer(data: Uint8Array): ArrayBuffer {
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
}

function replaceAssetMarkers(appearance: AppearancePackage, urls: Map<string, string>): string {
  let css = appearance.sanitizedCss ?? ''
  for (const [path, asset] of Object.entries(appearance.assets ?? {})) {
    const url = URL.createObjectURL(new Blob([asArrayBuffer(asset.data)], { type: asset.mimeType }))
    urls.set(path, url)
    css = css.split(`${ASSET_URL_MARKER}${path}`).join(url)
  }
  return css
}

export function clearAppearanceTokens(root: HTMLElement, extraNames: Iterable<string> = []): void {
  CONTRACT_CSS_VARIABLES.forEach((name) => root.style.removeProperty(name))
  for (const name of extraNames) root.style.removeProperty(name)
}

export function mountAppearance(
  appearance: AppearancePackage,
  root: HTMLElement,
  styleHost: Document | ShadowRoot = document
): MountedAppearance {
  const urls = new Map<string, string>()
  const tokenNames = Object.keys(appearance.compiledTokens ?? {})
  const aliasNames: string[] = []
  const style = document.createElement('style')
  style.dataset.netrinAppearanceStyle = appearance.manifest.id
  clearAppearanceTokens(root)
  root.dataset.appearance = appearance.manifest.id
  Object.entries(appearance.compiledTokens ?? {}).forEach(([name, value]) => {
    if (typeof value === 'string') {
      root.style.setProperty(name, value)
      for (const alias of LEGACY_TOKEN_ALIASES[name as `--${string}`] ?? []) {
        root.style.setProperty(alias, value)
        aliasNames.push(alias)
      }
    }
  })

  if (appearance.sanitizedCss) {
    style.textContent = replaceAssetMarkers(appearance, urls)
    if (styleHost instanceof Document) styleHost.head.append(style)
    else styleHost.append(style)
  }

  return {
    dispose() {
      style.remove()
      urls.forEach((url) => URL.revokeObjectURL(url))
      clearAppearanceTokens(root, [...tokenNames, ...aliasNames])
      if (root.dataset.appearance === appearance.manifest.id) delete root.dataset.appearance
    }
  }
}
