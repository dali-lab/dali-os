import { useEffect } from 'react'
import { useFetcher } from 'react-router'
import { ChevronDown, Plus, X } from 'lucide-react'
import type { Question, ShowIfRule } from '~/types'
import type { ReferenceOption } from '~/forms/lib/reference-sources.shared'
import { MultiSelect, Select } from '~/components/ui/floating'
import { Segmented } from '~/components/ui/Segmented'
import { DateField } from '~/components/ui/DateField'
import { Button } from '~/components/ui/Button'
import { IconButton } from '~/components/ui/IconButton'
import { useOsChrome } from '~/components/os-chrome'
import {
  SCALE_VALUES,
  canBeSource,
  defaultCondition,
  opLabel,
  opsForSource,
  ruleOf,
  toShowIf,
  valueInput,
  valueLabel,
  valuesForSource,
  type Condition,
  type Rule,
  type ShowIfOp,
} from '~/lib/form-logic'

type Props = {
  subject: 'question' | 'page'
  questions: Question[]
  ownKey: string
  showIf: ShowIfRule | undefined
  onChange: (showIf: ShowIfRule | undefined) => void
  numbers: ReadonlyMap<string, number>
  // The feature that reads this answer (or one on this page), which keeps it shown.
  lockedBy?: string
  problem?: string
  // Loads Database list rows through forms/preview-resolve; without it those
  // questions can't be picked as a condition's source.
  formId?: string
}

export function ShowIfEditor({
  subject,
  questions,
  ownKey,
  showIf,
  onChange,
  numbers,
  lockedBy,
  problem,
  formId,
}: Props) {
  const { formTrigger } = useOsChrome()
  const own = questions.findIndex((q) => q.key === ownKey)
  const sources = questions
    .slice(0, Math.max(own, 0))
    .filter((q) => canBeSource(q) && (q.type !== 'reference' || !!formId))
  const rule = ruleOf(showIf)
  const noSources = sources.length === 0 && !rule
  const label = subject === 'page' ? 'Show this page' : 'Show this question'

  const setRule = (next: Rule | null) => onChange(next ? toShowIf(next) : undefined)
  const setCondition = (index: number, next: Condition) =>
    rule && setRule({ ...rule, conditions: rule.conditions.map((c, i) => (i === index ? next : c)) })
  const removeCondition = (index: number) => {
    if (!rule) return
    const conditions = rule.conditions.filter((_, i) => i !== index)
    setRule(conditions.length ? { ...rule, conditions } : null)
  }
  const addCondition = () =>
    rule && sources.length > 0 &&
    setRule({ ...rule, conditions: [...rule.conditions, defaultCondition(sources[sources.length - 1])] })

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-foreground/80">{label}</span>
        <Segmented
          ariaLabel={label}
          size="md"
          value={rule ? 'when' : 'always'}
          onChange={(next) =>
            setRule(
              next === 'when' && sources.length > 0
                ? { match: 'all', conditions: [defaultCondition(sources[sources.length - 1])] }
                : null,
            )
          }
          options={[
            { value: 'always', label: 'Always' },
            { value: 'when', label: 'Only when', disabled: !!lockedBy || noSources },
          ]}
        />
      </div>
      {lockedBy && (
        <p className="text-xs text-muted-foreground">
          {subject === 'page'
            ? `${lockedBy} reads an answer on this page, so the page is always shown.`
            : `${lockedBy} reads this answer, so the question is always shown.`}
        </p>
      )}
      {!lockedBy && noSources && (
        <p className="text-xs text-muted-foreground">
          There is no earlier question to depend on.
        </p>
      )}
      {rule && rule.conditions.length > 1 && (
        <div className="flex items-center gap-2 text-sm text-foreground/80">
          <span>Show when</span>
          <div className="w-24 shrink-0">
            <Select
              ariaLabel="How conditions combine"
              value={rule.match}
              onChange={(match) => setRule({ ...rule, match: match as Rule['match'] })}
              options={[
                { value: 'all', label: 'all' },
                { value: 'any', label: 'any' },
              ]}
              buttonClassName={formTrigger}
            />
          </div>
          <span>of these match</span>
        </div>
      )}
      {rule?.conditions.map((condition, index) => (
        <ConditionRow
          key={index}
          condition={condition}
          questions={questions}
          sources={sources}
          numbers={numbers}
          formId={formId}
          triggerClass={formTrigger}
          onChange={(next) => setCondition(index, next)}
          onRemove={() => removeCondition(index)}
        />
      ))}
      {rule && sources.length > 0 && (
        <Button type="button" variant="ghost" size="sm" onClick={addCondition}>
          <Plus className="w-3.5 h-3.5" />
          Add condition
        </Button>
      )}
      {problem && <p className="text-xs text-os-amber">{problem}</p>}
    </div>
  )
}

