import type { CSSProperties, ReactNode } from 'react'

type PanelProps = {
  children: ReactNode
  variant?: 'dark' | 'panel' | 'paper'
  shadow?: boolean
  dots?: boolean
  padding?: string
  className?: string
  style?: CSSProperties
}

/** Base surface container — dark card, deep panel, or paper field-card. */
export function Panel({
  children,
  variant = 'dark',
  shadow = false,
  dots = false,
  padding = 'var(--space-4)',
  className = '',
  style
}: PanelProps) {
  const cls = ['npanel', `npanel--${variant}`, shadow ? 'npanel--shadow' : '', dots ? 'npanel--dots' : '', className]
    .filter(Boolean)
    .join(' ')
  return (
    <div className={cls} style={{ padding, ...style }} data-appearance-slot="panel" data-appearance-variant={variant}>
      {children}
    </div>
  )
}

export default Panel
