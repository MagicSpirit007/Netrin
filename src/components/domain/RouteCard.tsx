import { Button } from '../core/Button'
import { PixelIcon, type PixelIconName } from '../icons/PixelIcon'

type RouteCardProps = {
  routeId?: string
  title: string
  description?: string
  photoUrl?: string
  distance?: string
  duration?: string
  pointCount?: number
  season?: string
  active?: boolean
  disableWhenActive?: boolean
  variant?: 'dark' | 'paper'
  chooseLabel: string
  selectedLabel: string
  chooseIcon?: PixelIconName
  selectedIcon?: PixelIconName
  openLabel?: string
  onOpen?: () => void
  onSelect?: () => void
}

/** Route summary card: title, description, stats and a choose action. */
export function RouteCard({
  routeId,
  title,
  description,
  photoUrl,
  distance,
  duration,
  pointCount,
  season,
  active = false,
  disableWhenActive = false,
  variant = 'dark',
  chooseLabel,
  selectedLabel,
  chooseIcon = 'chevron-right',
  selectedIcon = 'check',
  openLabel,
  onOpen,
  onSelect
}: RouteCardProps) {
  const cls = ['nroute', active ? 'nroute--active' : variant === 'paper' ? 'nroute--paper' : '']
    .filter(Boolean)
    .join(' ')
  const content = (
    <>
      <div className="nroute__top">
        {distance || duration || pointCount != null ? (
          <span className="nroute__meta">
            <PixelIcon name="clock" size={13} />
            {[distance, duration, pointCount != null ? `${pointCount}` : ''].filter(Boolean).join(' · ')}
          </span>
        ) : null}
      </div>
      <h3 className="nroute__title">{title}</h3>
      {photoUrl ? <img className="nroute__photo" src={photoUrl} alt="" /> : null}
      {description ? <p className="nroute__desc">{description}</p> : null}
    </>
  )
  return (
    <article
      className={cls}
      data-appearance-hook="route-card"
      data-appearance-variant={variant}
      data-route-id={routeId}
      data-selected={active ? 'true' : 'false'}
      data-openable={onOpen ? 'true' : 'false'}
      onClick={onOpen}
    >
      {onOpen ? (
        <button type="button" className="nroute__open" aria-label={openLabel ?? title}>
          {content}
        </button>
      ) : (
        <div className="nroute__open">{content}</div>
      )}
      <div className="nroute__foot">
        <span className="nroute__season">{season}</span>
        <Button
          variant={active ? 'dark' : variant === 'paper' ? 'paper' : 'solid'}
          size="sm"
          icon={active ? selectedIcon : chooseIcon}
          disabled={active && disableWhenActive}
          aria-pressed={onSelect ? active : undefined}
          onClick={(event) => {
            event.stopPropagation()
            onSelect?.()
          }}
        >
          {active ? selectedLabel : chooseLabel}
        </Button>
      </div>
    </article>
  )
}

export default RouteCard
