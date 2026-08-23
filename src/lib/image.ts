async function canvasToJpeg(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  maxDim: number,
  quality: number
): Promise<Blob> {
  const scale = Math.min(1, maxDim / Math.max(sourceWidth, sourceHeight))
  const width = Math.max(1, Math.round(sourceWidth * scale))
  const height = Math.max(1, Math.round(sourceHeight * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas 2D context unavailable')
  context.drawImage(source, 0, 0, width, height)

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Image compression failed'))),
      'image/jpeg',
      quality
    )
  })
}

export async function compressImage(
  input: File | Blob,
  maxDim = 1600,
  quality = 0.8
): Promise<Blob> {
  if ('createImageBitmap' in window) {
    try {
      const bitmap = await createImageBitmap(input, { imageOrientation: 'from-image' })
      try {
        return await canvasToJpeg(bitmap, bitmap.width, bitmap.height, maxDim, quality)
      } finally {
        bitmap.close()
      }
    } catch {
      // Fall through to the HTMLImageElement decoder for browser-specific formats.
    }
  }

  const objectUrl = URL.createObjectURL(input)
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image()
      element.onload = () => resolve(element)
      element.onerror = () => reject(new Error('Image decode failed'))
      element.src = objectUrl
    })
    return await canvasToJpeg(
      image,
      image.naturalWidth,
      image.naturalHeight,
      maxDim,
      quality
    )
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}
