/** Style-neutral Interface Contract v2; shared with CLI and server audit. */
export {
  APPEARANCE_REVIEW_ROUTES,
  APPEARANCE_INTERFACE_CONTRACT_VERSION,
  REQUIRED_APPEARANCE_COMPONENTS,
  REQUIRED_APPEARANCE_SCREENS,
  STABLE_APPEARANCE_SLOTS
} from '../../appearance/contract'
export type { AppearanceComponentId, AppearanceScreenId, AppearanceSlotId } from '../../appearance/contract'
import type { AppearanceScreenId } from '../../appearance/contract'

export function appearanceScreenForPath(pathname: string): AppearanceScreenId {
  if (pathname === '/discover' || pathname === '/workshop') return 'route-catalog'
  if (pathname.startsWith('/route/')) return 'route-detail'
  if (pathname.startsWith('/guide/')) return 'map-navigation'
  if (pathname === '/create/ai') return 'ai-route-authoring'
  if (pathname === '/create' || pathname.startsWith('/create/')) return 'route-authoring'
  if (pathname === '/profile') return 'profile-community'
  if (pathname === '/appearance-studio') return 'appearance-studio'
  if (pathname === '/auth') return 'phone-auth'
  if (pathname === '/legal' || pathname.startsWith('/legal/')) return 'legal-document'
  if (pathname === '/admin') return 'admin-moderation'
  return 'map-navigation'
}
