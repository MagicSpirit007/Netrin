import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { PixelIcon, type PixelIconName } from '../icons/PixelIcon'

type ButtonProps = {
  children?: ReactNode
  variant?: 'solid' | 'dark' | 'paper' | 'ghost'
  size?: 'sm' | 'md' | 'lg'
  icon?: PixelIconName
  iconRight?: PixelIconName
  block?: boolean
} & ButtonHTMLAttributes<HTMLButtonElement>

/** Primary pixel button with hard-offset shadow + press nudge. */
export function Button({
  children,
  variant = 'solid',
  size = 'md',
  icon,
  iconRight,
  block = false,
  type = 'button',
  className = '',
  ...rest
}: ButtonProps) {
  const cls = [
    'nbtn',
    `nbtn--${variant}`,
    size === 'sm' ? 'nbtn--sm' : size === 'lg' ? 'nbtn--lg' : '',
    block ? 'nbtn--block' : '',
    className
  ]
    .filter(Boolean)
    .join(' ')
  const isz = size === 'sm' ? 16 : size === 'lg' ? 22 : 18
  return (
    <button
      type={type}
      className={cls}
      data-appearance-hook={children == null ? 'icon-button' : 'button'}
      data-appearance-variant={variant}
      {...rest}
    >
      {icon ? <PixelIcon name={icon} size={isz} /> : null}
      {children != null ? <span>{children}</span> : null}
      {iconRight ? <PixelIcon name={iconRight} size={isz} /> : null}
    </button>
  )
}

export default Button
