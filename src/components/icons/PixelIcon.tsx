// Netrin pixel icon set — 24x24 grid, built from rectangular pixels.
// Self-contained: each entry is the inner SVG markup for that glyph, so the
// component needs no file paths and inherits color via `currentColor`.
// Source: the Claude Design handoff glyph set, embedded inline from
// components/core/PixelIcon.jsx.
const ICONS = {
  'arrow-up':
    '<path d="M11 3h2v19h-2zM9 5h2v2H9zM7 7h2v2H7zM5 9h2v2H5zm8-4h2v2h-2zm2 2h2v2h-2zm2 2h2v2h-2zM9 3h6v2H9z"></path>',
  'arrow-left':
    '<path d="M20 11v2H4v-2zM8 13v2H6v-2zm2 2v2H8v-2zm2 2v2h-2v-2zm-4-6V9H6v2z"></path><path d="M10 15V7H8v8zm2 2V5h-2v12z"></path>',
  'arrow-right':
    '<path d="M4 11v2h16v-2zm12 2v2h2v-2zm-2 2v2h2v-2zm-2 2v2h2v-2zm4-6V9h2v2z"></path><path d="M14 15V7h2v8zm-2 2V5h2v12z"></path>',
  'turn-left':
    '<path d="M5 8h11v2H5zM3 10h2v2H3zm2 2h2v2H5zm2 2h2v2H7zm9-4h2v12h-2zM5 6h2v2H5zm2-2h2v2H7z"></path>',
  'turn-right':
    '<path d="M8 8h11v2H8zm11 2h2v2h-2zm-2 2h2v2h-2zm-2 2h2v2h-2zM6 10h2v12H6zm11-4h2v2h-2zm-2-2h2v2h-2z"></path>',
  'book-open':
    '<path d="M2 3h9v2H2zM0 19h11v2H0zM13 3h9v2h-9zm0 16h11v2H13zM11 5h2v18h-2zM0 5h2v14H0zm22 0h2v14h-2zm-7 2h5v2h-5zm0 4h5v2h-5zm0 4h2v2h-2z"></path>',
  calendar:
    '<path d="M5 4h14v2H5zm0 16h14v2H5zM3 10h2v10H3zm0-4h2v2H3zm16 0h2v2h-2zm0 4h2v10h-2zM3 8h18v2H3zm12-6h2v2h-2zM7 2h2v2H7z"></path>',
  camera:
    '<path d="M4 5h4v2H4zm4-2h8v2H8zm8 2h4v2h-4zM2 7h2v12H2zm2 12h16v2H4zM20 7h2v12h-2zM10 8h4v2h-4zm0 6h4v2h-4zm-2-4h2v4H8zm6 0h2v4h-2z"></path>',
  check:
    '<path d="M10 18H8v-2h2v2Zm-2-2H6v-2h2v2Zm4-2v2h-2v-2h2Zm-6 0H4v-2h2v2Zm8 0h-2v-2h2v2Zm2-2h-2v-2h2v2Zm2-2h-2V8h2v2Zm2-2h-2V6h2v2Z"></path>',
  'checkbox-on':
    '<path d="M4 2h16v2H4zm0 18h16v2H4zM2 4h2v16H2zm18 0h2v16h-2zM7 12h2v2H7zm2 2h2v2H9zm2-2h2v2h-2zm2-2h2v2h-2zm2-2h2v2h-2z"></path>',
  'chevron-down':
    '<path d="M13 16h-2v-2h2v2Zm-2-2H9v-2h2v2Zm4 0h-2v-2h2v2Zm-6-2H7v-2h2v2Zm8 0h-2v-2h2v2ZM7 10H5V8h2v2Zm12 0h-2V8h2v2Z"></path>',
  'chevron-left':
    '<path d="M8 13v-2h2v2H8Zm2-2V9h2v2h-2Zm0 4v-2h2v2h-2Zm2-6V7h2v2h-2Zm0 8v-2h2v2h-2Zm2-10V5h2v2h-2Zm0 12v-2h2v2h-2Z"></path>',
  'chevron-right':
    '<path d="M16 13v-2h-2v2h2Zm-2-2V9h-2v2h2Zm0 4v-2h-2v2h2Zm-2-6V7h-2v2h2Zm0 8v-2h-2v2h2ZM10 7V5H8v2h2Zm0 12v-2H8v2h2Z"></path>',
  'chevron-up':
    '<path d="M13 8h-2v2h2V8Zm-2 2H9v2h2v-2Zm4 0h-2v2h2v-2Zm-6 2H7v2h2v-2Zm8 0h-2v2h2v-2ZM7 14H5v2h2v-2Zm12 0h-2v2h2v-2Z"></path>',
  clock:
    '<path d="M6 2h12v2H6zM2 6h2v12H2zm18 0h2v12h-2zm-2-2h2v2h-2zM4 4h2v2H4zm2 18h12v-2H6zm12-2h2v-2h-2zM4 20h2v-2H4zm7-14h2v7h-2zm2 7h2v2h-2zm2 2h2v2h-2z"></path>',
  close:
    '<path d="M7 19H5V17H7V19ZM19 19H17V17H19V19ZM9 15V17H7V15H9ZM17 17H15V15H17V17ZM11 15H9V13H11V15ZM15 15H13V13H15V15ZM13 13H11V11H13V13ZM11 11H9V9H11V11ZM15 11H13V9H15V11ZM9 9H7V7H9V9ZM17 9H15V7H17V9ZM7 7H5V5H7V7ZM19 7H17V5H19V7Z"></path>',
  cloud:
    '<path d="M22 10h-4v2h4v-2Zm2 2h-2v6h2v-6Zm-2 6H2v2h20v-2ZM2 12H0v6h2v-6Zm2-2H2v2h2v-2Zm4-2H4v2h4V8Zm8-4h-6v2h6V4Zm-6 2H8v2h2V6Zm0 4H8v2h2v-2Zm8-4h-2v2h2V6Z"></path><path d="M20 8h-2v4h2V8Zm-2 4h-2v2h2v-2Z"></path>',
  compass:
    '<path d="M9 1h6v2H9zm0 20h6v2H9zM5 3h4v2H5zm10 0h4v2h-4zM3 5h2v4H3zm16 0h2v4h-2zM1 9h2v6H1zm20 0h2v6h-2zM3 15h2v4H3zm16 0h2v4h-2zM5 19h4v2H5zm10 0h4v2h-4zM11 5h2v3h-2zm-2 3h2v4H9zm4 4h2v4h-2zm-2 4h2v3h-2z"></path>',
  delete:
    '<path d="M6 7h2v2H6zm14 0h2v10h-2zM8 5h12v2H8zM4 9h2v2H4zm-2 2h2v2H2zm2 2h2v2H4zm2 2h2v2H6zm2 2h12v2H8zm6-6h2v2h-2zm2 2h2v2h-2zm0-4h2v2h-2zm-4 4h2v2h-2zm0-4h2v2h-2z"></path>',
  directions:
    '<path d="M2 2h2v2H2zm2 2h2v2H4zm2-2h2v2H6zM2 6h2v2H2zm4 0h2v2H6zm11 9h3v2h-3zm-2 2h2v3h-2zm2 3h3v2h-3zm3-3h2v3h-2zM15 2h2v10h-2zm-2 2h2v2h-2z"></path><path d="M11 6h9v2h-9z"></path><path d="M19 6h2v2h-2zm-2-2h2v2h-2zM6 12h9v2H6zm-2 2h2v4H4zm0 6h2v2H4z"></path>',
  download:
    '<path d="M21 15v4h-2v-4zm-2 4v2H5v-2zM5 15v4H3v-4zm8-12v14h-2V3z"></path><path d="M7 11v2h10v-2zm2 2v2h2v-2zm4 0v2h2v-2z"></path><path d="M15 11v2h2v-2z"></path>',
  'external-link':
    '<path d="M11 5H5v2h6V5ZM5 7H3v12h2V7Zm12 12H5v2h12v-2Zm2-6h-2v6h2v-6Zm-8 0H9v2h2v-2Zm2-2h-2v2h2v-2Zm2-2h-2v2h2V9Zm2-2h-2v2h2V7Zm2-2h-2v2h2V5Zm2-2h-2v8h2V3Z"></path><path d="M21 3h-8v2h8V3Z"></path>',
  eye: '<path d="M16 20H8v-2h8v2Zm-8-2H4v-2h4v2Zm12 0h-4v-2h4v2ZM4 16H2v-2h2v2Zm10-6h-2v2h2v-2h2v4h-2v2h-4v-2H8v-4h2V8h4v2Zm8 6h-2v-2h2v2ZM2 14H0v-4h2v4Zm22 0h-2v-4h2v4ZM4 10H2V8h2v2Zm18 0h-2V8h2v2ZM8 8H4V6h4v2Zm12 0h-4V6h4v2Zm-4-2H8V4h8v2Z"></path>',
  feather:
    '<path d="M2 20h2v2H2zm6-2h6v2H8zm-2-2h2v2H6zm-2 2h2v2H4zm4-4h2v2H8zm2-2h2v2h-2zm2-2h2v2h-2zm2-2h2v2h-2zm0 8h2v2h-2zm2-2h2v2h-2zm2-2h2v2h-2zm2-6h2v6h-2zm-2-2h2v2h-2zM4 10h2v6H4zm2-2h2v2H6zm2-2h2v2H8zm2-2h2v2h-2zm2-2h6v2h-6z"></path>',
  filter:
    '<path d="M11 20H13V22H9V12H11V20ZM15 20H13V12H15V20ZM9 12H7V10H9V12ZM17 12H15V10H17V12ZM7 10H5V8H7V10ZM19 10H17V8H19V10ZM21 8H19V4H5V8H3V2H21V8Z"></path>',
  fish: '<path d="M20 9h2v6h-2zm-2-2h2v2h-2zm0 8h2v2h-2zm-6 2h6v2h-6zm0-12h6v2h-6zM2 7h2v10H2zm2 2h2v2H4zm0 4h2v2H4zm2-2h2v2H6zm2-2h2v2H8zm0 4h2v2H8zm2 2h2v2h-2zm0-8h2v2h-2zm5 3h2v2h-2z"></path>',
  flag: '<path d="M4 2h2v20H4z"></path><path d="M4 4h16v2H4zm12 2h2v2h-2zm-2 2h2v2h-2zm2 2h2v2h-2zM4 12h16v2H4z"></path>',
  globe:
    '<path d="M6 2h12v2H6zm0 18h12v2H6zM4 4h2v2H4zm5 0h2v2H9zm0 14h2v2H9zm4 0h2v2h-2zM7 6h2v12H7zm8 0h2v12h-2zm-2-2h2v2h-2zm7 0h-2v2h2zM2 6h2v12H2zm20 0h-2v12h2zM4 18h2v2H4zm16 0h-2v2h2z"></path><path d="M3 11h18v2H3z"></path>',
  gps: '<path d="M9 5h6v2H9zM7 7h2v2H7zm0 8h2v2H7zm8 0h2v2h-2zm0-8h2v2h-2zm2 2h2v6h-2zm-8 8h6v2H9zM5 9h2v6H5zm14 2h4v2h-4zM1 11h4v2H1zM11 1h2v4h-2zm0 18h2v4h-2z"></path>',
  home: '<path d="M4 20h16v2H4zm16-10h2v10h-2zM2 10h2v10H2zm2-2h2v2H4zm2-2h2v2H6zm2-2h2v2H8zm2-2h4v2h-4zm4 2h2v2h-2zm2 2h2v2h-2zm2 2h2v2h-2zM8 14h2v6H8zm2-2h4v2h-4zm4 2h2v6h-2z"></path>',
  image:
    '<path d="M4 2h16v2H4zm0 18h16v2H4zM2 4h2v16H2zm18 0h2v16h-2zm-4 8h2v2h-2zm-2 2h2v2h-2zm4 0h2v2h-2zm-8 0h2v2h-2zm2 2h2v2h-2zm2 2h2v2h-2z"></path><path d="M20 16h2v2h-2zM8 16h2v2H8zm-2 2h2v2H6zM8 6h2v2H8zM6 8h2v2H6zm2 2h2v2H8zm2-2h2v2h-2z"></path>',
  'info-box': '<path d="M4 2h16v2H4zm0 18h16v2H4zM2 4h2v16H2zm18 0h2v16h-2zm-9 5h2V7h-2zm0 8h2v-6h-2z"></path>',
  languages:
    '<path d="M7 2h4v2H7zM2 5h14v2H2zm9 2h2v2h-2zM9 9h2v2H9zm-2 2h2v2H7zM5 9h2v2H5zm4 4h2v2H9zm-4 0h2v2H5zm8 2h2v7h-2zm2-2h5v2h-5zm5 2h2v7h-2zm-5 2h5v2h-5z"></path>',
  leaf: '<path d="M1 18h2v4H1zm2-2h2v2H3zm2-2h6v2H5zm6-2h2v2h-2zm-6 6h4v2H5zm4 2h4v2H9zm4-2h4v2h-4zm4-2h2v2h-2zm2-8h2v8h-2zm0-4h2v4h-2zm-2-2h2v2h-2zm-4 2h4v2h-4zM7 6h6v2H7zM5 8h2v2H5zm-2 2h2v4H3z"></path>',
  lock: '<path d="M5 8h14v2H5zm0 12h14v2H5zM3 10h2v10H3zm16 0h2v10h-2zM7 4h2v4H7zm2-2h6v2H9zm6 2h2v4h-2z"></path>',
  login:
    '<path d="M2 11h14v2H2zm10-2h2v2h-2z"></path><path d="M10 7h2v10h-2zm2 6h2v2h-2zM6 2h12v2H6zm0 18h12v2H6zM4 4h2v5H4zm0 11h2v5H4zM18 4h2v16h-2z"></path>',
  logout:
    '<path d="M8 11h12v2H8zm8-2h2v2h-2z"></path><path d="M14 7h2v10h-2zm2 6h2v2h-2zM6 2h12v2H6zm0 18h12v2H6zM4 4h2v16H4zm14 0h2v3h-2zm0 13h2v3h-2z"></path>',
  minus: '<path d="M4 11h16v2H4z"></path>',
  moon: '<path d="M18 22H8v-2h10v2ZM8 20H6v-2h2v2Zm12 0h-2v-2h2v2ZM6 18H4v-2h2v2Zm16 0h-2v-4h-2v-2h2v-2h2v8ZM4 16H2V6h2v10Zm14 0h-6v-2h6v2Zm-6-2h-2v-2h2v2Zm-2-2H8V6h2v6ZM6 6H4V4h2v2Zm8-2h-2v2h-2V4H6V2h8v2Z"></path>',
  'more-vertical':
    '<path d="M15 3v2h-2V3zm0 8v2h-2v-2zm0 8v2h-2v-2zM13 1v2h-2V1zm0 8v2h-2V9zm0 8v2h-2v-2zM11 3v2H9V3zm0 8v2H9v-2zm0 8v2H9v-2zm2-14v2h-2V5zm0 8v2h-2v-2zm0 8v2h-2v-2z"></path>',
  play: '<path d="M15 11h-2V9h2zm0 4h-2v-2h2zm-2 2h-2v-2h2zm0-8h-2V7h2zm-2-2H9V5h2zM9 21H7V3h2zm6-8h2v-2h-2zm-6 4h2v2H9z"></path>',
  plus: '<path d="M13 11h7v2h-7v7h-2v-7H4v-2h7V4h2v7Z"></path>',
  reload:
    '<path d="M16 4h2v6h-2zm-2-2h2v2h-2zm0 2h2v8h-2zM4 8H2v5h2z"></path><path d="M4 6h16v2H4zm4 14H6v-6h2zm2 2H8v-2h2zm0-2H8v-8h2zm10-4h2v-5h-2z"></path><path d="M20 18H4v-2h16z"></path>',
  search:
    '<path d="M22 22h-2v-2h2v2Zm-2-2h-2v-2h2v2Zm-6-2H6v-2h8v2Zm4 0h-2v-2h2v2ZM6 16H4v-2h2v2Zm10 0h-2v-2h2v2ZM4 14H2V6h2v8Zm14 0h-2V6h2v8ZM6 6H4V4h2v2Zm10 0h-2V4h2v2Zm-2-2H6V2h8v2Z"></path>',
  send: '<path d="M4 19h4v2H2v-8h2v6Zm8 0H8v-2h4v2Zm4-2h-4v-2h4v2Zm4-2h-4v-2h4v2Zm-10-2H4v-2h6v2Zm12 0h-2v-2h2v2ZM8 5H4v6H2V3h6v2Zm12 6h-4V9h4v2Zm-4-2h-4V7h4v2Zm-4-2H8V5h4v2Z"></path>',
  share:
    '<path d="M20 22H4V20H20V22ZM4 20H2V14H4V20ZM22 20H20V14H22V20ZM13 4H15V6H17V8H13V18H11V8H7V6H9V4H11V2H13V4ZM9 14H4V12H9V14ZM20 14H15V12H20V14Z"></path>',
  star: '<path d="M5 20H8V22H3V16H5V20ZM21 22H16V20H19V16H21V22ZM10 20H8V18H10V20ZM16 20H14V18H16V20ZM14 18H10V16H14V18ZM7 16H5V13H7V16ZM19 16H17V13H19V16ZM5 13H3V11H5V13ZM21 13H19V11H21V13ZM9 9H3V11H1V7H9V9ZM23 11H21V9H15V7H23V11ZM11 7H9V3H11V7ZM15 7H13V3H15V7ZM13 3H11V1H13V3Z"></path>',
  tree: '<path d="M6 4h2v2H6zm2-2h8v2H8zm10 4h2v4h-2zm2 4h2v6h-2zm-2 6h2v2h-2zM4 16h2v2H4zm-2-6h2v6H2zm4 8h12v2H6zM4 6h2v4H4z"></path><path d="M11 18h2v4h-2zm5-14h2v2h-2z"></path>',
  user: '<path d="M9 2h6v2H9zm0 8h6v2H9zm6-6h2v6h-2zM7 4h2v6H7zM4 18h2v4H4zm14 0h2v4h-2zM8 14h8v2H8zm-2 2h2v2H6zm10 0h2v2h-2z"></path>',
  'volume-2':
    '<path d="M13 22h-2v-2H9v-2h2V6H9V4h2V2h2v20Zm-4-4H7v-2h2v2Zm10 0h-4v-2h4v2ZM7 10H5v4h2v2H3V8h4v2Zm14 6h-2V8h2v8Zm-4-2h-2v-4h2v4ZM9 8H7V6h2v2Zm10 0h-4V6h4v2Z"></path>',
  zap: '<path d="M4 13h8v6h2v2h-2v2h-2v-8H2v-4h2v2Zm12 6h-2v-2h2v2Zm2-2h-2v-2h2v2Zm2-2h-2v-2h2v2Zm-6-6h8v4h-2v-2h-8V5h-2V3h2V1h2v8Zm-8 2H4V9h2v2Zm2-2H6V7h2v2Zm2-2H8V5h2v2Z"></path>'
} as const

export type PixelIconName = keyof typeof ICONS

export const pixelIconNames = Object.keys(ICONS) as PixelIconName[]

type PixelIconProps = {
  name: PixelIconName
  size?: number
  color?: string
  label?: string
  className?: string
  style?: React.CSSProperties
}

/**
 * PixelIcon — renders one of Netrin's pixel glyphs as an inline SVG.
 * Inherits color via `currentColor`; size is square (px).
 */
export function PixelIcon({ name, size = 24, color, label, className = '', style }: PixelIconProps) {
  const markup = ICONS[name] ?? ICONS.leaf
  const aria = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true }
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      className={`n-pixel-icon ${className}`.trim()}
      style={{ color: color || 'currentColor', ...style }}
      shapeRendering="crispEdges"
      {...aria}
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  )
}

export default PixelIcon
