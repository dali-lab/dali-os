import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { ApiError, api, errorMessage } from '../api/client';
import type { ExpenseOptionsResponse, ExpenseSummary } from '../api/contract';

interface ExpensesContextValue {
  options: ExpenseOptionsResponse | null;
  /** False until the options load, and for good when the server 404s (flag off). */
  available: boolean;
  expenses: ExpenseSummary[] | null;
  error: string | null;
  loadOptions: () => Promise<void>;
  loadExpenses: () => Promise<void>;
  reset: () => void;
}

const ExpensesContext = createContext<ExpensesContextValue | null>(null);

export function ExpensesProvider({ children }: { children: React.ReactNode }) {
  const [options, setOptions] = useState<ExpenseOptionsResponse | null>(null);
  const [expenses, setExpenses] = useState<ExpenseSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadOptions = useCallback(async () => {
    try {
      setOptions(await api.expenseOptions());
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 404)) setError(errorMessage(err));
      setOptions(null);
    }
  }, []);

  const loadExpenses = useCallback(async () => {
    try {
      const res = await api.expenses();
      setExpenses(res.expenses);
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  const reset = useCallback(() => {
    setOptions(null);
    setExpenses(null);
    setError(null);
  }, []);

  const value = useMemo(
    () => ({ options, available: options !== null, expenses, error, loadOptions, loadExpenses, reset }),
    [options, expenses, error, loadOptions, loadExpenses, reset],
  );
  return <ExpensesContext.Provider value={value}>{children}</ExpensesContext.Provider>;
}

export function useExpenses() {
  const ctx = useContext(ExpensesContext);
  if (!ctx) throw new Error('useExpenses must be used inside ExpensesProvider');
  return ctx;
}
