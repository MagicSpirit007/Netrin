// @ts-nocheck -- Shared by tsx CLI and the Node-only Vite plugin, outside the browser compilation target.
import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { createAppearanceArchive, isZipBytes, parseAppearanceArchive } from '../src/appearance/packageFormat'
import type { AppearanceAsset, AppearanceBinaryAsset, AppearanceImportResult, AppearanceManifest, AppearancePackage, AppearanceTokensDocument } from '../src/appearance/types'

const MIME_BY_EXTENSION: Record<string, AppearanceAsset['mimeType']> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2'
}

async function collectAssets(directory: string, root = directory): Promise<Record<string, AppearanceBinaryAsset>> {
  const output: Record<string, AppearanceBinaryAsset> = {}
  try {
    const entries = await readdir(directory, { withFileTypes: true })
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const absolute = path.join(directory, entry.name)
      if (entry.isDirectory()) Object.assign(output, await collectAssets(absolute, root))
      else if (entry.isFile()) {
        const mimeType = MIME_BY_EXTENSION[path.extname(entry.name).toLowerCase()]
        if (!mimeType) throw new Error(`Unsupported asset extension: ${entry.name}`)
        const relative = `assets/${path.relative(root, absolute).split(path.sep).join('/')}`
        output[relative] = { mimeType, data: new Uint8Array(await readFile(absolute)), sha256: '' }
      }
    }
  } catch (error) {
    if ((error as { code?: string }).code !== 'ENOENT') throw error
  }
  return output
}

export async function loadAppearanceSource(directory: string): Promise<AppearancePackage> {
  const source = path.resolve(directory)
  const manifest = JSON.parse(await readFile(path.join(source, 'appearance.manifest.json'), 'utf8')) as AppearanceManifest
  const tokensDocument = JSON.parse(await readFile(path.join(source, 'tokens.json'), 'utf8')) as AppearanceTokensDocument
  const themeCss = await readFile(path.join(source, 'theme.css'), 'utf8')
  return { manifest, tokensDocument, themeCss, assets: await collectAssets(path.join(source, 'assets')) }
}

export async function buildAppearanceSource(directory: string): Promise<{ archive: Uint8Array; result: AppearanceImportResult }> {
  const archive = await createAppearanceArchive(await loadAppearanceSource(directory))
  return { archive, result: await parseAppearanceArchive(archive) }
}

export async function checkAppearanceInput(input: string): Promise<AppearanceImportResult> {
  const absolute = path.resolve(input)
  if ((await stat(absolute)).isDirectory()) return (await buildAppearanceSource(absolute)).result
  const bytes = new Uint8Array(await readFile(absolute))
  if (!isZipBytes(bytes)) {
    return {
      report: {
        valid: false, activatable: false, checkedAt: new Date().toISOString(),
        diagnostics: [{ severity: 'error', code: 'unsupported-schema-version', message: 'Only v3 .netrin-appearance archives and v3 source directories are supported.', file: absolute }],
        checks: {
          archiveSafety: 'failed', schema: 'not-run', declaredFiles: 'not-run', checksums: 'not-run', safeAssets: 'not-run', tokens: 'not-run', tokenReferences: 'not-run', tokenTypes: 'not-run', contrast: 'not-run', touchTargets: 'not-run', cssSafety: 'not-run', cssScope: 'not-run', externalResources: 'not-run', compatibility: 'not-run', reducedMotion: 'not-run', mapAttribution: 'not-run'
        }
      }
    }
  }
  return parseAppearanceArchive(bytes)
}
