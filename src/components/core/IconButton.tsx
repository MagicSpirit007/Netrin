import type { ButtonHTMLAttributes } from 'react'
import { PixelIcon, type PixelIconName } from '../icons/PixelIcon'

type IconButtonProps = {
  icon: PixelIconName
  label: string
  variant?: 'solid' | 'dark' | 'paper' | 'ghost'
  size?: 'sm' | 'md' | 'lg'
} & ButtonHTMLAttributes<HTMLButtonElement>

/** Square pixel icon-button. */
export function IconButton({
  icon,
  label,
  variant = 'dark',
  size = 'md',
  type = 'button',
  className = '',
  ...rest
}: IconButtonProps) {
  const cls = [
    'nib',
    `nib--${variant}`,
    size === 'sm' ? 'nib--sm' : size === 'lg' ? 'nib--lg' : '',
    className
  ]
    .filter(Boolean)
    .join(' ')
  const isz = size === 'sm' ? 18 : size === 'lg' ? 26 : 22
  return (
    <button type={type} className={cls} aria-label={label} data-appearance-hook="icon-button" data-appearance-variant={variant} {...rest}>
      <PixelIcon name={icon} size={isz} />
    </button>
  )
}

export default IconButton
