import { describe, expect, it } from 'vitest'
import type { AnalyzeCandidate } from '../lib/ai-route/contracts'
import { moveAiCandidate, removeAiCandidate } from './aiRouteReview'

const candidate = (candidateId: string): AnalyzeCandidate => ({
  candidateId,
  placeIntent: {
    candidateId,
    desiredName: candidateId,
    aliases: [],
    cityHint: '杭州',
    reason: 'reason',
    evidence: 'prompt',
    priority: 'preferred'
  },
  confidence: 'high',
  options: [{
    optionRef: `ref-${candidateId}`,
    poiName: candidateId,
    wgs84: [120, 30]
  }],
  selectedOptionRef: `ref-${candidateId}`,
  requiresUserChoice: false
})

describe('AI route review controls', () => {
  it('reorders candidates deterministically', () => {
    expect(moveAiCandidate(['a', 'b', 'c'].map(candidate), 2, 0).map((item) => item.candidateId))
      .toEqual(['c', 'a', 'b'])
  })

  it('allows deletion while preserving the two-stop route minimum', () => {
    const three = ['a', 'b', 'c'].map(candidate)
    const two = removeAiCandidate(three, 'b')
    expect(two.map((item) => item.candidateId)).toEqual(['a', 'c'])
    expect(removeAiCandidate(two, 'a')).toBe(two)
  })
})
