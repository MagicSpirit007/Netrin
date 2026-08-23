import type { AppearanceTokenType } from './types.ts'

export type ContractToken = {
  path: `semantic.${string}` | `component.${string}`
  cssName: `--${string}`
  type: AppearanceTokenType
}

export const APPEARANCE_TOKEN_CONTRACT: readonly ContractToken[] = [
  { path: 'semantic.surface.app', cssName: '--surface-app', type: 'color' },
  { path: 'semantic.surface.panel', cssName: '--surface-panel', type: 'color' },
  { path: 'semantic.surface.card', cssName: '--surface-card', type: 'color' },
  { path: 'semantic.surface.paper', cssName: '--surface-paper', type: 'color' },
  { path: 'semantic.surface.nav', cssName: '--surface-nav', type: 'color' },
  { path: 'semantic.foreground.default', cssName: '--foreground-default', type: 'color' },
  { path: 'semantic.foreground.muted', cssName: '--foreground-muted', type: 'color' },
  { path: 'semantic.foreground.paper', cssName: '--foreground-paper', type: 'color' },
  { path: 'semantic.foreground.paper-muted', cssName: '--foreground-paper-muted', type: 'color' },
  { path: 'semantic.foreground.on-signal', cssName: '--foreground-on-signal', type: 'color' },
  { path: 'semantic.border.default', cssName: '--border-default', type: 'color' },
  { path: 'semantic.border.soft', cssName: '--border-soft', type: 'color' },
  { path: 'semantic.border.hairline', cssName: '--border-hairline', type: 'color' },
  { path: 'semantic.border.strong', cssName: '--border-strong', type: 'color' },
  { path: 'semantic.signal.success', cssName: '--signal-success', type: 'color' },
  { path: 'semantic.signal.warning', cssName: '--signal-warning', type: 'color' },
  { path: 'semantic.signal.info', cssName: '--signal-info', type: 'color' },
  { path: 'semantic.signal.danger', cssName: '--signal-danger', type: 'color' },
  { path: 'semantic.map.ink', cssName: '--map-overlay-ink', type: 'color' },
  { path: 'semantic.map.route', cssName: '--map-overlay-route', type: 'color' },
  { path: 'semantic.map.guide', cssName: '--map-overlay-guide', type: 'color' },
  { path: 'semantic.map.warning', cssName: '--map-overlay-warning', type: 'color' },
  { path: 'semantic.font.sans', cssName: '--font-sans', type: 'fontFamily' },
  { path: 'semantic.font.mono', cssName: '--font-mono', type: 'fontFamily' },
  { path: 'semantic.font.display', cssName: '--font-display', type: 'fontFamily' },
  { path: 'semantic.radius.xs', cssName: '--radius-xs', type: 'dimension' },
  { path: 'semantic.radius.sm', cssName: '--radius-sm', type: 'dimension' },
  { path: 'semantic.radius.md', cssName: '--radius-md', type: 'dimension' },
  { path: 'semantic.radius.lg', cssName: '--radius-lg', type: 'dimension' },
  { path: 'semantic.shadow.hard', cssName: '--shadow-hard', type: 'shadow' },
  { path: 'semantic.motion.fast', cssName: '--duration-fast', type: 'duration' },
  { path: 'semantic.motion.normal', cssName: '--duration-normal', type: 'duration' },
  { path: 'component.button.background', cssName: '--button-bg', type: 'color' },
  { path: 'component.button.foreground', cssName: '--button-fg', type: 'color' },
  { path: 'component.button.border', cssName: '--button-border', type: 'color' },
  { path: 'component.button.radius', cssName: '--button-radius', type: 'dimension' },
  { path: 'component.icon-button.background', cssName: '--icon-button-bg', type: 'color' },
  { path: 'component.icon-button.foreground', cssName: '--icon-button-fg', type: 'color' },
  { path: 'component.icon-button.border', cssName: '--icon-button-border', type: 'color' },
  { path: 'component.field.background', cssName: '--field-bg', type: 'color' },
  { path: 'component.field.foreground', cssName: '--field-fg', type: 'color' },
  { path: 'component.field.border', cssName: '--field-border', type: 'color' },
  { path: 'component.panel.background', cssName: '--panel-bg', type: 'color' },
  { path: 'component.panel.foreground', cssName: '--panel-fg', type: 'color' },
  { path: 'component.panel.border', cssName: '--panel-border', type: 'color' },
  { path: 'component.card.background', cssName: '--card-bg', type: 'color' },
  { path: 'component.card.foreground', cssName: '--card-fg', type: 'color' },
  { path: 'component.card.border', cssName: '--card-border', type: 'color' },
  { path: 'component.navigation.background', cssName: '--navigation-bg', type: 'color' },
  { path: 'component.navigation.foreground', cssName: '--navigation-fg', type: 'color' },
  { path: 'component.navigation.border', cssName: '--navigation-border', type: 'color' },
  { path: 'component.sheet.background', cssName: '--sheet-bg', type: 'color' },
  { path: 'component.sheet.foreground', cssName: '--sheet-fg', type: 'color' },
  { path: 'component.sheet.border', cssName: '--sheet-border', type: 'color' },
  { path: 'component.dialog.background', cssName: '--dialog-bg', type: 'color' },
  { path: 'component.dialog.foreground', cssName: '--dialog-fg', type: 'color' },
  { path: 'component.dialog.border', cssName: '--dialog-border', type: 'color' },
  { path: 'component.toast.background', cssName: '--toast-bg', type: 'color' },
  { path: 'component.toast.foreground', cssName: '--toast-fg', type: 'color' },
  { path: 'component.toast.border', cssName: '--toast-border', type: 'color' },
  { path: 'component.focus.ring', cssName: '--focus-ring', type: 'color' },
  { path: 'component.focus.offset', cssName: '--focus-offset', type: 'dimension' },
  { path: 'component.control.min-target', cssName: '--control-min-target', type: 'dimension' }
] as const

export const CONTRACT_CSS_VARIABLES = new Set(APPEARANCE_TOKEN_CONTRACT.map((token) => token.cssName))

export const CONTRACT_TOKEN_BY_PATH = new Map(
  APPEARANCE_TOKEN_CONTRACT.map((token) => [token.path, token] as const)
)

export const CONTRACT_TOKEN_BY_CSS_NAME = new Map(
  APPEARANCE_TOKEN_CONTRACT.map((token) => [token.cssName, token] as const)
)
