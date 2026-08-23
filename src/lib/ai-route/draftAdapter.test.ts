import { describe, expect, it } from 'vitest'
import { createAiRouteDraft } from './draftAdapter'

const analyze = {
  requestId: 'a1',
  harnessVersion: 'h1',
  promptVersion: 'p1',
  inputSummary: { kind: 'prompt' as const, sourceRefs: [] },
  normalizedConstraints: {
    region: '杭州市',
    travelMode: 'walking' as const,
    maximumStops: 4
  },
  candidates: [],
  proposedOrder: ['a', 'b'],
  warnings: []
}

const plan = {
  requestId: 'p1',
  stops: [
    { candidateId: 'a', name: '西湖', reason: '湖滨观察', wgs84: [120.14, 30.25] as [number, number] },
    { candidateId: 'b', name: '植物园', reason: '植物观察', wgs84: [120.12, 30.26] as [number, number] }
  ],
  geometryCandidate: {
    type: 'LineString' as const,
    coordinates: [[120.14, 30.25], [120.12, 30.26]] as [number, number][]
  },
  geometrySource: 'amap-planned' as const,
  distanceMeters: 2400,
  walkingOrCyclingMinutes: 35,
  totalEstimatedMinutes: 110,
  warnings: [],
  canConfirmGeometry: true
}

describe('AI route draft adapter', () => {
  it('keeps geometry pending until explicit user confirmation', () => {
    const draft = createAiRouteDraft({
      draftId: 'ai-1',
      title: '杭州植物路线',
      analyze,
      plan,
      confirmGeometry: false,
      now: '2026-07-29T00:00:00.000Z'
    })
    expect(draft.version).toBe(5)
    expect(draft.authoringMode).toBe('ai')
    expect(draft.geometryStatus).toBe('pending')
    expect(draft.geometry).toBeUndefined()
    expect(draft.geometryCandidate?.source).toBe('amap-planned')
    expect(draft.points[0].raw).toEqual([120.14, 30.25])
    expect(JSON.stringify(draft)).not.toContain('apiKey')
    expect(JSON.stringify(draft)).not.toContain('deepseek')
  })

  it('confirms only trusted AMap geometry after an explicit action', () => {
    const draft = createAiRouteDraft({
      draftId: 'ai-2',
      title: '杭州植物路线',
      analyze,
      plan,
      confirmGeometry: true
    })
    expect(draft.geometryStatus).toBe('confirmed')
    expect(draft.geometrySource).toBe('amap-planned')
  })

  it('persists only a safe file-name provenance summary', () => {
    const fileDraft = createAiRouteDraft({
      draftId: 'ai-file',
      title: 'route',
      analyze: {
        ...analyze,
        inputSummary: { kind: 'file', sourceRefs: [{ kind: 'file', displayName: 'route.pdf' }] }
      },
      plan,
      confirmGeometry: false
    })
    expect(fileDraft.aiProvenance?.sourceRefs).toEqual([{ kind: 'file-name', label: 'route.pdf' }])
  })
})
