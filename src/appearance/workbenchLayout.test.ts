// @ts-nocheck -- Vitest executes this source-level contract check in Node.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import screenSource from '../screens/AppearanceStudioScreen.tsx?raw'
import previewSource from './AppearancePreview.tsx?raw'
import { createAppearanceCoverage } from './AppearanceDevWorkbench'
import workbenchSource from './AppearanceDevWorkbench.tsx?raw'
import type { AppearancePackage } from './types'

const styles = [
  readFileSync(new URL('../styles.css', import.meta.url), 'utf8'),
  readFileSync(new URL('./AppearanceDevWorkbench.css', import.meta.url), 'utf8')
].join('\n')

describe('appearance workbench responsive layout contract', () => {
  it('keeps the workbench available as one, two and three safe-shrinking columns', () => {
    expect(screenSource).not.toContain('DESKTOP_QUERY')
    expect(screenSource).not.toContain('appearance-studio-mobile-gate')
    expect(styles).toMatch(/\.appearance-studio-workspace\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s)
    expect(styles).toMatch(/@media \(min-width:\s*760px\)[\s\S]*?\.appearance-studio-workspace\s*\{[^}]*grid-template-columns:[^;}]*minmax\(0,\s*1\.25fr\)/)
    expect(styles).toMatch(/@media \(min-width:\s*1180px\)[\s\S]*?\.appearance-studio-workspace\s*\{[^}]*grid-template-columns:[^;}]*minmax\(0,\s*1\.25fr\)[^;}]*minmax\(230px,\s*0\.9fr\)/)
    expect(styles).not.toMatch(/grid-template-columns:\s*minmax\(230px,\s*0\.8fr\)\s+minmax\(410px/)
  })

  it('contains long hashes, diagnostics, paths, lists and the Shadow DOM preview locally', () => {
    ;['.appearance-studio-column', '.appearance-studio-preview-column', '.appearance-dev-workbench', '.appearance-package', '.appearance-cloud-list']
      .forEach((selector) => expect(styles).toContain(selector))
    expect(styles.match(/min-width:\s*0/g)?.length ?? 0).toBeGreaterThan(20)
    expect(styles).toMatch(/\.appearance-dev-workbench code\s*\{[^}]*overflow-wrap:\s*anywhere/s)
    expect(styles).toMatch(/\.appearance-dev-workbench pre\s*\{[^}]*overflow:\s*auto/s)
    expect(styles).toMatch(/\.appearance-preview-shadow\s*\{[^}]*overflow-x:\s*auto/s)
    expect(previewSource).toContain(':host { display: block; max-width:100%')
    expect(previewSource).toContain('width: 390px; min-height: 844px; max-width:none; overflow-x:auto')
    expect(workbenchSource).toContain('appearance-dev-source-hash')
    expect(workbenchSource).toContain('appearance-dev-diagnostic')
  })

  it('reports brand-slot provenance as default inheritance, Token, or CSS', () => {
    expect(createAppearanceCoverage(null).slots.map((item) => item.styledBy)).toEqual(Array(4).fill('inherited'))
    const tokenAppearance = { compiledTokens: { '--surface-app': '#000' }, sanitizedCss: '' } as AppearancePackage
    expect(createAppearanceCoverage(tokenAppearance).slots.map((item) => item.styledBy)).toEqual(Array(4).fill('token'))
    const cssAppearance = {
      ...tokenAppearance,
      sanitizedCss: '[data-appearance-slot="brand-wordmark"] { color: red }'
    } as AppearancePackage
    expect(createAppearanceCoverage(cssAppearance).slots.map((item) => item.styledBy)).toEqual(['css', 'token', 'token', 'token'])
  })
})
