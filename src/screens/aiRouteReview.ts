import type { AnalyzeCandidate } from '../lib/ai-route/contracts'

export function moveAiCandidate(
  items: AnalyzeCandidate[],
  from: number,
  to: number
): AnalyzeCandidate[] {
  if (to < 0 || to >= items.length || from < 0 || from >= items.length) return items
  const next = [...items]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}

export function removeAiCandidate(
  items: AnalyzeCandidate[],
  candidateId: string
): AnalyzeCandidate[] {
  return items.length <= 2 ? items : items.filter((item) => item.candidateId !== candidateId)
}
