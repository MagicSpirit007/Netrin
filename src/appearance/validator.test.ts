import { afterEach, describe, expect, it, vi } from 'vitest'
import { strToU8, unzipSync, Zip, ZipPassThrough, zipSync } from 'fflate'
import {
  APPEARANCE_SUMMARY_MAX_LENGTH,
  APPEARANCE_SUMMARY_MIN_LENGTH
} from '../../appearance/contract'
import { ASSET_URL_MARKER, auditAndScopeCss } from './cssSecurity'
import { createAppearanceArchive, parseAppearanceArchive, sha256Hex } from './packageFormat'
import { localAppearanceRepository } from './repository'
import { mountAppearance } from './runtimeStyle'
import { compileAppearanceTokens, createDefaultTokenDocument } from './tokenCompiler'
import type { AppearancePackage } from './types'
import { parseAndAuditAppearancePackage } from './validator'

function skinPackage(): AppearancePackage {
  return {
    manifest: {
      schemaVersion: 3, packageFormat: 'netrin-appearance-zip', interfaceContractVersion: 2,
      id: 'test-skin', displayName: 'Test Skin', summary: 'A test v3 skin.', version: '1.0.0', type: 'skin',
      author: 'Tester', license: 'MIT', compatibility: { minAppVersion: '0.1.0' },
      entrypoints: { tokens: 'tokens.json', theme: 'theme.css' }, assets: [], files: []
    },
    tokensDocument: createDefaultTokenDocument(),
    themeCss: '[data-appearance-hook="button"] { min-height: var(--control-min-target); box-shadow: var(--shadow-hard); }'
  }
}

async function duplicatePathArchive(path: string): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = []
    const archive = new Zip((error, chunk, final) => {
      if (error) { reject(error); return }
      chunks.push(chunk)
      if (final) {
        const length = chunks.reduce((total, item) => total + item.length, 0)
        const output = new Uint8Array(length)
        let offset = 0
        chunks.forEach((item) => { output.set(item, offset); offset += item.length })
        resolve(output)
      }
    })
    const first = new ZipPassThrough(path)
    const second = new ZipPassThrough(path)
    archive.add(first)
    first.push(strToU8('first'), true)
    archive.add(second)
    second.push(strToU8('second'), true)
    archive.end()
  })
}

afterEach(() => vi.unstubAllGlobals())

describe('appearance v3 token contract', () => {
  it('compiles the complete three-layer token graph to stable CSS variables', () => {
    const result = compileAppearanceTokens(createDefaultTokenDocument())
    expect(result.valid).toBe(true)
    expect(result.compiledTokens['--surface-app']).toBe('#0b0c0e')
    expect(result.compiledTokens['--button-bg']).toBe('#1b1e22')
    expect(result.compiledTokens['--control-min-target']).toBe('44px')
  })

  it('rejects unresolved, inverted and cyclic references', () => {
    const missing = createDefaultTokenDocument()
    ;((missing.semantic.surface as Record<string, { $value: string }>).app).$value = '{primitive.color.missing}'
    expect(compileAppearanceTokens(missing).diagnostics.some((item) => item.code === 'token-reference')).toBe(true)

    const inverted = createDefaultTokenDocument()
    ;((inverted.primitive.color as Record<string, { $value: string }>)['ink-900']).$value = '{semantic.surface.app}'
    expect(compileAppearanceTokens(inverted).diagnostics.some((item) => item.code === 'token-layer')).toBe(true)

    const cyclic = createDefaultTokenDocument()
    ;((cyclic.semantic.surface as Record<string, { $value: string }>).app).$value = '{semantic.surface.panel}'
    ;((cyclic.semantic.surface as Record<string, { $value: string }>).panel).$value = '{semantic.surface.app}'
    expect(compileAppearanceTokens(cyclic).diagnostics.some((item) => item.code === 'token-cycle')).toBe(true)
  })

  it('rejects token type mismatches and touch targets below 44px', () => {
    const wrong = createDefaultTokenDocument()
    ;((wrong.component.button as Record<string, { $type: string }>).background).$type = 'dimension'
    expect(compileAppearanceTokens(wrong).checks.types).toBe(false)
    const small = createDefaultTokenDocument()
    ;((small.primitive.dimension as Record<string, { $value: string }>)['touch-target']).$value = '40px'
    const result = compileAppearanceTokens(small)
    expect(result.checks.touchTargets).toBe(false)
    expect(result.diagnostics.find((item) => item.code === 'touch-target')?.tokenPath).toBe('component.control.min-target')
  })
})

