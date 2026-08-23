import { describe, expect, it } from 'vitest'
import { MAP_STYLE_IDS } from './data/types'
import i18n from './i18n'

describe('localized product name', () => {
  it('uses 移步换景 in Chinese and Netrin in English', async () => {
    await i18n.changeLanguage('zh-CN')
    expect(i18n.t('app.name')).toBe('移步换景')
    await i18n.changeLanguage('en')
    expect(i18n.t('app.name')).toBe('Netrin')
  })

  it('ships complete statement, appearance studio, and auth error copy in both languages', async () => {
    for (const language of ['zh-CN', 'en']) {
      await i18n.changeLanguage(language)
      expect(i18n.t('profile.readme')).not.toContain('README')
      for (const key of [
        'appearanceStudio.title',
        'appearanceStudio.devWorkbench.title',
        'appearanceStudio.tabs.workbench',
        'appearanceStudio.tabs.guide',
        'appearanceStudio.previewScreens.phone-auth',
        'appearanceStudio.guideMarkdown',
        'profile.appearanceGroup',
        'profile.readmeSections.project.title',
        'profile.readmeSections.map.body',
        'profile.readmeSections.appearance.body',
        'profile.readmeSections.rules.body',
        'auth.errors.invalidPhone',
        'auth.errors.invalidOtp',
        'auth.errors.rateLimited',
        'auth.errors.smsUnavailable'
      ]) {
        expect(i18n.exists(key), `${language}:${key}`).toBe(true)
        expect(i18n.t(key)).not.toBe(key)
      }
    }
  })

  it('states authoring/discovery as live and social features as out of scope (zh/en)', async () => {
    const projectKeys = [
      'profile.readmeSections.project.body',
      'profile.readmeSections.routes.body'
    ] as const
    const liveMarkers = {
      'zh-CN': ['GPX', 'GeoJSON', '统一路线编辑器', '发现筛选', '三入口'],
      en: ['GPX', 'GeoJSON', 'unified editor', 'discovery filters', 'three authoring entries']
    } as const
    const closedSocial = {
      'zh-CN': ['关注', '收藏', '点赞', '评论', '举报'],
      en: ['Follow', 'bookmark', 'like', 'comment', 'report']
    } as const
    const forbiddenNotShipped = {
      'zh-CN': ['尚未交付', '尚未上线', '未交付'],
      en: ['not delivered yet', 'not shipped yet', 'are not delivered']
    } as const

    for (const language of ['zh-CN', 'en'] as const) {
      await i18n.changeLanguage(language)
      const project = i18n.t(projectKeys[0])
      const routes = i18n.t(projectKeys[1])
      const combined = `${project}\n${routes}`

      for (const marker of liveMarkers[language]) {
        expect(combined, `${language} must mention live R1 capability: ${marker}`).toContain(marker)
      }
      for (const phrase of forbiddenNotShipped[language]) {
        expect(combined, `${language} must not claim R1 authoring/discovery is unshipped: ${phrase}`).not.toContain(phrase)
      }

      // Social features were permanently removed, rather than left behind a future gate.
      for (const feature of closedSocial[language]) {
        const socialScope = language === 'en' ? project.toLowerCase() : project
        expect(socialScope, `${language} project statement must name excluded social scope: ${feature}`).toContain(feature.toLowerCase())
      }
      if (language === 'zh-CN') {
        expect(project).toContain('不包含')
      } else {
        expect(project.toLowerCase()).toContain('does not include')
      }
    }
  })

  it('uses the required localized names for every selectable AMap style', async () => {
    const expected = {
      'zh-CN': ['标准', '幻影黑', '月光银', '草褐青', '典雅灰', '马卡龙', '极夜蓝'],
      en: [
        'Standard',
        'Phantom Black',
        'Moonlight Silver',
        'Fresh Green',
        'Gentleman Grey',
        'Macaron',
        'Polar Night Blue'
      ]
    } as const

    for (const language of ['zh-CN', 'en'] as const) {
      await i18n.changeLanguage(language)
      expect(MAP_STYLE_IDS.map((styleId) => i18n.t(`profile.mapStyles.${styleId}`)))
        .toEqual(expected[language])
    }
  })
})
