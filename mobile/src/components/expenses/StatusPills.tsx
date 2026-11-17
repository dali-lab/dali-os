import React from 'react';
import { View } from 'react-native';
import { tw } from '../../theme';
import type { ExpenseStatus, ExpenseSummary } from '../../api/contract';
import { Tag, type TagTone } from '../ui/Tag';

const STATUS: Record<ExpenseStatus, { label: string; tone: TagTone }> = {
  DRAFT: { label: 'Draft', tone: 'neutral' },
  SUBMITTED: { label: 'Submitted', tone: 'blue' },
  RETURNED: { label: 'Returned', tone: 'amber' },
  APPROVED: { label: 'Approved', tone: 'green' },
  PAID: { label: 'Paid', tone: 'violet' },
};

export function StatusPills({ expense }: { expense: Pick<ExpenseSummary, 'status' | 'matched' | 'noReceipt'> }) {
  const s = STATUS[expense.status];
  return (
    <View style={tw`flex-row flex-wrap items-center gap-1.5`}>
      <Tag tone={s.tone} size="sm">
        {s.label}
      </Tag>
      {expense.matched ? (
        <Tag tone="green" size="sm">
          Matched
        </Tag>
      ) : null}
      {expense.noReceipt ? (
        <Tag tone="rose" size="sm">
          No receipt
        </Tag>
      ) : null}
    </View>
  );
}

export function formatMoney(total: string | null): string {
  if (total === null || total === '') return '';
  const n = Number(total);
  return Number.isFinite(n) ? `$${n.toFixed(2)}` : `$${total}`;
}
