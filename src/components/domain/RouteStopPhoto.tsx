import { useEffect, useState } from 'react'
import { loadMediaBlob } from '../../data/drafts'
import type { ActiveStop } from '../../data/types'

type RouteStopPhotoProps = {
  stop?: ActiveStop
  alt: string
  className?: string
}

export function RouteStopPhoto({ stop, alt, className = '' }: RouteStopPhotoProps) {
  const [storedUrl, setStoredUrl] = useState('')
  const firstMedia = stop?.media[0]
  const remoteUrl = firstMedia?.url ?? stop?.photoUrl
  const storedPhotoId = firstMedia?.photoId ?? stop?.photoId

  useEffect(() => {
    let active = true
    let objectUrl = ''
    setStoredUrl('')
    if (!storedPhotoId) return () => undefined

    loadMediaBlob(storedPhotoId).then((blob) => {
      if (!active || !blob) return
      objectUrl = URL.createObjectURL(blob)
      setStoredUrl(objectUrl)
    })

    return () => {
      active = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [storedPhotoId])

  const src = storedUrl || remoteUrl
  return src ? <img className={className} src={src} alt={alt} loading="lazy" /> : null
}
