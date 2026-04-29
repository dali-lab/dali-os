import { describe, expect, it } from 'vitest'
import { buildQuestion } from '../ChallengeBuilder'

describe('buildQuestion (form builder save logic)', () => {
  const base = {
    key: 'q1',
    type: 'textarea' as const,
    required: false,
    label: 'Tell us about yourself',
  }

  it('persists maxWords when textarea has the limit enabled with a positive integer', () => {
    const q = buildQuestion({ ...base, maxWordsEnabled: true, maxWordsValue: '200' })
    expect(q.data.maxWords).toBe(200)
  })

  it('omits maxWords when the limit checkbox is off', () => {
    const q = buildQuestion({ ...base, maxWordsEnabled: false, maxWordsValue: '200' })
    expect(q.data.maxWords).toBeUndefined()
  })

  it('omits maxWords on non-textarea question types even when enabled', () => {
    const q = buildQuestion({
      ...base,
      type: 'text',
      maxWordsEnabled: true,
      maxWordsValue: '200',
    })
    expect(q.data.maxWords).toBeUndefined()
  })

  it('round-trips an existing maxWords value through edit without losing it', () => {
    const original = buildQuestion({ ...base, maxWordsEnabled: true, maxWordsValue: 150 })
    const rebuilt = buildQuestion({
      ...base,
      maxWordsEnabled: original.data.maxWords !== undefined,
      maxWordsValue:
        original.data.maxWords !== undefined ? String(original.data.maxWords) : '',
    })
    expect(rebuilt.data.maxWords).toBe(150)
  })

  it('treats empty / non-positive / non-integer values as disabled', () => {
    const empty = buildQuestion({ ...base, maxWordsEnabled: true, maxWordsValue: '' })
    expect(empty.data.maxWords).toBeUndefined()

    const zero = buildQuestion({ ...base, maxWordsEnabled: true, maxWordsValue: '0' })
    expect(zero.data.maxWords).toBeUndefined()

    const negative = buildQuestion({ ...base, maxWordsEnabled: true, maxWordsValue: '-5' })
    expect(negative.data.maxWords).toBeUndefined()

    const fractional = buildQuestion({ ...base, maxWordsEnabled: true, maxWordsValue: '12.5' })
    expect(fractional.data.maxWords).toBeUndefined()

    const garbage = buildQuestion({ ...base, maxWordsEnabled: true, maxWordsValue: 'abc' })
    expect(garbage.data.maxWords).toBeUndefined()
  })

  it('still preserves other data fields alongside maxWords', () => {
    const q = buildQuestion({
      ...base,
      description: 'Keep it brief.',
      showForRoles: ['developer'],
      maxWordsEnabled: true,
      maxWordsValue: '100',
    })
    expect(q.data.label).toBe('Tell us about yourself')
    expect(q.data.description).toBe('Keep it brief.')
    expect(q.data.showForRoles).toEqual(['developer'])
    expect(q.data.maxWords).toBe(100)
  })
})
