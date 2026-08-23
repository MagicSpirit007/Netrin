import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../components/core/Button'
import type { CommunityRouteDetail, DownloadedRoute } from '../data/types'
import { buildOfflinePackageMeta } from '../data/offlinePackage'
import {
  packageNeedsRedownloadPrompt,
  planOfflineSaveSource,
  toDownloadedRoute,
  type RemoteRouteDetailState
} from '../data/useRouteDetail'

export type RouteDetailOfflinePackageProps = {
  route: CommunityRouteDetail
  remoteRoute?: CommunityRouteDetail
  remoteStatus: RemoteRouteDetailState
  existingDownload?: DownloadedRoute
  isDownloaded: boolean
  onDownload: (route: DownloadedRoute) => void
  onStartGuide: () => void
}

/** Lazy-loaded offline save and guidance actions (keeps RouteDetailScreen chunk within budget). */
export function RouteDetailOfflinePackage({
  route,
  remoteRoute,
  remoteStatus,
  existingDownload,
  isDownloaded,
  onDownload,
  onStartGuide
}: RouteDetailOfflinePackageProps) {
  const { t } = useTranslation()
  const [offlineNotice, setOfflineNotice] = useState('')
  const [savingOffline, setSavingOffline] = useState(false)
  const needsRedownload = packageNeedsRedownloadPrompt(existingDownload, remoteRoute?.updatedAt)

  const saveOffline = async () => {
    if (savingOffline) return

    const plan = planOfflineSaveSource({
      hasExistingDownload: Boolean(existingDownload),
      existingIsLocalEdited: existingDownload?.isLocalEdited === true,
      packageStale: needsRedownload,
      remoteAvailable: Boolean(remoteRoute)
    })
    if (plan.requiresLocalEditConfirm && !window.confirm(t('routeDetail.confirmOverwriteLocalEdits'))) {
      return
    }

    const source = plan.useRemote && remoteRoute ? remoteRoute : route
    if (!source.geometry) {
      setOfflineNotice(t('routeDetail.geometryPending'))
      return
    }

    setSavingOffline(true)
    setOfflineNotice('')
    try {
      const offlinePackage = buildOfflinePackageMeta(source)
      const remoteUpdatedAt =
        remoteRoute?.updatedAt ?? existingDownload?.remoteUpdatedAt ?? source.updatedAt

      onDownload(
        toDownloadedRoute(source, {
          existing: existingDownload,
          offlinePackage,
          remoteUpdatedAt,
          preserveLocalEdits: !plan.useRemote
        })
      )
      setOfflineNotice(t('routeDetail.offlineTextSaved'))
    } finally {
      setSavingOffline(false)
    }
  }

  return (
    <div className="route-detail__actions" data-appearance-slot="route-actions">
      {needsRedownload ? (
        <p className="route-detail__stale-warn" role="status">
          {t('routeDetail.offlineStalePrompt')}
          {remoteStatus.phase === 'checking' ? ` ${t('routeDetail.remoteChecking')}` : null}
        </p>
      ) : null}

      {route.geometry ? (
        <div className="rec-grid">
          <Button variant="dark" icon="download" disabled={savingOffline} onClick={() => void saveOffline()}>
            {isDownloaded ? t('routeDetail.refreshOffline') : t('routeDetail.saveOffline')}
          </Button>
          <Button variant="solid" icon="play" onClick={onStartGuide}>
            {t('routeDetail.startGuide')}
          </Button>
        </div>
      ) : (
        <p className="quiet">{t('routeDetail.geometryPending')}</p>
      )}
      {offlineNotice ? <p className="quiet" role="status">{offlineNotice}</p> : null}
    </div>
  )
}

export default RouteDetailOfflinePackage
