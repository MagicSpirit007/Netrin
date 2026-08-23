import postcss, { type AtRule, type Declaration, type Rule } from 'postcss'
import selectorParser from 'postcss-selector-parser'
import valueParser from 'postcss-value-parser'
import { CONTRACT_CSS_VARIABLES } from './tokenContract'
import type { AppearanceAuditIssue } from './types'

export const ASSET_URL_MARKER = '__NETRIN_APPEARANCE_ASSET__/'

const SAFE_ASSET_PATH = /^assets\/[a-z0-9][a-z0-9._/-]*$/i
const PROTECTED_SELECTOR = /(?:^|[^a-z0-9_-])(?:\.amap-|\[class[^\]]*amap-|#amap-|amap-logo|amap-copyright)/i
const FORBIDDEN_TAGS = new Set(['html', 'body', 'head', 'script', 'style', 'iframe', 'object', 'embed', 'canvas'])
const FORBIDDEN_PSEUDOS = new Set([':root', ':global', ':host', ':host-context', ':has'])
const FORBIDDEN_PROPERTIES = new Set([
  'all',
  'behavior',
  '-moz-binding',
  '-webkit-text-fill-color',
  'clip',
  'clip-path',
  'mask',
  'mask-image',
  '-webkit-mask',
  '-webkit-mask-image',
  'content'
])
const ALLOWED_AT_RULES = new Set(['media', 'supports', 'font-face', 'keyframes', '-webkit-keyframes'])
const INTERACTIVE_HOOK = /data-appearance-hook\s*=\s*["'](?:button|icon-button|text-field|switch|bottom-navigation|map-controls)["']/i
export type CssSecurityResult = {
  valid: boolean
  sanitizedCss?: string
  issues: AppearanceAuditIssue[]
  referencedAssets: string[]
  checks: {
    safeRuntime: boolean
    cssScope: boolean
    externalResources: boolean
    contrast: boolean
    touchTargets: boolean
    reducedMotion: boolean
    mapAttribution: boolean
    screenshot390x844: boolean
  }
}

function issue(code: string, message: string, node?: AtRule | Declaration | Rule): AppearanceAuditIssue {
  return {
    severity: 'error',
    code,
    message,
    file: 'theme.css',
    line: node?.source?.start?.line,
    column: node?.source?.start?.column,
    selector: node?.type === 'rule' ? node.selector : node?.parent?.type === 'rule' ? node.parent.selector : undefined
  }
}

function isInsideKeyframes(rule: Rule): boolean {
  let parent = rule.parent
  while (parent) {
    if (parent.type === 'atrule' && ['keyframes', '-webkit-keyframes'].includes(parent.name.toLowerCase())) {
      return true
    }
    parent = parent.parent as typeof parent
  }
  return false
}

function safeRelativeAssetPath(path: string): boolean {
  if (!SAFE_ASSET_PATH.test(path) || path.includes('\\')) return false
  const segments = path.split('/')
  return segments.every((segment) => segment && segment !== '.' && segment !== '..')
}

function scopeSelector(selector: string, packageId: string): string {
  if (PROTECTED_SELECTOR.test(selector)) throw new Error('AMap provider selectors are protected.')
  const scope = selectorParser().astSync(`.app-frame[data-appearance="${packageId}"]`).first
  if (!scope) throw new Error('Appearance scope could not be created.')

  return selectorParser((selectors) => {
    selectors.walkClasses((node) => {
      throw new Error(`Application-private class selector ".${node.value}" is not allowed; use stable appearance hooks, screens, states, slots, ARIA, or native controls.`)
    })
    selectors.walkUniversals(() => {
      throw new Error('Universal selectors are not allowed.')
    })
    selectors.walkTags((node) => {
      if (FORBIDDEN_TAGS.has(node.value.toLowerCase())) {
        throw new Error(`Global or provider tag selector "${node.value}" is not allowed.`)
      }
    })
    selectors.walkIds((node) => {
      if (node.value.toLowerCase() === 'root') throw new Error('#root is outside the appearance boundary.')
    })
    selectors.walkPseudos((node) => {
      const value = node.value.toLowerCase()
      if (FORBIDDEN_PSEUDOS.has(value) || value.startsWith('::')) {
        throw new Error(`Pseudo selector "${node.value}" is not allowed.`)
      }
    })
    selectors.each((candidate) => {
      const original = candidate.clone()
      const first = original.nodes[0]
      const targetsAppShell = (
        first?.type === 'attribute' &&
        first.attribute === 'data-appearance-hook' &&
        first.value === 'app-shell'
      )
      candidate.removeAll()
      scope.nodes.forEach((node) => candidate.append(node.clone()))
      if (!targetsAppShell) candidate.append(selectorParser.combinator({ value: ' ' }))
      original.nodes.slice(targetsAppShell ? 1 : 0).forEach((node) => candidate.append(node.clone()))
    })
  }).processSync(selector)
}

function declarationHasMotion(declaration: Declaration): boolean {
  const property = declaration.prop.toLowerCase()
  if (!property.startsWith('animation') && !property.startsWith('transition')) return false
  return !/^(?:none|0s|0ms)(?:\s|$)/i.test(declaration.value.trim())
}

function isReducedMotionRule(declaration: Declaration): boolean {
  let parent = declaration.parent
  while (parent) {
    if (
      parent.type === 'atrule' &&
      parent.name.toLowerCase() === 'media' &&
      /prefers-reduced-motion\s*:\s*reduce/i.test(parent.params)
    ) {
      const property = declaration.prop.toLowerCase()
      return (
        ((property.startsWith('animation') || property.startsWith('transition')) && /(?:none|0(?:\.0+)?m?s)/i.test(declaration.value)) ||
        property === 'scroll-behavior'
      )
    }
    parent = parent.parent as typeof parent
  }
  return false
}

function validateAtRule(atRule: AtRule, packageId: string): string | undefined {
  const name = atRule.name.toLowerCase()
  if (!ALLOWED_AT_RULES.has(name)) return `@${atRule.name} is not allowed.`
  if (/url\s*\(|https?:|javascript:|expression\s*\(/i.test(atRule.params)) {
    return `@${atRule.name} contains an external or executable value.`
  }
  if (name === 'keyframes' || name === '-webkit-keyframes') {
    if (!atRule.params.startsWith(`${packageId}-`)) {
      return `Keyframe names must start with "${packageId}-".`
    }
  }
  return undefined
}

function validateDeclaration(
  declaration: Declaration,
  ruleSelector: string,
  packageId: string,
  assetPaths: Set<string>,
  references: Set<string>
): string | undefined {
  const property = declaration.prop.trim().toLowerCase()
  const lowerValue = declaration.value.toLowerCase()
  if (property.startsWith('--')) {
    if (CONTRACT_CSS_VARIABLES.has(property as `--${string}`)) {
      return `Contract token "${property}" must be declared in tokens.json, not theme.css.`
    }
    if (!property.startsWith(`--${packageId}-`)) {
      return `Private custom properties must start with "--${packageId}-".`
    }
  }
  if (FORBIDDEN_PROPERTIES.has(property)) return `Property "${property}" is not allowed.`
  if (/(?:javascript\s*:|expression\s*\(|-moz-binding|behavior\s*:)/i.test(declaration.value)) {
    return `Declaration "${property}" contains executable CSS.`
  }
  if (property === 'display' && /\bnone\b/i.test(declaration.value)) return 'display:none is not allowed.'
  if (property === 'visibility' && /\b(?:hidden|collapse)\b/i.test(declaration.value)) return 'Hidden visibility is not allowed.'
  if (property === 'pointer-events' && /\bnone\b/i.test(declaration.value)) return 'pointer-events:none is not allowed.'
  if (property === 'position' && /\bfixed\b/i.test(declaration.value)) return 'position:fixed overlays are not allowed.'
  if (property === 'cursor' && /\bnone\b/i.test(declaration.value)) return 'cursor:none is not allowed.'
  if (property === 'opacity' && Number.parseFloat(declaration.value) < 0.05) return 'Near-zero opacity is not allowed.'
  if ((property === 'font-size' || property === 'line-height') && /^0(?:\D|$)/.test(declaration.value.trim())) {
    return `${property}:0 is not allowed.`
  }
  if (property === 'color' && /\btransparent\b/i.test(declaration.value)) return 'Transparent text is not allowed.'
  if (property === 'transform' && /scale(?:x|y)?\(\s*0(?:\.0+)?\s*\)/i.test(declaration.value)) {
    return 'Zero-scale hiding is not allowed.'
  }
  if ((property === 'overflow' || property === 'overflow-x' || property === 'overflow-y') && /\b(?:hidden|clip)\b/i.test(declaration.value)) {
    return 'Overflow hiding is not allowed in runtime packages.'
  }
  if (['width', 'height', 'min-width', 'min-height', 'inset'].includes(property) && /(?:100|1\d\d+)(?:d?v[wh]|sv[wh]|lv[wh])/i.test(declaration.value)) {
    return 'Viewport-covering dimensions are not allowed.'
  }
  if (property === 'z-index') {
    const value = Number.parseInt(declaration.value, 10)
    if (!Number.isFinite(value) || value > 40) return 'z-index must be an integer no greater than 40.'
  }
  if (
    INTERACTIVE_HOOK.test(ruleSelector) &&
    ['width', 'height', 'min-width', 'min-height', 'max-width', 'max-height'].includes(property)
  ) {
    const pixels = declaration.value.trim().match(/^(\d+(?:\.\d+)?)px$/i)
    if (pixels && Number(pixels[1]) < 44) return 'Interactive targets cannot be reduced below 44px.'
  }
  if (INTERACTIVE_HOOK.test(ruleSelector)) {
    if (property === 'filter' || property === 'translate' || property === 'scale') {
      return `${property} is not allowed on interactive controls.`
    }
    if (property === 'transform' && declaration.value.trim().toLowerCase() !== 'none') {
      return 'Transforms are not allowed on interactive controls.'
    }
    if (property === 'position' && !/^(?:static|relative)$/i.test(declaration.value.trim())) {
      return 'Interactive controls may only use static or relative positioning.'
    }
    if (/^(?:top|right|bottom|left|inset(?:-.+)?)$/.test(property)) {
      return 'Inset positioning is not allowed on interactive controls.'
    }
  }
  if ((property === 'animation' || property === 'animation-name') && lowerValue !== 'none') {
    if (!declaration.value.includes(`${packageId}-`)) {
      return 'Animation names must be package-prefixed.'
    }
  }

  const parsed = valueParser(declaration.value)
  const replacements: Array<[string, string]> = []
  let valueError: string | undefined
  parsed.walk((node) => {
    if (valueError || node.type !== 'function' || node.value.toLowerCase() !== 'url') return
    const rawCall = valueParser.stringify(node)
    const path = valueParser.stringify(node.nodes).trim().replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, '$1$2')
    if (!safeRelativeAssetPath(path) || !assetPaths.has(path)) {
      valueError = `url() may reference only a declared package asset; received "${path}".`
      return
    }
    references.add(path)
    replacements.push([rawCall, `url("${ASSET_URL_MARKER}${path}")`])
  })
  if (valueError) return valueError
  replacements.forEach(([from, to]) => {
    declaration.value = declaration.value.split(from).join(to)
  })
  return undefined
}

export function auditAndScopeCss(
  source: string,
  packageId: string,
  declaredAssetPaths: Iterable<string>
): CssSecurityResult {
  const issues: AppearanceAuditIssue[] = []
  const references = new Set<string>()
  const assetPaths = new Set(declaredAssetPaths)
  let root: postcss.Root
  let hasMotion = false
  let hasReducedMotion = false
  let touchTargets = true
  let mapAttribution = true
  let externalResources = true
  let cssScope = true
  let screenshot390x844 = true

  try {
    root = postcss.parse(source, { from: 'theme.css' })
  } catch (error) {
    return {
      valid: false,
      issues: [issue('css-parse', error instanceof Error ? error.message : 'theme.css could not be parsed.')],
      referencedAssets: [],
      checks: {
        safeRuntime: false,
        cssScope: false,
        externalResources: false,
        contrast: false,
        touchTargets: false,
        reducedMotion: false,
        mapAttribution: false,
        screenshot390x844: false
      }
    }
  }

  root.walkAtRules((atRule) => {
    const message = validateAtRule(atRule, packageId)
    if (message) issues.push(issue('css-at-rule', message, atRule))
    if (atRule.name.toLowerCase() === 'font-face') {
      const family = atRule.nodes?.find((node) => node.type === 'decl' && node.prop.toLowerCase() === 'font-family')
      if (!family || family.type !== 'decl' || !family.value.replace(/["']/g, '').trim().startsWith(`netrin-${packageId}-`)) {
        issues.push(issue('css-font', `@font-face family names must start with "netrin-${packageId}-".`, atRule))
      }
    }
  })

  root.walkRules((rule) => {
    if (isInsideKeyframes(rule)) return
    try {
      rule.selector = scopeSelector(rule.selector, packageId)
    } catch (error) {
      cssScope = false
      if (PROTECTED_SELECTOR.test(rule.selector)) mapAttribution = false
      issues.push(issue('css-selector', error instanceof Error ? error.message : 'Selector is not allowed.', rule))
    }
  })

  root.walkDecls((declaration) => {
    const ruleSelector = declaration.parent?.type === 'rule' ? declaration.parent.selector : ''
    if (declarationHasMotion(declaration)) hasMotion = true
    if (isReducedMotionRule(declaration)) hasReducedMotion = true
    const message = validateDeclaration(declaration, ruleSelector, packageId, assetPaths, references)
    if (!message) return
    if (/url\(\)|external|executable/i.test(message)) externalResources = false
    if (/44px/i.test(message)) touchTargets = false
    if (/viewport-covering|overflow hiding/i.test(message)) screenshot390x844 = false
    issues.push(issue('css-declaration', message, declaration))
  })

  const reducedMotion = !hasMotion || hasReducedMotion
  if (!reducedMotion) {
    issues.push(issue('reduced-motion', 'Animations or transitions require a prefers-reduced-motion: reduce override.'))
  }

  const valid = issues.length === 0
  return {
    valid,
    sanitizedCss: valid ? root.toString() : undefined,
    issues,
    referencedAssets: [...references].sort(),
    checks: {
      safeRuntime: valid,
      cssScope,
      externalResources,
      contrast: true,
      touchTargets,
      reducedMotion,
      mapAttribution,
      screenshot390x844
    }
  }
}