function useReferenceRows(source: Question | undefined, formId: string | undefined): Question | undefined {
  const fetcher = useFetcher<{ ok: true; questions: Question[] } | { error: string }>()
  const needsRows = source?.type === 'reference' && !source.data.referenceOptions && !!formId
  const sourceId = source ? `${source.key} ${source.data.referenceSource} ${source.data.referenceTermId ?? ''}` : ''
  useEffect(() => {
    if (!needsRows || !source || !formId) return
    const fd = new FormData()
    fd.set('formId', formId)
    fd.set('questions', JSON.stringify([source]))
    fetcher.submit(fd, { method: 'post', action: '/forms/preview-resolve' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsRows, sourceId, formId])
  if (!needsRows || !source) return source
  const rows: ReferenceOption[] | undefined =
    fetcher.data && 'questions' in fetcher.data ? fetcher.data.questions[0]?.data.referenceOptions : undefined
  return rows ? { ...source, data: { ...source.data, referenceOptions: rows } } : source
}

function ConditionRow({
  condition,
  questions,
  sources,
  numbers,
  formId,
  triggerClass,
  onChange,
  onRemove,
}: {
  condition: Condition
  questions: Question[]
  sources: Question[]
  numbers: ReadonlyMap<string, number>
  formId?: string
  triggerClass: string
  onChange: (next: Condition) => void
  onRemove: () => void
}) {
  const source = useReferenceRows(
    questions.find((q) => q.key === condition.questionKey),
    formId,
  )
  const input = source ? valueInput(source, condition.op) : 'none'
  const choices = source ? valuesForSource(source) : []
  const pickOptions = choices.map((v) => ({ value: v, label: valueLabel(source, v) }))
  const setValues = (values: string[]) =>
    onChange({
      ...condition,
      values,
      ...(source?.type === 'reference'
        ? { labels: values.map((v) => valueLabel(source, v, condition.labels?.[condition.values.indexOf(v)])) }
        : { labels: undefined }),
    })
  const setOp = (op: ShowIfOp) => {
    if (!source) return
    onChange(
      valueInput(source, op) === input
        ? { ...condition, op }
        : { ...defaultCondition(source, op), questionKey: condition.questionKey },
    )
  }

  return (
    <div className="flex items-start gap-2">
      <div className="grid min-w-0 flex-1 grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_9.5rem_11rem]">
        <div className="min-w-0">
          <Select
            ariaLabel="Question"
            value={condition.questionKey}
            onChange={(key) => {
              const next = questions.find((q) => q.key === key)
              if (next) onChange(defaultCondition(next))
            }}
            placeholder="Pick a question…"
            options={sources.map((q) => ({
              value: q.key,
              label: `Q${numbers.get(q.key)} ${q.data.label || 'Untitled question'}`,
            }))}
            buttonClassName={triggerClass}
          />
        </div>
        <div className="min-w-0">
          <Select
            ariaLabel="Condition"
            value={condition.op}
            onChange={(op) => setOp(op as ShowIfOp)}
            options={(source ? opsForSource(source) : [condition.op]).map((op) => ({
              value: op,
              label: opLabel(op, source?.type),
            }))}
            buttonClassName={triggerClass}
          />
        </div>
        {input === 'pick' && (
          <div className="min-w-0">
            <MultiSelect
              ariaLabel="Answers"
              values={condition.values}
              onChange={setValues}
              chips={false}
              renderTrigger={({ chosen }) => (
                <>
                  <span className={`min-w-0 truncate ${chosen.length === 0 ? 'text-muted-foreground' : ''}`}>
                    {chosen.length > 0
                      ? chosen.map((o) => o.label).join(', ')
                      : source?.type === 'reference' && pickOptions.length === 0
                        ? 'Loading…'
                        : 'Pick answers…'}
                  </span>
                  <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                </>
              )}
              options={
                pickOptions.length > 0 || source?.type !== 'reference'
                  ? pickOptions
                  : condition.values.map((v, i) => ({ value: v, label: valueLabel(source, v, condition.labels?.[i]) }))
              }
              buttonClassName={triggerClass}
            />
          </div>
        )}
        {input === 'pickOne' && (
          <div className="min-w-0">
            <Select
              ariaLabel="Answer"
              value={condition.values[0] ?? ''}
              onChange={(v) => setValues([v])}
              options={SCALE_VALUES.map((v) => ({ value: v, label: v }))}
              buttonClassName={triggerClass}
            />
          </div>
        )}
        {input === 'number' && (
          <input
            type="text"
            inputMode="decimal"
            aria-label="Number"
            value={condition.values[0] ?? ''}
            onChange={(e) => setValues([e.target.value.trim()])}
            className="block w-full"
            placeholder="e.g. 3"
          />
        )}
        {input === 'date' && (
          <div className="min-w-0">
            <DateField
              mode="date"
            className="w-full"
              ariaLabel="Date"
              value={condition.values[0] ?? ''}
              onChange={(v) => setValues(v ? [v] : [])}
              buttonClassName={triggerClass}
            />
          </div>
        )}
        {input === 'text' && (
          <input
            type="text"
            aria-label="Text"
            value={condition.values[0] ?? ''}
            onChange={(e) => setValues([e.target.value])}
            className="block w-full"
            placeholder="Text"
          />
        )}
        {input === 'none' && <div aria-hidden />}
      </div>
      <IconButton label="Remove condition" icon={X} onClick={onRemove} className="mt-1.5 shrink-0" />
    </div>
  )
}
