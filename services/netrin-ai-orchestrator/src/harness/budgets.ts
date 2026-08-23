import { AiRouteError } from '../errors.js'

export type RouteAgentBudgetLimits = {
  maxModelTurns: number
  maxToolCalls: number
  maxPoiSearchCalls: number
  maxFinalStops: number
  maxTotalTokens: number
  analysisTimeoutMs: number
  requestTimeoutMs: number
}

export const DEFAULT_ROUTE_AGENT_LIMITS: RouteAgentBudgetLimits = {
  // Qwen commonly verifies one POI per turn before submitting the final plan.
  // Keep a hard loop bound, but leave enough turns for up to ten stops plus repair.
  maxModelTurns: 16,
  maxToolCalls: 24,
  maxPoiSearchCalls: 12,
  maxFinalStops: 10,
  // Multimodal/file inputs are replayed on tool continuations, so cumulative
  // usage can legitimately exceed one context's input size by several times.
  maxTotalTokens: 96_000,
  analysisTimeoutMs: 60_000,
  requestTimeoutMs: 90_000
}

export type RouteAgentBudgetSnapshot = {
  modelTurns: number
  toolCalls: number
  poiSearchCalls: number
  totalTokens: number
  exhausted: boolean
}

export class RouteAgentBudget {
  readonly limits: RouteAgentBudgetLimits
  #modelTurns = 0
  #toolCalls = 0
  #poiSearchCalls = 0
  #totalTokens = 0
  #exhausted = false

  constructor(limits: RouteAgentBudgetLimits = DEFAULT_ROUTE_AGENT_LIMITS) {
    this.limits = limits
  }

  consumeModelTurn(): void {
    this.#modelTurns += 1
    this.#assert(this.#modelTurns <= this.limits.maxModelTurns)
  }

  consumeToolCall(name: string, searchUnits = 1): void {
    this.#toolCalls += 1
    if (name === 'search_pois') this.#poiSearchCalls += searchUnits
    this.#assert(
      this.#toolCalls <= this.limits.maxToolCalls &&
      this.#poiSearchCalls <= this.limits.maxPoiSearchCalls
    )
  }

  consumeTokens(tokens: number): void {
    if (!Number.isFinite(tokens) || tokens <= 0) return
    this.#totalTokens += Math.round(tokens)
    this.#assert(this.#totalTokens <= this.limits.maxTotalTokens)
  }

  assertFinalStopCount(count: number): void {
    this.#assert(Number.isInteger(count) && count >= 2 && count <= this.limits.maxFinalStops)
  }

  snapshot(): RouteAgentBudgetSnapshot {
    return {
      modelTurns: this.#modelTurns,
      toolCalls: this.#toolCalls,
      poiSearchCalls: this.#poiSearchCalls,
      totalTokens: this.#totalTokens,
      exhausted: this.#exhausted
    }
  }

  #assert(condition: boolean): void {
    if (condition) return
    this.#exhausted = true
    throw new AiRouteError('AI_BUDGET_EXHAUSTED', 422)
  }
}

export function combineAbortSignals(
  source: AbortSignal | undefined,
  timeoutMs: number
): { signal: AbortSignal; dispose: () => void } {
  const timeout = AbortSignal.timeout(timeoutMs)
  const signal = source ? AbortSignal.any([source, timeout]) : timeout
  return { signal, dispose: () => undefined }
}
