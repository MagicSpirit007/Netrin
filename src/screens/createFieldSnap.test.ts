import { describe, expect, it } from 'vitest'
import type { RecordedPoint } from '../data/types'
import {
  applyUseRawGps,
  consumeManualCorrectionOnSave,
  type FieldPointComposer
} from './createFieldSnap'

function point(overrides: Partial<RecordedPoint> = {}): RecordedPoint {
  return {
    id: 'p1',
    index: 1,
    raw: [120.1, 30.2],
    final: [120.1001, 30.2001],
    snapped: true,
    text: '',
    media: [],
    ...overrides
  }
}

function composer(overrides: Partial<FieldPointComposer> = {}): FieldPointComposer {
  return {
    point: point(),
    originalPhotoIds: [],
    isNew: true,
    pendingManualCorrection: false,
    ...overrides
  }
}

describe('field snap manual correction helpers', () => {
  it('switches final to raw and marks a pending correction without recording yet', () => {
    const next = applyUseRawGps(composer())
    expect(next.point.final).toEqual([120.1, 30.2])
    expect(next.point.snapped).toBe(false)
    expect(next.pendingManualCorrection).toBe(true)
  })

  it('records manual correction only once on save after a raw-GPS undo', () => {
    const pending = applyUseRawGps(composer())
    const first = consumeManualCorrectionOnSave(pending)
    expect(first.shouldRecordManualCorrection).toBe(true)
    expect(first.composer.pendingManualCorrection).toBe(false)

    const second = consumeManualCorrectionOnSave(first.composer)
    expect(second.shouldRecordManualCorrection).toBe(false)
  })

  it('does not count cancel-equivalent state without pending flag', () => {
    const neverCorrected = consumeManualCorrectionOnSave(composer({ pendingManualCorrection: false }))
    expect(neverCorrected.shouldRecordManualCorrection).toBe(false)
  })
})
