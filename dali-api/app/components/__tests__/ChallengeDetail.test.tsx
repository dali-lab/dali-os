import { describe, expect, it } from 'vitest'
import { resolveChallengeFormDefaults, resolveDuplicateDomainId } from '../ChallengeDetail'

const engineering = { id: 'eng-id', name: 'Engineering' }
const design = { id: 'des-id', name: 'Design' }
const general = { id: 'gen-id', name: 'General' }

describe('resolveChallengeFormDefaults', () => {
  it('returns empty domainId and isGeneralForm=true for a fresh general challenge with no versions and no domainId param', () => {
    const result = resolveChallengeFormDefaults({
      domains: [general, engineering, design],
      versions: [],
      generalParam: '1',
      domainIdParam: null,
    })
    expect(result.defaultDomainId).toBe('')
    expect(result.isGeneralForm).toBe(true)
  })

  it('falls back to the first non-General domain for a fresh challenge with no general intent', () => {
    const result = resolveChallengeFormDefaults({
      domains: [general, engineering, design],
      versions: [],
      generalParam: null,
      domainIdParam: null,
    })
    expect(result.defaultDomainId).toBe('eng-id')
    expect(result.isGeneralForm).toBe(false)
  })

  it('honors an explicit domainId param when general intent is absent', () => {
    const result = resolveChallengeFormDefaults({
      domains: [general, engineering, design],
      versions: [],
      generalParam: null,
      domainIdParam: 'des-id',
    })
    expect(result.defaultDomainId).toBe('des-id')
    expect(result.isGeneralForm).toBe(false)
  })

  it('treats general intent as authoritative even when domainId is also provided', () => {
    const result = resolveChallengeFormDefaults({
      domains: [general, engineering, design],
      versions: [],
      generalParam: '1',
      domainIdParam: 'eng-id',
    })
    expect(result.defaultDomainId).toBe('')
    expect(result.isGeneralForm).toBe(true)
  })

  it('defaults to the last version domain for an existing non-general challenge', () => {
    const result = resolveChallengeFormDefaults({
      domains: [general, engineering, design],
      versions: [{ domainId: 'eng-id' }, { domainId: 'des-id' }],
      generalParam: null,
      domainIdParam: null,
    })
    expect(result.defaultDomainId).toBe('des-id')
    expect(result.isGeneralForm).toBe(false)
  })

  it('flags isGeneralForm=true when any existing version is general, even without the query flag', () => {
    const result = resolveChallengeFormDefaults({
      domains: [general, engineering, design],
      versions: [{ domainId: null }],
      generalParam: null,
      domainIdParam: null,
    })
    expect(result.isGeneralForm).toBe(true)
  })
})

describe('resolveDuplicateDomainId', () => {
  // Regression for #361: duplicating a general version (domainId === null) used
  // to leave selectedDomainId pointing at the previously-initialized non-General
  // id, silently flipping the duplicated version's domain on save.
  it("returns '' for a general version so the form falls back to General", () => {
    expect(resolveDuplicateDomainId({ domainId: null })).toBe('')
  })

  it('returns the version domainId when present (non-general path unchanged)', () => {
    expect(resolveDuplicateDomainId({ domainId: 'eng-id' })).toBe('eng-id')
  })
})
