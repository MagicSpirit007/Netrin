import { describe, expect, it } from 'vitest'
import { AiRouteError } from '../../src/errors.js'
import { RouteAgentBudget } from '../../src/harness/budgets.js'
import { RouteAgentStateMachine } from '../../src/harness/stateMachine.js'

describe('route agent budgets and state', () => {
  it('deterministically rejects tool budget overflow', () => {
    const budget = new RouteAgentBudget({
      maxModelTurns: 1,
      maxToolCalls: 1,
      maxPoiSearchCalls: 1,
      maxFinalStops: 2,
      maxTotalTokens: 10,
      analysisTimeoutMs: 100,
      requestTimeoutMs: 100
    })
    budget.consumeToolCall('search_pois')
    expect(() => budget.consumeToolCall('get_poi_details')).toThrowError(
      expect.objectContaining({ code: 'AI_BUDGET_EXHAUSTED' })
    )
    expect(budget.snapshot().exhausted).toBe(true)
  })

  it('rejects illegal state transitions', () => {
    const machine = new RouteAgentStateMachine()
    expect(() => machine.transition('route_planned')).toThrow(AiRouteError)
  })
})
