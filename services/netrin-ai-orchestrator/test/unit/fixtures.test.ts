import { describe, expect, it } from 'vitest'
import { AI_ROUTE_FIXTURES } from '../fixtures/cases.js'

describe('AI route fixture catalog', () => {
  it('covers prompt, text-file, and security evaluation groups', () => {
    expect(AI_ROUTE_FIXTURES).toHaveLength(13)
    expect(Object.fromEntries(
      ['prompt', 'file', 'security'].map((group) => [
        group,
        AI_ROUTE_FIXTURES.filter((fixture) => fixture.group === group).length
      ])
    )).toEqual({
      prompt: 4,
      file: 5,
      security: 4
    })
  })
})