describe('appearance v3 CSS security', () => {
  it('scopes CSS and returns source locations', () => {
    const result = auditAndScopeCss('[data-appearance-hook="button"] { min-height: 44px; }', 'test-skin', [])
    expect(result.valid).toBe(true)
    expect(result.sanitizedCss).toContain('.app-frame[data-appearance="test-skin"]')
    const invalid = auditAndScopeCss('\nbody { color: red; }', 'test-skin', [])
    expect(invalid.issues[0]).toMatchObject({ file: 'theme.css', line: 2, selector: 'body' })
  })

  it.each([
    ['script-like external URL', '[data-appearance-hook="app-shell"] { background:url(https://example.com/x.png) }'],
    ['global selector', 'body { color:red }'], ['AMap selector', '.amap-copyright { opacity:1 }'],
    ['application-private class', '.home__wordmark { color:red }'],
    ['hidden control', '[data-appearance-hook="button"] { display:none }'],
    ['full-screen fixed overlay', '[data-appearance-hook="dialog"] { position:fixed; width:100vw }'],
    ['small target', '[data-appearance-hook="button"] { min-height:20px }'],
    ['contract token declaration', '[data-appearance-hook="app-shell"] { --surface-app:#000 }'],
    ['unprefixed private token', '[data-appearance-hook="app-shell"] { --private:#000 }'],
    ['unprotected motion', '[data-appearance-hook="card"] { animation:test-skin-pulse 1s } @keyframes test-skin-pulse { from { opacity:1 } to { opacity:.5 } }']
  ])('rejects forbidden style: %s', (_label, css) => expect(auditAndScopeCss(css, 'test-skin', []).valid).toBe(false))

  it('accepts only declared package asset URLs and marks them for runtime mapping', () => {
    const css = '[data-appearance-slot="brand-wordmark"] { background-image:url("assets/logo.webp") }'
    const accepted = auditAndScopeCss(css, 'test-skin', ['assets/logo.webp'])
    expect(accepted.valid).toBe(true)
    expect(accepted.referencedAssets).toEqual(['assets/logo.webp'])
    expect(accepted.sanitizedCss).toContain(`${ASSET_URL_MARKER}assets/logo.webp`)
    expect(auditAndScopeCss(css, 'test-skin', []).valid).toBe(false)
  })

  it('accepts the four stable brand slots without relying on application-private classes', () => {
    const css = [
      '[data-appearance-slot="brand-wordmark"] { background:var(--surface-paper) }',
      '[data-appearance-slot="brand-title"] { color:var(--signal-info) }',
      '[data-appearance-slot="brand-name"] { font-family:var(--font-display) }',
      '[data-appearance-slot="brand-mark"] { background:var(--signal-success) }'
    ].join('\n')
    expect(auditAndScopeCss(css, 'test-skin', []).valid).toBe(true)
  })

  it('maps audited assets to object URLs and revokes them when the appearance unmounts', () => {
    const mountedStyle = { dataset: {}, textContent: '', remove: vi.fn() }
    const append = vi.fn()
    const createObjectURL = vi.fn(() => 'blob:netrin-logo')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('Document', class {})
    vi.stubGlobal('document', { createElement: vi.fn(() => mountedStyle) })
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })
    const root = {
      dataset: {},
      style: { setProperty: vi.fn(), removeProperty: vi.fn() }
    } as unknown as HTMLElement
    const appearance: AppearancePackage = {
      ...skinPackage(),
      sanitizedCss: `[data-appearance-slot="brand-wordmark"] { background-image:url("${ASSET_URL_MARKER}assets/logo.webp") }`,
      assets: {
        'assets/logo.webp': {
          mimeType: 'image/webp', data: new Uint8Array([0x52, 0x49, 0x46, 0x46]), sha256: '0'.repeat(64)
        }
      }
    }

    const mounted = mountAppearance(appearance, root, { append } as unknown as ShadowRoot)
    expect(createObjectURL).toHaveBeenCalledOnce()
    expect(mountedStyle.textContent).toContain('blob:netrin-logo')
    expect(append).toHaveBeenCalledWith(mountedStyle)
    mounted.dispose()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:netrin-logo')
    expect(mountedStyle.remove).toHaveBeenCalledOnce()
  })
})

