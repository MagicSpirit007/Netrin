import { describe, expect, it } from 'vitest'
import skillMetadata from '../../.agents/skills/author-netrin-appearance/agents/openai.yaml?raw'
import skillSource from '../../.agents/skills/author-netrin-appearance/SKILL.md?raw'
import guideZh from '../../docs/APPEARANCE_AUTHORING.md?raw'
import guideEn from '../../docs/APPEARANCE_AUTHORING.en.md?raw'
import tutorialEn from '../../docs/APPEARANCE_DEVELOPMENT_TUTORIAL.en.md?raw'
import tutorialZh from '../../docs/APPEARANCE_DEVELOPMENT_TUTORIAL.md?raw'
import externalAiPrompt from '../../appearance/EXTERNAL_AI_PROMPT.md?raw'
import guideComponent from './AppearanceAuthoringGuide.tsx?raw'

const localDocumentationFiles = new Set(Object.keys(import.meta.glob([
  '../../docs/**/*', '../../appearance/**/*', '../../ui-contract/**/*'
], { eager: true, query: '?raw', import: 'default' })).map((file) => new URL(file, import.meta.url).pathname))

function expectLocalLinksToExist(markdown: string, directory: string) {
  const base = new URL(`../../${directory}/`, import.meta.url)
  for (const match of markdown.matchAll(/\]\(([^)]+)\)/g)) {
    const href = match[1].split('#')[0]
    if (!href || /^(?:https?:|mailto:)/.test(href)) continue
    expect(localDocumentationFiles.has(new URL(href, base).pathname), href).toBe(true)
  }
}

describe('appearance authoring guide', () => {
  it('contains every required Chinese guide section and the current Studio flow', () => {
    ;[
      '快速开始',
      '包结构',
      'Appearance Manifest',
      '三层令牌',
      'CSS Hooks、页面、状态与插槽',
      '资源与安全限制',
      '打包、校验与路由审查',
      'skin、phenotype 与投稿审核',
      '契约下载与 AI 交付'
    ].forEach((heading) => expect(guideZh).toContain(heading))
    expect(guideZh).toContain('/appearance-studio?tab=workbench')
    expect(guideZh).toContain('./APPEARANCE_DEVELOPMENT_TUTORIAL.md')
    expect(guideZh).not.toContain('我的 → 外观实验室')
  })

  it('keeps an English companion with all downloadable authoring inputs', () => {
    ;['Quick start', 'Package structure', 'Appearance Manifest', 'Three-layer tokens', 'submission and review', 'Contract downloads']
      .forEach((heading) => expect(guideEn).toContain(heading))
    ;[
      '../appearance/appearance.manifest.schema.json',
      '../appearance/appearance.tokens.schema.json',
      '../appearance/EXTERNAL_AI_PROMPT.md'
    ].forEach((href) => expect(guideEn).toContain(href))
    expect(guideEn).toContain('./APPEARANCE_DEVELOPMENT_TUTORIAL.en.md')
    expect(guideEn).not.toContain('../appearance/examples/')
  })

  it('keeps the bilingual hands-on tutorials aligned and executable', () => {
    expect(tutorialZh.match(/^## \d+\./gm)).toHaveLength(10)
    expect(tutorialEn.match(/^## \d+\./gm)).toHaveLength(10)
    ;['appearance:init', 'appearance:dev', 'appearance:check', 'appearance:package', 'appearance:review', '$author-netrin-appearance']
      .forEach((command) => {
        expect(tutorialZh).toContain(command)
        expect(tutorialEn).toContain(command)
      })
    expect(tutorialZh).not.toContain('../appearance/examples/')
    expect(tutorialEn).not.toContain('../appearance/examples/')
    expectLocalLinksToExist(guideZh, 'docs')
    expectLocalLinksToExist(guideEn, 'docs')
    expectLocalLinksToExist(tutorialZh, 'docs')
    expectLocalLinksToExist(tutorialEn, 'docs')
  })

  it('exposes tutorial downloads and the project collaboration skill', () => {
    expect(guideComponent).toContain('APPEARANCE_DEVELOPMENT_TUTORIAL.md')
    expect(guideComponent).toContain('APPEARANCE_DEVELOPMENT_TUTORIAL.en.md')
    expect(skillSource).toContain('## Gate 1: confirm the visual brief')
    expect(skillSource).toContain('## Gate 2: confirm the preview')
    expect(skillSource).toContain('The original task never counts as Gate 1 approval')
    expect(skillSource).toContain('Gate 2 is also a hard turn boundary')
    expect(skillSource).toContain('Stop before submission')
    expect(skillMetadata).toContain('allow_implicit_invocation: true')
    expect(skillMetadata).toContain('$author-netrin-appearance')
    expect(externalAiPrompt).toContain('$author-netrin-appearance')
  })

  it('forwards Logo requests through stable brand slots instead of private application code', () => {
    ;['brand-wordmark', 'brand-title', 'brand-name', 'brand-mark'].forEach((slot) => {
      expect(skillSource).toContain(slot)
      expect(guideZh).toContain(slot)
      expect(guideEn).toContain(slot)
      expect(tutorialZh).toContain(slot)
      expect(tutorialEn).toContain(slot)
      expect(externalAiPrompt).toContain(slot)
    })
    ;[skillSource, guideZh, tutorialZh, externalAiPrompt].forEach((source) => {
      expect(source).toContain('需要先扩展应用契约')
    })
    expect(skillSource).toContain('xuan-paper ground, mineral-blue type, mineral-green seal, and Song-style title')
    expect(skillSource).toContain('never claim that the Logo cannot be changed')
    expect(skillSource).toContain('Do not edit React, business components, application CSS, or contracts')
    expect(skillSource).toContain('user-provided or explicitly approved package-local PNG, JPEG, or WebP')
    expect(skillSource).toContain('SVG, Data URLs, external URLs, scripts, and runtime downloads are forbidden')
    expect(skillSource).toContain('revoke them when the appearance unmounts')
    expect(tutorialZh).toContain('宣纸底、石青字、石绿印记、宋体题签')
    expect(tutorialZh).toContain('不要回答“Logo 无法修改”')
    expect(externalAiPrompt).toContain('不得修改业务组件')
  })
})
