import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Image, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AlertTriangle, CheckCircle2, ChevronDown, Undo2 } from 'lucide-react-native';
import { colors, fonts, tw } from '../../theme';
import { api, errorMessage } from '../../api/client';
import type { ExpenseDetail, ExpensePaidWith } from '../../api/contract';
import { useExpenses } from '../../contexts/ExpensesContext';
import { NavHeader } from '../NavHeader';
import { BottomSheet } from '../ui/BottomSheet';
import { Button } from '../ui/Button';
import { Eyebrow } from '../ui/Eyebrow';
import { ErrorState, LoadingState } from '../ui/StateViews';
import { Text } from '../ui/Text';
import { Toast } from '../ui/Toast';
import { formatMoney, StatusPills } from './StatusPills';

interface FormState {
  merchant: string;
  total: string;
  date: string;
  purpose: string;
  categoryId: string | null;
  paidWith: ExpensePaidWith | null;
  cardId: string | null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONEY_RE = /^\d+(\.\d{1,2})?$/;

function toForm(e: ExpenseDetail): FormState {
  return {
    merchant: e.merchant ?? '',
    total: e.total ?? '',
    date: e.purchasedAt ? e.purchasedAt.slice(0, 10) : '',
    purpose: e.purpose ?? '',
    categoryId: e.category?.id ?? null,
    paidWith: e.paidWith,
    cardId: e.card?.id ?? null,
  };
}

function changes(before: FormState, after: FormState) {
  const body: Parameters<typeof api.updateExpense>[1] = {};
  if (after.merchant !== before.merchant) body.merchant = after.merchant.trim();
  if (after.total !== before.total) body.total = after.total.trim();
  if (after.date !== before.date) body.purchasedAt = after.date;
  if (after.purpose !== before.purpose) body.purpose = after.purpose.trim();
  if (after.categoryId && after.categoryId !== before.categoryId) body.categoryId = after.categoryId;
  if (after.paidWith && (after.paidWith !== before.paidWith || after.cardId !== before.cardId)) {
    body.paidWith = after.paidWith;
    body.cardId = after.paidWith === 'STAFF_CARD' ? after.cardId : null;
  }
  return body;
}

function missing(f: FormState): string | null {
  if (!f.merchant.trim()) return 'Add the merchant.';
  if (!MONEY_RE.test(f.total.trim())) return 'Enter the total as a number, like 36.87.';
  if (!DATE_RE.test(f.date)) return 'Enter the date as YYYY-MM-DD.';
  if (!f.purpose.trim()) return 'Say what the purchase was for.';
  if (!f.categoryId) return 'Pick a category.';
  if (!f.paidWith) return 'Choose how it was paid.';
  if (f.paidWith === 'STAFF_CARD' && !f.cardId) return 'Choose which card was used.';
  return null;
}

const inputStyle = [tw`mt-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-cool-black`, { fontFamily: fonts.body }];

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={tw`mt-4`}>
      <Eyebrow>{label}</Eyebrow>
      {children}
    </View>
  );
}

