export const APPEARANCE_INTERFACE_CONTRACT_VERSION = 2 as const
export const APPEARANCE_SUMMARY_MIN_LENGTH = 1 as const
export const APPEARANCE_SUMMARY_MAX_LENGTH = 240 as const

export const REQUIRED_APPEARANCE_SCREENS = [
  'map-navigation', 'route-catalog', 'route-detail', 'route-authoring', 'ai-route-authoring',
  'profile-community', 'appearance-studio', 'phone-auth', 'legal-document', 'admin-moderation'
] as const

export const REQUIRED_APPEARANCE_COMPONENTS = [
  'app-shell', 'top-bar', 'bottom-navigation', 'button', 'icon-button', 'text-field', 'switch',
  'route-card', 'route-point-card', 'media-gallery', 'map-frame', 'map-controls', 'recorder-panel',
  'route-plan-confirmation', 'navigation-instruction', 'sheet', 'dialog', 'toast', 'loading-state',
  'empty-state', 'error-state'
] as const

export const STABLE_APPEARANCE_SLOTS = [
  'brand-wordmark', 'brand-title', 'brand-name', 'brand-mark'
] as const

export type AppearanceScreenId = (typeof REQUIRED_APPEARANCE_SCREENS)[number]
export type AppearanceComponentId = (typeof REQUIRED_APPEARANCE_COMPONENTS)[number]
export type AppearanceSlotId = (typeof STABLE_APPEARANCE_SLOTS)[number]

export const APPEARANCE_REVIEW_ROUTES: Record<AppearanceScreenId, string> = {
  'map-navigation': '/',
  'route-catalog': '/discover',
  'route-detail': '/route/00000000-0000-0000-0000-000000000000',
  'route-authoring': '/create',
  'ai-route-authoring': '/create/ai',
  'profile-community': '/profile',
  'appearance-studio': '/appearance-studio',
  'phone-auth': '/auth',
  'legal-document': '/legal',
  'admin-moderation': '/admin'
}
