import { NavLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { tabItems } from '../../manifest'
import { pathForTab } from '../../routes'
import { useNetrinState } from '../../state/NetrinState'
import { PixelIcon, type PixelIconName } from '../icons/PixelIcon'

// Black bottom tab bar with pixel icons and a (monochrome) active dot — Minna-style.
// Generated from manifest.navigation.items (Cell Contract Rule 2).
const tabIcons: Record<string, PixelIconName> = {
  home: 'gps',
  discover: 'directions',
  create: 'plus',
  profile: 'user'
}

export function BottomNav() {
  const { t } = useTranslation()
  const { navigationActive } = useNetrinState()

  if (navigationActive) return null

  return (
    <nav
      className="nnav"
      aria-label="primary"
      data-appearance-hook="bottom-navigation"
      style={{ gridTemplateColumns: `repeat(${tabItems.length}, 1fr)` }}
    >
      {tabItems.map((id) => (
        <NavLink
          key={id}
          to={pathForTab(id)}
          end={id === 'home'}
          className={({ isActive }) => 'nnav__item' + (isActive ? ' nnav__item--active' : '')}
        >
          {({ isActive }) => (
            <>
              <PixelIcon name={tabIcons[id] ?? 'leaf'} size={24} />
              <span className="nnav__label">{t(`tabs.${id}`)}</span>
              {isActive ? <span className="nnav__dot" /> : null}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  )
}

export default BottomNav
