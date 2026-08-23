import { describe, expect, it } from 'vitest'
import { withRequestCredential, type RequestCredential } from '../../src/providers/credentialScope.js'
import { createOptionRef, verifyOptionRef } from '../../src/tools/optionRefs.js'

const secret = 'a-signing-secret-that-is-longer-than-32-characters'

describe('request-only credentials and signed options', () => {
  it('clears the request credential reference after completion', async () => {
    let captured: RequestCredential | undefined
    await withRequestCredential('one-use-secret', async (credential) => {
      captured = credential
      expect(credential.getApiKey()).toBe('one-use-secret')
    })
    expect(captured?.getApiKey()).toBe('')
  })

  it('binds option refs to request and candidate and expires them', () => {
    const ref = createOptionRef({
      analyzeRequestId: 'analysis-1',
      candidateId: 'candidate-1',
      poiId: 'poi-1',
      region: '杭州市'
    }, secret, 1_000, 500)
    expect(verifyOptionRef(ref, secret, {
      analyzeRequestId: 'analysis-1',
      candidateId: 'candidate-1'
    }, 1_200).poiId).toBe('poi-1')
    expect(() => verifyOptionRef(ref, secret, {
      analyzeRequestId: 'analysis-2',
      candidateId: 'candidate-1'
    }, 1_200)).toThrowError(expect.objectContaining({ code: 'AI_OPTION_REF_INVALID' }))
    expect(() => verifyOptionRef(ref, secret, {
      analyzeRequestId: 'analysis-1',
      candidateId: 'candidate-1'
    }, 1_500)).toThrowError(expect.objectContaining({ code: 'AI_OPTION_REF_EXPIRED' }))
  })
})
