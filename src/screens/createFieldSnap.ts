import type { Coordinate, RecordedPoint } from '../data/types'

/**
 * Composer flags for field GPS mark flow.
 * `pendingManualCorrection` means the author chose raw GPS after a snap; it is
 * recorded only when they save the point (not on cancel or repeat saves).
 */
export type FieldPointComposer = {
  point: RecordedPoint
  originalPhotoIds: string[]
  isNew: boolean
  pendingManualCorrection: boolean
}

/** Author chooses "use original GPS" for a snapped composer point. */
export function applyUseRawGps(composer: FieldPointComposer): FieldPointComposer {
  const raw = composer.point.raw
  return {
    ...composer,
    point: {
      ...composer.point,
      final: [raw[0], raw[1]] as Coordinate,
      snapped: false
    },
    pendingManualCorrection: true
  }
}

/**
 * On save: record a manual correction only when the author had pending raw-GPS
 * undo. Clears the flag so a second save does not double-count.
 */
export function consumeManualCorrectionOnSave(composer: FieldPointComposer): {
  shouldRecordManualCorrection: boolean
  composer: FieldPointComposer
} {
  if (!composer.pendingManualCorrection) {
    return { shouldRecordManualCorrection: false, composer }
  }
  return {
    shouldRecordManualCorrection: true,
    composer: { ...composer, pendingManualCorrection: false }
  }
}