export function ExpenseDetailScreen({ id, onBack }: { id: string; onBack: () => void }) {
  const insets = useSafeAreaInsets();
  const { options, loadExpenses } = useExpenses();
  const [expense, setExpense] = useState<ExpenseDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [saved, setSaved] = useState<FormState | null>(null);
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const adopt = useCallback((e: ExpenseDetail) => {
    setExpense(e);
    const f = toForm(e);
    setForm(f);
    setSaved(f);
  }, []);

  const load = useCallback(async () => {
    setError(null);
    try {
      adopt(await api.expense(id));
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [id, adopt]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!expense || !form || !saved) {
    return (
      <View style={tw`flex-1 bg-cool-white`}>
        <NavHeader title="Expense" onBack={onBack} />
        {error ? <ErrorState message={error} onRetry={() => void load()} /> : <LoadingState />}
      </View>
    );
  }

  const editable = expense.status === 'DRAFT' || expense.status === 'RETURNED';
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm({ ...form, [key]: value });
  const dirty = Object.keys(changes(saved, form)).length > 0;
  const category = options?.categories.find((c) => c.id === form.categoryId) ?? expense.category;
  const payOptions: { key: string; label: string; paidWith: ExpensePaidWith; cardId: string | null }[] = [
    ...(options?.cards ?? []).map((c) => ({ key: c.id, label: `${c.nickname} ··${c.last4}`, paidWith: 'STAFF_CARD' as const, cardId: c.id })),
    { key: 'own', label: 'Personal card', paidWith: 'OWN_CARD' as const, cardId: null },
  ];

  const save = async (): Promise<ExpenseDetail | null> => {
    const body = changes(saved, form);
    if (Object.keys(body).length === 0) return expense;
    const next = await api.updateExpense(expense.id, body);
    adopt(next);
    return next;
  };

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setProblem(null);
    try {
      await work();
    } catch (err) {
      setProblem(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const onSave = () =>
    run(async () => {
      await save();
      void loadExpenses();
      setToast('Saved');
    });

  const onSubmit = () => {
    const issue = missing(form);
    if (issue) {
      setProblem(issue);
      return;
    }
    void run(async () => {
      await save();
      adopt(await api.expenseAction(expense.id, 'submit'));
      void loadExpenses();
      setToast('Submitted for approval');
    });
  };

  const onWithdraw = () =>
    run(async () => {
      adopt(await api.expenseAction(expense.id, 'withdraw'));
      void loadExpenses();
      setToast('Moved back to draft');
    });

  const onDelete = () =>
    Alert.alert('Delete this draft?', 'The receipts are removed too.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          void run(async () => {
            await api.deleteExpense(expense.id);
            void loadExpenses();
            onBack();
          }),
      },
    ]);

  return (
    <View style={tw`flex-1 bg-cool-white`}>
      <NavHeader title={expense.merchant ?? 'Expense'} subtitle={formatMoney(expense.total) || undefined} onBack={onBack} />
      <ScrollView contentContainerStyle={[tw`px-4 pb-8 pt-4`]} keyboardShouldPersistTaps="handled">
        <StatusPills expense={expense} />

        {expense.status === 'RETURNED' && expense.decisionNote ? (
          <View style={tw`mt-3 rounded-xl bg-light-yellow/60 px-3 py-2.5`}>
            <Eyebrow>Returned with a note</Eyebrow>
            <Text style={tw`mt-1 text-sm text-cool-black`}>{expense.decisionNote}</Text>
          </View>
        ) : null}

        {expense.receipts.some((r) => r.contentType.startsWith('image/')) ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={tw`mt-4 gap-2`}>
            {expense.receipts
              .filter((r) => r.contentType.startsWith('image/'))
              .map((r, i) => (
                <Image key={r.id} source={{ uri: r.url }} accessibilityLabel={`Receipt ${i + 1}`} style={tw`h-28 w-20 rounded-lg bg-slate-100`} />
              ))}
          </ScrollView>
        ) : null}

        <Field label="Merchant">
          <TextInput
            value={form.merchant}
            onChangeText={(v) => set('merchant', v)}
            editable={editable}
            accessibilityLabel="Merchant"
            placeholderTextColor={colors.slate400}
            style={inputStyle}
          />
        </Field>

        <View style={tw`flex-row gap-3`}>
          <View style={tw`flex-1`}>
            <Field label="Total">
              <TextInput
                value={form.total}
                onChangeText={(v) => set('total', v)}
                editable={editable}
                keyboardType="decimal-pad"
                accessibilityLabel="Total"
                placeholder="0.00"
                placeholderTextColor={colors.slate400}
                style={inputStyle}
              />
            </Field>
          </View>
          <View style={tw`flex-1`}>
            <Field label="Date">
              <TextInput
                value={form.date}
                onChangeText={(v) => set('date', v)}
                editable={editable}
                accessibilityLabel="Date"
                placeholder="YYYY-MM-DD"
                placeholderTextColor={colors.slate400}
                autoCapitalize="none"
                style={inputStyle}
              />
            </Field>
          </View>
        </View>

        {expense.lineItems.length > 0 ? (
          <Field label="Line items">
            <View style={tw`mt-1.5 rounded-xl border border-slate-200 bg-white`}>
              {expense.lineItems.map((li, i) => (
                <View key={i} style={[tw`flex-row gap-3 px-3 py-2`, i > 0 && tw`border-t border-slate-100`]}>
                  <Text style={tw`flex-1 text-sm text-cool-black`}>{li.description}</Text>
                  {li.amount ? <Text style={tw`text-sm text-slate-500`}>{formatMoney(li.amount)}</Text> : null}
                </View>
              ))}
            </View>
          </Field>
        ) : null}

        <Field label="Purpose">
          <TextInput
            value={form.purpose}
            onChangeText={(v) => set('purpose', v)}
            editable={editable}
            multiline
            accessibilityLabel="Purpose"
            placeholder="What was this for?"
            placeholderTextColor={colors.slate400}
            style={[...inputStyle, { minHeight: 64, textAlignVertical: 'top' }]}
          />
        </Field>

        <Field label="Category">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Category"
            disabled={!editable}
            onPress={() => setCategoryOpen(true)}
            style={tw`mt-1.5 flex-row items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2.5`}>
            <Text style={[tw`text-sm`, category ? tw`text-cool-black` : tw`text-slate-400`]}>{category?.label ?? 'Pick a category'}</Text>
            {editable ? <ChevronDown size={16} color={colors.slate400} /> : null}
          </Pressable>
          {expense.categoryReason ? <Text style={tw`mt-1.5 text-xs text-slate-500`}>{expense.categoryReason}</Text> : null}
        </Field>

        <Field label="Paid with">
          <View style={tw`mt-1.5 flex-row flex-wrap gap-2`} accessibilityRole="radiogroup" accessibilityLabel="Paid with">
            {payOptions.map((o) => {
              const selected = form.paidWith === o.paidWith && (o.paidWith === 'OWN_CARD' || form.cardId === o.cardId);
              return (
                <Pressable
                  key={o.key}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected, disabled: !editable }}
                  disabled={!editable}
                  onPress={() => setForm({ ...form, paidWith: o.paidWith, cardId: o.cardId })}
                  style={[tw`rounded-xl border px-3 py-2.5`, selected ? tw`border-teal bg-[#E6F7F7]` : tw`border-slate-200 bg-white`]}>
                  <Text style={[tw`text-sm font-bold`, selected ? tw`text-navy` : tw`text-dark-gray`]}>{o.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </Field>

        {expense.checks.length > 0 ? (
          <Field label="Checks">
            <View style={tw`mt-1.5 gap-2`}>
              {expense.checks.map((c, i) => (
                <View key={i} style={tw`flex-row items-start gap-2`}>
                  {c.level === 'ok' ? <CheckCircle2 size={16} color={colors.green} style={tw`mt-0.5`} /> : <AlertTriangle size={16} color={colors.darkCoral} style={tw`mt-0.5`} />}
                  <Text style={tw`flex-1 text-sm text-cool-black`}>{c.message}</Text>
                </View>
              ))}
            </View>
          </Field>
        ) : null}

        {problem ? <Text style={tw`mt-4 text-sm text-coral`}>{problem}</Text> : null}

        <View style={[tw`mt-6 gap-2`, { paddingBottom: insets.bottom }]}>
          {editable ? (
            <>
              <Button fullWidth size="lg" loading={busy} onPress={onSubmit}>
                {expense.status === 'RETURNED' ? 'Resubmit' : 'Submit'}
              </Button>
              <Button fullWidth variant="outline" color="navy" disabled={!dirty || busy} onPress={() => void onSave()}>
                Save changes
              </Button>
              {expense.status === 'DRAFT' ? (
                <Button fullWidth variant="ghost" color="coral" disabled={busy} onPress={onDelete}>
                  Delete draft
                </Button>
              ) : null}
            </>
          ) : null}
          {expense.status === 'SUBMITTED' ? (
            <Button fullWidth variant="outline" color="navy" leftIcon={Undo2} loading={busy} onPress={() => void onWithdraw()}>
              Withdraw
            </Button>
          ) : null}
        </View>
      </ScrollView>

      <BottomSheet open={categoryOpen} onClose={() => setCategoryOpen(false)} title="Category">
        {(options?.categories ?? []).map((c) => {
          const selected = c.id === form.categoryId;
          return (
            <Pressable
              key={c.id}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              onPress={() => {
                set('categoryId', c.id);
                setCategoryOpen(false);
              }}
              style={({ pressed }) => [tw`flex-row items-center justify-between border-b border-slate-100 py-3`, pressed && tw`bg-slate-100`]}>
              <Text style={[tw`text-base`, selected ? tw`font-bold text-navy` : tw`text-cool-black`]}>{c.label}</Text>
              {selected ? <CheckCircle2 size={18} color={colors.teal} /> : null}
            </Pressable>
          );
        })}
      </BottomSheet>
      <Toast message={toast} onDismiss={() => setToast(null)} />
    </View>
  );
}
