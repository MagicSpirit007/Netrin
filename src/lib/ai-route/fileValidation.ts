import { AI_ROUTE_FILE_LIMITS } from './contracts'

export const AI_ROUTE_ALLOWED_EXTENSIONS = ['pdf', 'docx', 'txt', 'md'] as const

const MIME_BY_EXTENSION: Record<string, readonly string[]> = {
  pdf: ['application/pdf'],
  docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  txt: ['text/plain'],
  md: ['text/markdown', 'text/plain']
}

export class AiFileInputError extends Error {
  readonly code: string
  constructor(code: string) {
    super(code)
    this.name = 'AiFileInputError'
    this.code = code
  }
}

export type FileKind = 'pdf' | 'docx' | 'text'

function extensionOf(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? ''
}

function startsWith(bytes: Uint8Array, expected: number[]): boolean {
  return expected.every((value, index) => bytes[index] === value)
}

export function detectFileKind(name: string, mediaType: string, bytes: Uint8Array): FileKind {
  const extension = extensionOf(name)
  if (!AI_ROUTE_ALLOWED_EXTENSIONS.includes(extension as (typeof AI_ROUTE_ALLOWED_EXTENSIONS)[number])) {
    throw new AiFileInputError('AI_FILE_TYPE_NOT_ALLOWED')
  }
  const declared = mediaType.toLowerCase().split(';', 1)[0] || 'application/octet-stream'
  if (declared !== 'application/octet-stream' && !MIME_BY_EXTENSION[extension].includes(declared)) {
    throw new AiFileInputError('AI_FILE_MAGIC_MISMATCH')
  }
  const pdf = startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])
  const zip = startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])
  if (extension === 'pdf' && pdf) return 'pdf'
  if (extension === 'docx' && zip) return 'docx'
  if (extension === 'txt' || extension === 'md') {
    if (bytes.slice(0, Math.min(bytes.length, 1_024)).some((byte) => byte === 0)) {
      throw new AiFileInputError('AI_FILE_MAGIC_MISMATCH')
    }
    return 'text'
  }
  throw new AiFileInputError('AI_FILE_MAGIC_MISMATCH')
}

export type ZipInspection = { entries: number; declaredUncompressedBytes: number }

export function inspectDocxArchive(buffer: ArrayBuffer): ZipInspection {
  const bytes = new Uint8Array(buffer)
  const view = new DataView(buffer)
  let eocd = -1
  for (let offset = Math.max(0, bytes.length - 65_557); offset <= bytes.length - 22; offset += 1) {
    if (view.getUint32(offset, true) === 0x06054b50) eocd = offset
  }
  if (eocd < 0) throw new AiFileInputError('AI_FILE_ARCHIVE_UNSAFE')
  const entries = view.getUint16(eocd + 10, true)
  const centralOffset = view.getUint32(eocd + 16, true)
  if (entries < 2 || entries > 500 || centralOffset >= bytes.length) {
    throw new AiFileInputError('AI_FILE_ARCHIVE_UNSAFE')
  }
  let offset = centralOffset
  let declaredUncompressedBytes = 0
  const names = new Set<string>()
  const decoder = new TextDecoder('utf-8', { fatal: false })
  for (let index = 0; index < entries; index += 1) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== 0x02014b50) {
      throw new AiFileInputError('AI_FILE_ARCHIVE_UNSAFE')
    }
    const compressed = view.getUint32(offset + 20, true)
    const uncompressed = view.getUint32(offset + 24, true)
    const nameLength = view.getUint16(offset + 28, true)
    const extraLength = view.getUint16(offset + 30, true)
    const commentLength = view.getUint16(offset + 32, true)
    const next = offset + 46 + nameLength + extraLength + commentLength
    if (next > bytes.length || uncompressed > 20 * 1024 * 1024 ||
        (uncompressed > 0 && (compressed === 0 || uncompressed / compressed > 100))) {
      throw new AiFileInputError('AI_FILE_ARCHIVE_UNSAFE')
    }
    declaredUncompressedBytes += uncompressed
    if (declaredUncompressedBytes > 50 * 1024 * 1024) {
      throw new AiFileInputError('AI_FILE_ARCHIVE_UNSAFE')
    }
    names.add(decoder.decode(bytes.slice(offset + 46, offset + 46 + nameLength)).replaceAll('\\', '/'))
    offset = next
  }
  if (!names.has('[Content_Types].xml') || !names.has('word/document.xml')) {
    throw new AiFileInputError('AI_FILE_MAGIC_MISMATCH')
  }
  return { entries, declaredUncompressedBytes }
}

export function validateInputFileLimits(files: readonly File[]): void {
  if (!files.length) throw new AiFileInputError('AI_REQUEST_INVALID')
  if (files.reduce((sum, file) => sum + file.size, 0) > AI_ROUTE_FILE_LIMITS.totalBytes) {
    throw new AiFileInputError('AI_FILE_LIMIT_EXCEEDED')
  }
  files.forEach((file) => {
    if (file.size > AI_ROUTE_FILE_LIMITS.documentBytes) throw new AiFileInputError('AI_FILE_TOO_LARGE')
  })
}

export function normalizeExtractedText(chunks: readonly string[]): string {
  return chunks.join('\n\n')
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(/[\t\f\v ]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, AI_ROUTE_FILE_LIMITS.maxTextChars)
}
