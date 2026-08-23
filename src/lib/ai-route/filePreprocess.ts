import { AI_ROUTE_FILE_LIMITS } from './contracts'
import {
  AiFileInputError,
  detectFileKind,
  inspectDocxArchive,
  normalizeExtractedText,
  validateInputFileLimits
} from './fileValidation'

export type FileProcessingProgress = {
  stage: 'validating' | 'extracting' | 'complete'
  completed: number
  total: number
  fileName?: string
}

export type ProcessedAiFiles = {
  extractedText: string
  sourceFiles: Array<{ displayName: string; mediaType: string; byteSize: number }>
  warnings: string[]
}

export type FilePreprocessOptions = {
  signal?: AbortSignal
  onProgress?: (progress: FileProcessingProgress) => void
}

export function assertPdfPageLimit(pageCount: number): void {
  if (pageCount > AI_ROUTE_FILE_LIMITS.maxPdfPages) {
    throw new AiFileInputError('AI_PDF_PAGE_LIMIT')
  }
}

async function extractDocxText(buffer: ArrayBuffer, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./docxPreprocess.worker.ts', import.meta.url), { type: 'module' })
    const timeout = window.setTimeout(() => {
      worker.terminate()
      reject(new AiFileInputError('AI_TIMEOUT'))
    }, 30_000)
    const abort = () => {
      worker.terminate()
      reject(new DOMException('Aborted', 'AbortError'))
    }
    signal?.addEventListener('abort', abort, { once: true })
    worker.onmessage = (event: MessageEvent<{ ok: boolean; text?: string; code?: string }>) => {
      window.clearTimeout(timeout)
      signal?.removeEventListener('abort', abort)
      worker.terminate()
      if (event.data.ok) resolve(event.data.text ?? '')
      else reject(new AiFileInputError(event.data.code ?? 'AI_FILE_ARCHIVE_UNSAFE'))
    }
    worker.onerror = () => {
      window.clearTimeout(timeout)
      signal?.removeEventListener('abort', abort)
      worker.terminate()
      reject(new AiFileInputError('AI_FILE_ARCHIVE_UNSAFE'))
    }
    worker.postMessage(buffer, [buffer])
  })
}

async function extractPdfText(
  buffer: ArrayBuffer,
  options: FilePreprocessOptions
): Promise<{ text: string[]; ignoredImagePages: number }> {
  const [pdfjs, workerModule] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url')
  ])
  pdfjs.GlobalWorkerOptions.workerSrc = workerModule.default
  const loading = pdfjs.getDocument({ data: new Uint8Array(buffer) })
  const abort = () => loading.destroy()
  options.signal?.addEventListener('abort', abort, { once: true })
  try {
    const document = await loading.promise
    assertPdfPageLimit(document.numPages)
    const text: string[] = []
    let ignoredImagePages = 0
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      options.signal?.throwIfAborted()
      const page = await document.getPage(pageNumber)
      const content = await page.getTextContent()
      const pageText = content.items
        .flatMap((item) => 'str' in item ? [item.str] : [])
        .join(' ')
        .trim()
      if (pageText) text.push(pageText)
      else ignoredImagePages += 1
    }
    if (!text.length) throw new AiFileInputError('AI_PDF_TEXT_LAYER_REQUIRED')
    return { text, ignoredImagePages }
  } finally {
    options.signal?.removeEventListener('abort', abort)
    await loading.destroy().catch(() => undefined)
  }
}

export async function preprocessAiFiles(
  files: readonly File[],
  options: FilePreprocessOptions
): Promise<ProcessedAiFiles> {
  validateInputFileLimits(files)
  options.onProgress?.({ stage: 'validating', completed: 0, total: files.length })
  const text: string[] = []
  const warnings: string[] = []

  for (let index = 0; index < files.length; index += 1) {
    options.signal?.throwIfAborted()
    const file = files[index]
    options.onProgress?.({
      stage: 'extracting',
      completed: index,
      total: files.length,
      fileName: file.name
    })
    const buffer = await file.arrayBuffer()
    const bytes = new Uint8Array(buffer)
    const kind = detectFileKind(file.name, file.type, bytes.slice(0, 1_024))
    if (kind === 'text') {
      try {
        text.push(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
      } catch {
        throw new AiFileInputError('AI_FILE_MAGIC_MISMATCH')
      }
    } else if (kind === 'docx') {
      inspectDocxArchive(buffer)
      text.push(await extractDocxText(buffer, options.signal))
    } else {
      const pdf = await extractPdfText(buffer, options)
      text.push(...pdf.text)
      if (pdf.ignoredImagePages) {
        warnings.push(`AI_PDF_IMAGE_PAGES_IGNORED:${pdf.ignoredImagePages}`)
      }
    }
  }

  const extractedText = normalizeExtractedText(text)
  if (!extractedText) throw new AiFileInputError('AI_REQUEST_INVALID')
  options.onProgress?.({ stage: 'complete', completed: files.length, total: files.length })
  return {
    extractedText,
    sourceFiles: files.map((file) => ({
      displayName: file.name.normalize('NFC').slice(0, 160),
      mediaType: file.type || 'application/octet-stream',
      byteSize: file.size
    })),
    warnings
  }
}
