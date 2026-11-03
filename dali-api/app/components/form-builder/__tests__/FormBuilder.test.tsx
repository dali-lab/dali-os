import { describe, expect, it } from 'vitest'
import { buildQuestion, repairQuestions } from '../FormBuilder'
import type { Question } from '~/types'

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
      maxWordsEnabled: true,
      maxWordsValue: '100',
    })
    expect(q.data.label).toBe('Tell us about yourself')
    expect(q.data.description).toBe('Keep it brief.')
    expect(q.data.maxWords).toBe(100)
  })
})

describe('buildQuestion (info rows)', () => {
  const body = [{ type: 'paragraph', content: 'Read this first.' }]

  it('keeps the body of an info row', () => {
    const q = buildQuestion({ key: 'i1', type: 'info', required: false, label: '', body })
    expect(q.data.body).toEqual(body)
  })

  it('drops body on non-info types', () => {
    const q = buildQuestion({ key: 'q1', type: 'text', required: true, label: 'Name', body })
    expect(q.data.body).toBeUndefined()
  })
})

describe('buildQuestion (new question types)', () => {
  const base = { key: 'q1', required: true, label: 'Pick one' }

  it('keeps radio options and allowOther', () => {
    const q = buildQuestion({ ...base, type: 'radio', optionsText: 'A\n\nB\n', allowOther: true })
    expect(q.data.options).toEqual(['A', 'B'])
    expect(q.data.allowOther).toBe(true)
  })

  it('omits allowOther when off', () => {
    const q = buildQuestion({ ...base, type: 'radio', optionsText: 'A\nB', allowOther: false })
    expect(q.data.allowOther).toBeUndefined()
  })

  it('keeps allowOther on checkbox', () => {
    const q = buildQuestion({ ...base, type: 'checkbox', optionsText: 'A\nB', allowOther: true })
    expect(q.data.allowOther).toBe(true)
  })

  it('drops allowOther from a dropdown', () => {
    const q = buildQuestion({ ...base, type: 'select', optionsText: 'A\nB', allowOther: true })
    expect(q.data.allowOther).toBeUndefined()
  })

  it('keeps options when a dropdown becomes multiple choice and back', () => {
    const asSelect = buildQuestion({ ...base, type: 'select', optionsText: 'A\nB' })
    const asRadio = buildQuestion({ ...base, type: 'radio', optionsText: asSelect.data.options!.join('\n') })
    const backToSelect = buildQuestion({ ...base, type: 'select', optionsText: asRadio.data.options!.join('\n') })
    expect(backToSelect.data.options).toEqual(['A', 'B'])
  })

  it('keeps scale labels, trimmed, and drops blanks', () => {
    const q = buildQuestion({ ...base, type: 'scale', scaleLow: ' Not at all ', scaleHigh: '  ' })
    expect(q.data.scaleLow).toBe('Not at all')
    expect(q.data.scaleHigh).toBeUndefined()
    expect(q.data.options).toBeUndefined()
  })

  it('keeps number min and max from text or numbers, including zero and negatives', () => {
    expect(buildQuestion({ ...base, type: 'number', minValue: '0', maxValue: '10.5' }).data).toMatchObject({
      min: 0,
      max: 10.5,
    })
    expect(buildQuestion({ ...base, type: 'number', minValue: -3, maxValue: 3 }).data).toMatchObject({
      min: -3,
      max: 3,
    })
  })

  it('drops blank or unparseable number bounds', () => {
    const q = buildQuestion({ ...base, type: 'number', minValue: '', maxValue: 'abc' })
    expect(q.data.min).toBeUndefined()
    expect(q.data.max).toBeUndefined()
  })

  it('date and email carry no extra settings', () => {
    for (const type of ['date', 'email'] as const) {
      const q = buildQuestion({
        ...base,
        type,
        optionsText: 'A',
        allowOther: true,
        scaleLow: 'x',
        minValue: '1',
      })
      expect(JSON.parse(JSON.stringify(q.data))).toEqual({ label: 'Pick one' })
    }
  })

  it('drops number and scale settings when the type changes away', () => {
    const q = buildQuestion({ ...base, type: 'text', scaleLow: 'x', scaleHigh: 'y', minValue: '1', maxValue: '2' })
    expect(q.data.scaleLow).toBeUndefined()
    expect(q.data.min).toBeUndefined()
    expect(q.data.max).toBeUndefined()
  })

  it('round trips every new field through JSON', () => {
    const questions = [
      buildQuestion({ ...base, type: 'radio', optionsText: 'A\nB', allowOther: true }),
      buildQuestion({ ...base, type: 'scale', scaleLow: 'Low', scaleHigh: 'High' }),
      buildQuestion({ ...base, type: 'number', minValue: '1', maxValue: '9' }),
      buildQuestion({ ...base, type: 'date' }),
      buildQuestion({ ...base, type: 'email' }),
    ]
    const roundTripped = JSON.parse(JSON.stringify(questions))
    expect(roundTripped[0].data).toMatchObject({ options: ['A', 'B'], allowOther: true })
    expect(roundTripped[1].data).toMatchObject({ scaleLow: 'Low', scaleHigh: 'High' })
    expect(roundTripped[2].data).toMatchObject({ min: 1, max: 9 })
    expect(roundTripped[3].type).toBe('date')
    expect(roundTripped[4].type).toBe('email')
  })
})

describe('buildQuestion (show rule)', () => {
  const showIf = { questionKey: 'a', op: 'includes', value: 'Design' } as const

  it('carries the rule onto the rebuilt question', () => {
    const q = buildQuestion({ key: 'q2', type: 'text', required: true, label: 'Portfolio', showIf })
    expect(q.data.showIf).toEqual(showIf)
  })

  it('survives a rebuild from the question it produced', () => {
    const first = buildQuestion({ key: 'q2', type: 'radio', required: true, label: 'Pick', optionsText: 'A\nB', showIf })
    const again = buildQuestion({
      key: first.key,
      type: first.type,
      required: first.required,
      label: first.data.label,
      optionsText: first.data.options!.join('\n'),
      showIf: first.data.showIf,
    })
    expect(again).toEqual(first)
  })

  it('leaves no rule when none is given', () => {
    const q = buildQuestion({ key: 'q2', type: 'text', required: false, label: 'Name' })
    expect(q.data.showIf).toBeUndefined()
  })
})

describe('repairQuestions', () => {
  const q = (key: string, label: string) =>
    ({ key, type: 'text', required: false, data: { label } }) as Question

  it('drops later questions that repeat a key, keeping order', () => {
    const out = repairQuestions([q('a', 'A'), q('b', 'B'), q('a', 'A copy'), q('c', 'C'), q('b', 'B copy')])
    expect(out.map((x) => x.data.label)).toEqual(['A', 'B', 'C'])
  })

  it('drops empty entries and keys questions that have none', () => {
    const out = repairQuestions([{} as Question, { ...q('', 'No key') }, q('a', 'A')])
    expect(out).toHaveLength(2)
    expect(out[0].data.label).toBe('No key')
    expect(out[0].key).toMatch(/^q-\d+-0$/)
    expect(out[1].key).toBe('a')
  })
})
