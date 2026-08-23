import { describe, expect, it, vi } from 'vitest'
import { APPEARANCE_REVIEW_CHECKS } from '../../appearance/review-report'
import { validateAppearanceApproval } from '../../appearance/review-gate-core'
import type { AppearanceCatalogItem, DataResult } from '../data/moderation'
import { installAppearanceCatalogItem } from './catalog'
import { APPEARANCE_REVIEW_ROUTES, REQUIRED_APPEARANCE_SCREENS } from './contract'
import { createAppearanceArchive, parseAppearanceArchive, sha256Hex } from './packageFormat'
import { createDefaultTokenDocument } from './tokenCompiler'
import type { AppearancePackage, AppearanceReviewReport } from './types'

const submissionId = '00000000-0000-4000-8000-000000000099'
const arrayBuffer = (bytes: Uint8Array): ArrayBuffer => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
function fixturePackage(): AppearancePackage {
  return {
    manifest: {
      schemaVersion: 3, packageFormat: 'netrin-appearance-zip', interfaceContractVersion: 2,
      id: 'temporary-v3-flow-fixture', displayName: 'Temporary v3 flow fixture', summary: 'Ephemeral integration evidence.',
      version: '0.0.1', type: 'skin', author: 'Test runner', license: 'MIT', compatibility: { minAppVersion: '0.1.1' },
      entrypoints: { tokens: 'tokens.json', theme: 'theme.css' }, assets: [], files: []
    },
    tokensDocument: createDefaultTokenDocument(),
    themeCss: '[data-appearance-hook="button"] { box-shadow: var(--shadow-hard); }'
  }
}

function review(sha256: string): AppearanceReviewReport {
  return {
    schemaVersion: 1, packageId: 'temporary-v3-flow-fixture', packageVersion: '0.0.1', packageSha256: sha256,
    appVersion: '0.1.1', interfaceContractVersion: 2, generatedAt: '2026-08-13T00:00:00.000Z',
    checks: Object.fromEntries(APPEARANCE_REVIEW_CHECKS.map((name) => [name, 'passed'])) as AppearanceReviewReport['checks'],
    screenshots: REQUIRED_APPEARANCE_SCREENS.flatMap((screenId) => (['zh-CN', 'en'] as const).map((locale) => ({
      screenId, route: APPEARANCE_REVIEW_ROUTES[screenId], locale,
      viewport: { width: 390, height: 844 }, reducedMotion: true,
      file: `screenshots/${screenId}-${locale}.png`, sha256: 'b'.repeat(64)
    }))), diagnostics: []
  }
}

describe('submission -> approval -> catalog -> anonymous verified install', () => {
  it('publishes only after approval and rejects tampered download bytes', async () => {
    const archive = await createAppearanceArchive(fixturePackage())
    const digest = await sha256Hex(archive)
    let status = 'pending'
    const catalog = (): AppearanceCatalogItem[] => status === 'approved' ? [{
      id: submissionId, packageId: 'temporary-v3-flow-fixture', packageVersion: '0.0.1', displayName: 'Temporary v3 flow fixture',
      summary: 'Ephemeral integration evidence.', declaredAuthor: 'Test runner', license: 'MIT', sha256: digest,
      bytes: archive.byteLength, updatedAt: '2026-08-13T00:00:00.000Z'
    }] : []
    expect(catalog()).toEqual([])
    const gated = await validateAppearanceApproval(submissionId, review(digest), {
      loadSubmission: async () => ({
        id: submissionId, packageId: 'temporary-v3-flow-fixture', packageVersion: '0.0.1', packageSha256: digest,
        storagePath: 'temporary/fixture.netrin-appearance', moderationStatus: status
      }),
      download: async () => archive,
      audit: async (bytes) => {
        const parsed = await parseAppearanceArchive(bytes)
        return { manifest: parsed.package!.manifest, report: parsed.report }
      }
    })
    expect(gated.ok).toBe(true)
    status = 'approved'
    expect(catalog()).toHaveLength(1)

    const install = vi.fn(async (blob: Blob) => parseAppearanceArchive(new Uint8Array(await blob.arrayBuffer())))
    const anonymousDownload = async (): Promise<DataResult<Blob>> => ({
      ok: true, data: new Blob([arrayBuffer(archive)], { type: 'application/vnd.netrin.appearance+zip' })
    })
    const installed = await installAppearanceCatalogItem(catalog()[0], {
      download: anonymousDownload,
      inspect: async (blob) => parseAppearanceArchive(new Uint8Array(await blob.arrayBuffer())),
      install
    })
    expect(installed.ok).toBe(true)
    expect(await sha256Hex(new Uint8Array(await (await anonymousDownload() as { ok: true; data: Blob }).data.arrayBuffer()))).toBe(digest)

    const tampered = new Uint8Array(archive.length + 1)
    tampered.set(archive)
    tampered[tampered.length - 1] = 1
    const writeTampered = vi.fn(async (blob: Blob) => parseAppearanceArchive(new Uint8Array(await blob.arrayBuffer())))
    const rejected = await installAppearanceCatalogItem(catalog()[0], {
      download: async () => ({ ok: true, data: new Blob([arrayBuffer(tampered)]) }),
      inspect: async (blob) => parseAppearanceArchive(new Uint8Array(await blob.arrayBuffer())),
      install: writeTampered
    })
    expect(rejected.ok).toBe(false)
    expect(writeTampered).not.toHaveBeenCalled()
  })
})