describe('appearance v3 archive', () => {
  it('creates byte-identical sorted archives and reports their SHA-256', async () => {
    const first = await createAppearanceArchive(skinPackage())
    const second = await createAppearanceArchive(skinPackage())
    expect(first).toEqual(second)
    const parsed = await parseAppearanceArchive(first)
    expect(parsed.report.valid).toBe(true)
    expect(parsed.report.packageSha256).toBe(await sha256Hex(first))
    expect(Object.keys(unzipSync(first))).toEqual(['appearance.manifest.json', 'theme.css', 'tokens.json'])
  })

  it('rejects v1/v2 JSON with the explicit unsupported code', () => {
    const result = parseAndAuditAppearancePackage(JSON.stringify({ manifest: { schemaVersion: 2 } }))
    expect(result.report.valid).toBe(false)
    expect(result.report.diagnostics[0].code).toBe('unsupported-schema-version')
  })

  it('rejects path traversal before extraction', async () => {
    const result = await parseAppearanceArchive(zipSync({ '../appearance.manifest.json': strToU8('{}') }))
    expect(result.report.valid).toBe(false)
    expect(result.report.diagnostics.some((item) => item.code === 'archive-path')).toBe(true)
  })

  it('rejects duplicate paths before extraction', async () => {
    const result = await parseAppearanceArchive(await duplicatePathArchive('tokens.json'))
    expect(result.report.valid).toBe(false)
    expect(result.report.diagnostics.some((item) => item.code === 'archive-path')).toBe(true)
  })

  it('rejects single-entry and cumulative expanded-size bombs before extraction', async () => {
    const oversizedEntry = zipSync({
      'assets/large.png': new Uint8Array(2 * 1024 * 1024 + 1)
    }, { level: 9 })
    const oversizedResult = await parseAppearanceArchive(oversizedEntry)
    expect(oversizedResult.report.diagnostics.some((item) => item.code === 'archive-size')).toBe(true)

    const chunk = new Uint8Array(1_900_000)
    const cumulative = zipSync(Object.fromEntries(
      Array.from({ length: 5 }, (_, index) => [`assets/large-${index}.png`, chunk])
    ), { level: 9 })
    const cumulativeResult = await parseAppearanceArchive(cumulative)
    expect(cumulativeResult.report.diagnostics.some((item) => item.code === 'archive-size')).toBe(true)
  })

  it('enforces the shared 1-240 character summary contract', async () => {
    for (const length of [APPEARANCE_SUMMARY_MIN_LENGTH, APPEARANCE_SUMMARY_MAX_LENGTH]) {
      const appearance = skinPackage()
      appearance.manifest.summary = 'a'.repeat(length)
      expect((await parseAppearanceArchive(await createAppearanceArchive(appearance))).report.valid).toBe(true)
    }
    for (const length of [0, APPEARANCE_SUMMARY_MAX_LENGTH + 1]) {
      const appearance = skinPackage()
      appearance.manifest.summary = 'a'.repeat(length)
      expect((await parseAppearanceArchive(await createAppearanceArchive(appearance))).report.valid).toBe(false)
    }
  })

  it('rejects undeclared executable and bad-magic assets', async () => {
    const source = unzipSync(await createAppearanceArchive(skinPackage()))
    source['evil.js'] = strToU8('alert(1)')
    expect((await parseAppearanceArchive(zipSync(source))).report.valid).toBe(false)
    delete source['evil.js']
    source['assets/not-a-png.png'] = strToU8('not png')
    expect((await parseAppearanceArchive(zipSync(source))).report.valid).toBe(false)
  })

  it('falls back to bundled Field Guide for a missing or unsupported active package', async () => {
    const result = await localAppearanceRepository.resolveActive('legacy-v2-active')
    expect(result.fellBack).toBe(true)
    expect(result.appearance.manifest.id).toBe('field-guide-phenotype')
  })
})
