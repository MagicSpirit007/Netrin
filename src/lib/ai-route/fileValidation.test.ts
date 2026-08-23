import { zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import {
  AiFileInputError,
  detectFileKind,
  inspectDocxArchive,
  normalizeExtractedText
} from './fileValidation'
import { assertPdfPageLimit } from './filePreprocess'

describe('AI file safety preprocessing', () => {
  it('cross-checks extension, MIME, and magic bytes', () => {
    expect(detectFileKind('route.pdf', 'application/pdf', new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])))
      .toBe('pdf')
    expect(() => detectFileKind('route.pdf', 'application/pdf', new Uint8Array([0x50, 0x4b, 0x03, 0x04])))
      .toThrowError(expect.objectContaining({ code: 'AI_FILE_MAGIC_MISMATCH' }))
    expect(() => detectFileKind('route.exe', 'application/octet-stream', new Uint8Array([0x4d, 0x5a])))
      .toThrowError(expect.objectContaining({ code: 'AI_FILE_TYPE_NOT_ALLOWED' }))
    expect(() => detectFileKind('route.png', 'image/png', new Uint8Array([0x89, 0x50, 0x4e, 0x47])))
      .toThrowError(expect.objectContaining({ code: 'AI_FILE_TYPE_NOT_ALLOWED' }))
    expect(() => detectFileKind('route.jpg', 'image/jpeg', new Uint8Array([0xff, 0xd8, 0xff])))
      .toThrowError(expect.objectContaining({ code: 'AI_FILE_TYPE_NOT_ALLOWED' }))
    expect(() => detectFileKind('route.webp', 'image/webp', new Uint8Array([0x52, 0x49, 0x46, 0x46])))
      .toThrowError(expect.objectContaining({ code: 'AI_FILE_TYPE_NOT_ALLOWED' }))
  })

  it('accepts a real DOCX-shaped ZIP and rejects a compression bomb declaration', () => {
    const valid = zipSync({
      '[Content_Types].xml': new TextEncoder().encode('<Types/>'),
      'word/document.xml': new TextEncoder().encode('<document>route</document>')
    })
    expect(inspectDocxArchive(valid.buffer as ArrayBuffer).entries).toBe(2)

    const bomb = new Uint8Array(valid)
    const central = bomb.findIndex((_value, index) =>
      bomb[index] === 0x50 && bomb[index + 1] === 0x4b && bomb[index + 2] === 0x01 && bomb[index + 3] === 0x02)
    new DataView(bomb.buffer).setUint32(central + 24, 30 * 1024 * 1024, true)
    expect(() => inspectDocxArchive(bomb.buffer)).toThrowError(
      expect.objectContaining<Partial<AiFileInputError>>({ code: 'AI_FILE_ARCHIVE_UNSAFE' })
    )
  })

  it('normalizes and deterministically clips extracted text to 100,000 characters', () => {
    const result = normalizeExtractedText([`A\r\n${'x'.repeat(120_000)}`])
    expect(result.length).toBe(100_000)
    expect(result.startsWith('A\n')).toBe(true)
  })

  it('enforces the 30-page text-layer PDF limit', () => {
    expect(() => assertPdfPageLimit(30)).not.toThrow()
    expect(() => assertPdfPageLimit(31)).toThrowError(expect.objectContaining({ code: 'AI_PDF_PAGE_LIMIT' }))
  })

})
