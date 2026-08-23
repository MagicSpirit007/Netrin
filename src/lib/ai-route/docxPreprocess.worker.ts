/// <reference lib="webworker" />
import mammoth from 'mammoth'
import { inspectDocxArchive } from './fileValidation'

self.onmessage = async (event: MessageEvent<ArrayBuffer>) => {
  try {
    inspectDocxArchive(event.data)
    const result = await mammoth.extractRawText({ arrayBuffer: event.data })
    self.postMessage({ ok: true, text: result.value })
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error
      ? String(error.code)
      : 'AI_FILE_ARCHIVE_UNSAFE'
    self.postMessage({ ok: false, code })
  }
}
