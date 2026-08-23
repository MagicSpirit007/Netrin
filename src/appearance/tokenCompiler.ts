import { APPEARANCE_TOKEN_CONTRACT } from './tokenContract.ts'
import type {
  AppearanceDiagnostic,
  AppearanceTokenLeaf,
  AppearanceTokenType,
  AppearanceTokensDocument
} from './types.ts'

const TOKEN_SEGMENT = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const REFERENCE = /^\{([a-z0-9.-]+)\}$/
const UNSAFE_VALUE = /(?:url\s*\(|javascript\s*:|expression\s*\(|@import|<script)/i

type FlatToken = AppearanceTokenLeaf & { path: string }

export type TokenCompilationResult = {
  valid: boolean
  document?: AppearanceTokensDocument
  compiledTokens: Record<string, string>
  resolvedByPath: Record<string, string>
  diagnostics: AppearanceDiagnostic[]
  checks: {
    references: boolean
    types: boolean
    contrast: boolean
    touchTargets: boolean
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isTokenLeaf(value: unknown): value is AppearanceTokenLeaf {
  return isRecord(value) && typeof value.$type === 'string' && '$value' in value
}

function diagnostic(code: string, message: string, tokenPath?: string): AppearanceDiagnostic {
  return { severity: 'error', code, message, file: 'tokens.json', tokenPath }
}

function flattenTokens(
  value: Record<string, unknown>,
  prefix: string,
  output: Map<string, FlatToken>,
  diagnostics: AppearanceDiagnostic[]
): void {
  for (const [key, child] of Object.entries(value)) {
    if (key.startsWith('$')) continue
    const path = prefix ? `${prefix}.${key}` : key
    if (!TOKEN_SEGMENT.test(key)) {
      diagnostics.push(diagnostic('token-name', `Token segment "${key}" must be kebab-case.`, path))
      continue
    }
    if (isTokenLeaf(child)) {
      output.set(path, { ...child, path })
    } else if (isRecord(child)) {
      flattenTokens(child, path, output, diagnostics)
    } else {
      diagnostics.push(diagnostic('token-shape', 'Token nodes must be groups or DTCG token leaves.', path))
    }
  }
}

function validLiteral(type: AppearanceTokenType, value: string | number): boolean {
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value)
  if (type === 'fontWeight') return (
    (typeof value === 'number' && Number.isFinite(value) && value >= 1 && value <= 1000) ||
    (typeof value === 'string' && /^(?:normal|bold|[1-9]00)$/i.test(value.trim()))
  )
  if (typeof value !== 'string' || !value.trim() || UNSAFE_VALUE.test(value)) return false
  if (type === 'color') {
    return /^(?:#[0-9a-f]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\)|transparent)$/i.test(value.trim())
  }
  if (type === 'dimension') return /^-?\d+(?:\.\d+)?(?:px|rem|em)$/i.test(value.trim())
  if (type === 'duration') return /^\d+(?:\.\d+)?(?:ms|s)$/i.test(value.trim())
  return true
}

function hexToRgb(value: string): [number, number, number] | undefined {
  const hex = value.trim().match(/^#([0-9a-f]{6})$/i)?.[1]
  if (!hex) return undefined
  return [Number.parseInt(hex.slice(0, 2), 16), Number.parseInt(hex.slice(2, 4), 16), Number.parseInt(hex.slice(4, 6), 16)]
}

function luminance([red, green, blue]: [number, number, number]): number {
  const channels = [red, green, blue].map((channel) => {
    const normalized = channel / 255
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}

function contrastRatio(foreground: string, background: string): number | undefined {
  const foregroundRgb = hexToRgb(foreground)
  const backgroundRgb = hexToRgb(background)
  if (!foregroundRgb || !backgroundRgb) return undefined
  const left = luminance(foregroundRgb)
  const right = luminance(backgroundRgb)
  return (Math.max(left, right) + 0.05) / (Math.min(left, right) + 0.05)
}

export function compileAppearanceTokens(value: unknown): TokenCompilationResult {
  const diagnostics: AppearanceDiagnostic[] = []
  const compiledTokens: Record<string, string> = {}
  const resolvedByPath: Record<string, string> = {}
  if (!isRecord(value) || !isRecord(value.primitive) || !isRecord(value.semantic) || !isRecord(value.component)) {
    diagnostics.push(diagnostic('token-document', 'tokens.json must contain primitive, semantic and component objects.'))
    return {
      valid: false,
      compiledTokens,
      resolvedByPath,
      diagnostics,
      checks: { references: false, types: false, contrast: false, touchTargets: false }
    }
  }

  const document = value as AppearanceTokensDocument
  const flat = new Map<string, FlatToken>()
  flattenTokens(value.primitive, 'primitive', flat, diagnostics)
  flattenTokens(value.semantic, 'semantic', flat, diagnostics)
  flattenTokens(value.component, 'component', flat, diagnostics)

  let references = true
  let types = true
  const visitState = new Map<string, 'visiting' | 'visited'>()
  const reportedCycles = new Set<string>()
  const visitReferenceGraph = (path: string): void => {
    if (visitState.get(path) === 'visited') return
    if (visitState.get(path) === 'visiting') {
      references = false
      if (!reportedCycles.has(path)) {
        reportedCycles.add(path)
        diagnostics.push(diagnostic('token-cycle', `Token reference cycle contains "${path}".`, path))
      }
      return
    }
    visitState.set(path, 'visiting')
    const token = flat.get(path)
    const reference = typeof token?.$value === 'string' ? token.$value.match(REFERENCE)?.[1] : undefined
    if (reference && flat.has(reference)) visitReferenceGraph(reference)
    visitState.set(path, 'visited')
  }
  flat.forEach((_token, path) => visitReferenceGraph(path))
  const resolving = new Set<string>()

  const resolve = (path: string): string | undefined => {
    if (resolvedByPath[path] !== undefined) return resolvedByPath[path]
    const token = flat.get(path)
    if (!token) {
      references = false
      diagnostics.push(diagnostic('token-reference', `Token reference "${path}" does not exist.`, path))
      return undefined
    }
    if (resolving.has(path)) {
      references = false
      diagnostics.push(diagnostic('token-cycle', `Token reference cycle contains "${path}".`, path))
      return undefined
    }
    resolving.add(path)
    const reference = typeof token.$value === 'string' ? token.$value.match(REFERENCE)?.[1] : undefined
    let resolved: string | undefined
    if (path.startsWith('primitive.')) {
      if (reference) {
        references = false
        diagnostics.push(diagnostic('token-layer', 'Primitive tokens must contain literal values.', path))
      } else if (!validLiteral(token.$type, token.$value)) {
        types = false
        diagnostics.push(diagnostic('token-type', `Invalid ${token.$type} literal.`, path))
      } else {
        resolved = String(token.$value)
      }
    } else {
      const requiredPrefix = path.startsWith('semantic.') ? 'primitive.' : 'semantic.'
      if (!reference || !reference.startsWith(requiredPrefix)) {
        references = false
        diagnostics.push(diagnostic('token-layer', `${path.split('.')[0]} tokens must reference ${requiredPrefix.slice(0, -1)} tokens.`, path))
      } else {
        const target = flat.get(reference)
        if (target && target.$type !== token.$type) {
          types = false
          diagnostics.push(diagnostic('token-type', `Reference type ${target.$type} does not match ${token.$type}.`, path))
        } else {
          resolved = resolve(reference)
        }
      }
    }
    resolving.delete(path)
    if (resolved !== undefined) resolvedByPath[path] = resolved
    return resolved
  }

  for (const token of flat.values()) resolve(token.path)

  for (const contract of APPEARANCE_TOKEN_CONTRACT) {
    const token = flat.get(contract.path)
    if (!token) {
      types = false
      diagnostics.push(diagnostic('token-required', `Required token "${contract.path}" is missing.`, contract.path))
      continue
    }
    if (token.$type !== contract.type) {
      types = false
      diagnostics.push(diagnostic('token-type', `Required token must use type ${contract.type}.`, contract.path))
      continue
    }
    const resolved = resolve(contract.path)
    if (resolved !== undefined) compiledTokens[contract.cssName] = resolved
  }

  for (const [path, resolved] of Object.entries(resolvedByPath)) {
    if (!path.startsWith('primitive.')) continue
    compiledTokens[`--primitive-${path.slice('primitive.'.length).replaceAll('.', '-')}`] = resolved
  }

  let touchTargets = true
  const minTarget = resolvedByPath['component.control.min-target']
  const minTargetPixels = minTarget?.match(/^(\d+(?:\.\d+)?)px$/i)
  if (!minTargetPixels || Number(minTargetPixels[1]) < 44) {
    touchTargets = false
    diagnostics.push(diagnostic('touch-target', 'component.control.min-target must resolve to at least 44px.', 'component.control.min-target'))
  }

  let contrast = true
  const contrastPairs: Array<[string, string]> = [
    ['semantic.foreground.default', 'semantic.surface.app'],
    ['semantic.foreground.default', 'semantic.surface.panel'],
    ['semantic.foreground.paper', 'semantic.surface.paper'],
    ['semantic.foreground.on-signal', 'semantic.signal.success'],
    ['semantic.foreground.on-signal', 'semantic.signal.warning'],
    ['semantic.foreground.on-signal', 'semantic.signal.info'],
    ['semantic.foreground.on-signal', 'semantic.signal.danger']
  ]
  for (const [foregroundPath, backgroundPath] of contrastPairs) {
    const ratio = contrastRatio(resolvedByPath[foregroundPath] ?? '', resolvedByPath[backgroundPath] ?? '')
    if (ratio !== undefined && ratio < 4.5) {
      contrast = false
      diagnostics.push(diagnostic('contrast', `${foregroundPath} and ${backgroundPath} have contrast ${ratio.toFixed(2)}:1; 4.5:1 is required.`, foregroundPath))
    }
  }

  return {
    valid: !diagnostics.some((entry) => entry.severity === 'error'),
    document,
    compiledTokens,
    resolvedByPath,
    diagnostics,
    checks: { references, types, contrast, touchTargets }
  }
}

export function createDefaultTokenDocument(): AppearanceTokensDocument {
  const primitive = {
    color: {
      'ink-900': { $type: 'color', $value: '#0b0c0e' },
      'ink-800': { $type: 'color', $value: '#141619' },
      'ink-700': { $type: 'color', $value: '#1b1e22' },
      paper: { $type: 'color', $value: '#101214' },
      black: { $type: 'color', $value: '#000000' },
      white: { $type: 'color', $value: '#f4f5f2' },
      grey: { $type: 'color', $value: '#c7cac4' },
      green: { $type: 'color', $value: '#9cff6f' },
      amber: { $type: 'color', $value: '#ffd166' }
    },
    dimension: {
      'radius-xs': { $type: 'dimension', $value: '2px' },
      'radius-sm': { $type: 'dimension', $value: '4px' },
      'radius-md': { $type: 'dimension', $value: '6px' },
      'radius-lg': { $type: 'dimension', $value: '8px' },
      'focus-offset': { $type: 'dimension', $value: '3px' },
      'touch-target': { $type: 'dimension', $value: '44px' }
    },
    duration: {
      fast: { $type: 'duration', $value: '120ms' },
      normal: { $type: 'duration', $value: '200ms' }
    },
    font: {
      sans: { $type: 'fontFamily', $value: 'Space Grotesk, ui-sans-serif, system-ui, sans-serif' },
      mono: { $type: 'fontFamily', $value: 'Space Grotesk, ui-monospace, monospace' },
      display: { $type: 'fontFamily', $value: 'Space Grotesk, ui-sans-serif, system-ui, sans-serif' }
    },
    shadow: { hard: { $type: 'shadow', $value: '4px 4px 0 #000000' } }
  }
  const ref = ($type: AppearanceTokenType, $value: string): AppearanceTokenLeaf => ({ $type, $value })
  const semantic = {
    surface: {
      app: ref('color', '{primitive.color.ink-900}'), panel: ref('color', '{primitive.color.ink-800}'),
      card: ref('color', '{primitive.color.ink-700}'), paper: ref('color', '{primitive.color.paper}'), nav: ref('color', '{primitive.color.black}')
    },
    foreground: {
      default: ref('color', '{primitive.color.white}'), muted: ref('color', '{primitive.color.grey}'),
      paper: ref('color', '{primitive.color.white}'), 'paper-muted': ref('color', '{primitive.color.grey}'),
      'on-signal': ref('color', '{primitive.color.ink-900}')
    },
    border: {
      default: ref('color', '{primitive.color.white}'), soft: ref('color', '{primitive.color.grey}'),
      hairline: ref('color', '{primitive.color.grey}'), strong: ref('color', '{primitive.color.white}')
    },
    signal: {
      success: ref('color', '{primitive.color.white}'), warning: ref('color', '{primitive.color.grey}'),
      info: ref('color', '{primitive.color.grey}'), danger: ref('color', '{primitive.color.white}')
    },
    map: {
      ink: ref('color', '{primitive.color.ink-900}'), route: ref('color', '{primitive.color.white}'),
      guide: ref('color', '{primitive.color.green}'), warning: ref('color', '{primitive.color.amber}')
    },
    font: {
      sans: ref('fontFamily', '{primitive.font.sans}'), mono: ref('fontFamily', '{primitive.font.mono}'), display: ref('fontFamily', '{primitive.font.display}')
    },
    radius: {
      xs: ref('dimension', '{primitive.dimension.radius-xs}'), sm: ref('dimension', '{primitive.dimension.radius-sm}'),
      md: ref('dimension', '{primitive.dimension.radius-md}'), lg: ref('dimension', '{primitive.dimension.radius-lg}')
    },
    shadow: { hard: ref('shadow', '{primitive.shadow.hard}') },
    motion: { fast: ref('duration', '{primitive.duration.fast}'), normal: ref('duration', '{primitive.duration.normal}') }
  }
  const component = {
    button: {
      background: ref('color', '{semantic.surface.card}'), foreground: ref('color', '{semantic.foreground.default}'),
      border: ref('color', '{semantic.border.default}'), radius: ref('dimension', '{semantic.radius.sm}')
    },
    'icon-button': {
      background: ref('color', '{semantic.surface.card}'), foreground: ref('color', '{semantic.foreground.default}'), border: ref('color', '{semantic.border.default}')
    },
    field: {
      background: ref('color', '{semantic.surface.panel}'), foreground: ref('color', '{semantic.foreground.default}'), border: ref('color', '{semantic.border.strong}')
    },
    panel: {
      background: ref('color', '{semantic.surface.panel}'), foreground: ref('color', '{semantic.foreground.default}'), border: ref('color', '{semantic.border.strong}')
    },
    card: {
      background: ref('color', '{semantic.surface.card}'), foreground: ref('color', '{semantic.foreground.default}'), border: ref('color', '{semantic.border.strong}')
    },
    navigation: {
      background: ref('color', '{semantic.surface.nav}'), foreground: ref('color', '{semantic.foreground.default}'), border: ref('color', '{semantic.border.default}')
    },
    sheet: {
      background: ref('color', '{semantic.surface.paper}'), foreground: ref('color', '{semantic.foreground.paper}'), border: ref('color', '{semantic.border.strong}')
    },
    dialog: {
      background: ref('color', '{semantic.surface.panel}'), foreground: ref('color', '{semantic.foreground.default}'), border: ref('color', '{semantic.border.strong}')
    },
    toast: {
      background: ref('color', '{semantic.surface.card}'), foreground: ref('color', '{semantic.foreground.default}'), border: ref('color', '{semantic.signal.success}')
    },
    focus: { ring: ref('color', '{semantic.signal.warning}'), offset: ref('dimension', '{semantic.radius.sm}') },
    control: { 'min-target': ref('dimension', '{semantic.radius.lg}') }
  }
  // The public default must satisfy the 44px invariant rather than the visual radius alias above.
  component.control['min-target'] = ref('dimension', '{semantic.radius.lg}')
  ;(semantic.radius as Record<string, AppearanceTokenLeaf>)['touch-target'] = ref('dimension', '{primitive.dimension.touch-target}')
  component.control['min-target'] = ref('dimension', '{semantic.radius.touch-target}')
  return { primitive, semantic, component }
}
