import ReactMarkdown from 'react-markdown'
import { useTranslation } from 'react-i18next'
import remarkGfm from 'remark-gfm'
import tutorialEnUrl from '../../docs/APPEARANCE_DEVELOPMENT_TUTORIAL.en.md?url'
import tutorialZhUrl from '../../docs/APPEARANCE_DEVELOPMENT_TUTORIAL.md?url'
import interfaceContractUrl from '../../ui-contract/interface-contract.json?url'
import manifestSchemaUrl from '../../appearance/appearance.manifest.schema.json?url'
import tokenSchemaUrl from '../../appearance/appearance.tokens.schema.json?url'
import externalAiPromptUrl from '../../appearance/EXTERNAL_AI_PROMPT.md?url'

const GUIDE_DOWNLOADS: Record<string, { url: string; fileName: string }> = {
  './APPEARANCE_DEVELOPMENT_TUTORIAL.md': {
    url: tutorialZhUrl,
    fileName: 'APPEARANCE_DEVELOPMENT_TUTORIAL.md'
  },
  './APPEARANCE_DEVELOPMENT_TUTORIAL.en.md': {
    url: tutorialEnUrl,
    fileName: 'APPEARANCE_DEVELOPMENT_TUTORIAL.en.md'
  },
  '../ui-contract/interface-contract.json': {
    url: interfaceContractUrl,
    fileName: 'interface-contract.json'
  },
  '../appearance/appearance.manifest.schema.json': {
    url: manifestSchemaUrl,
    fileName: 'appearance.manifest.schema.json'
  },
  '../appearance/appearance.tokens.schema.json': {
    url: tokenSchemaUrl,
    fileName: 'appearance.tokens.schema.json'
  },
  '../appearance/EXTERNAL_AI_PROMPT.md': {
    url: externalAiPromptUrl,
    fileName: 'EXTERNAL_AI_PROMPT.md'
  }
}

export function AppearanceAuthoringGuide() {
  const { t } = useTranslation()
  const markdown = t('appearanceStudio.guideMarkdown', {
    interpolation: { escapeValue: false }
  })

  return (
    <article className="appearance-guide" data-appearance-slot="authoring-guide">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          a({ href = '', children, node: _node, ...props }) {
            const download = GUIDE_DOWNLOADS[href]
            if (download) {
              return (
                <a {...props} href={download.url} download={download.fileName}>
                  {children}
                </a>
              )
            }
            return <a {...props} href={href}>{children}</a>
          }
        }}
      >
        {markdown}
      </ReactMarkdown>
    </article>
  )
}
