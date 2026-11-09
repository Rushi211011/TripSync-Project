import React, { useMemo, useState, useEffect } from 'react';
import { Download, TrendingUp, ReceiptText, Wallet, Tag, BarChart3, AlertCircle } from 'lucide-react';
import type { Expense, Participant } from '../types';
import { getConversionRates } from '../services/geminiService';

const CURRENCIES = ['USD', 'EUR', 'JPY', 'GBP', 'CAD', 'INR'];
const SYMBOLS: Record<string, string> = { USD: '$', EUR: '€', JPY: '¥', GBP: '£', CAD: '$', INR: '₹' };
const CATEGORIES = ['Accommodation', 'Food & Dining', 'Transport', 'Activities', 'Shopping', 'Flights', 'Other'];

function inferCategory(description: string): string {
  const value = description.toLowerCase();
  if (/hotel|hostel|stay|room|airbnb|resort/.test(value)) return 'Accommodation';
  if (/food|restaurant|lunch|dinner|breakfast|cafe|coffee|snack/.test(value)) return 'Food & Dining';
  if (/taxi|cab|uber|ola|train|bus|metro|fuel|petrol|transport/.test(value)) return 'Transport';
  if (/flight|airline|airport/.test(value)) return 'Flights';
  if (/museum|ticket|tour|activity|park|show/.test(value)) return 'Activities';
  if (/shop|gift|souvenir|mall/.test(value)) return 'Shopping';
  return 'Other';
}

function downloadCsv(expenses: Expense[], participants: Participant[]) {
  const rows = [['Description', 'Category', 'Amount', 'Currency', 'Paid By', 'Date'], ...expenses.map((e) => [e.description, e.category || inferCategory(e.description), String(e.amount), e.currency, participants.find(p => p.id === e.paidById)?.name || 'Unknown', e.date || 'Not recorded'])];
  const csv = rows.map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
  const link = document.createElement('a'); link.href = url; link.download = 'tripsync-expenses.csv'; link.click(); URL.revokeObjectURL(url);
}

const ExpenseAnalytics: React.FC<{ expenses: Expense[]; participants: Participant[] }> = ({ expenses, participants }) => {
  const [currency, setCurrency] = useState('USD');
  const [rates, setRates] = useState<Record<string, number> | null>({ USD: 1 });
  const [ratesError, setRatesError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    const currencies: string[] = Array.from(new Set<string>(expenses.map(e => e.currency))).filter(c => c !== currency);
    if (!currencies.length) { setRates({ [currency]: 1 }); setRatesError(''); return; }
    setLoading(true); setRatesError('');
    getConversionRates(currency, currencies).then(result => { if (active) setRates({ ...result, [currency]: 1 }); })
      .catch(error => { if (active) { setRates(null); setRatesError(error instanceof Error ? error.message : 'Could not load conversion rates.'); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [expenses, currency]);

  const analytics = useMemo(() => {
    const converted = expenses.map(expense => ({ ...expense, value: expense.amount * (expense.currency === currency ? 1 : (rates?.[expense.currency] ?? NaN)), resolvedCategory: expense.category || inferCategory(expense.description) }));
    const valid = converted.filter(e => Number.isFinite(e.value));
    const total = valid.reduce((sum, e) => sum + e.value, 0);
    const categories = new Map<string, number>();
    valid.forEach(e => categories.set(e.resolvedCategory, (categories.get(e.resolvedCategory) || 0) + e.value));
    const categoryRows = [...categories.entries()].map(([name, value]) => ({ name, value })).sort((a,b) => b.value-a.value);
    const now = new Date();
    const months = Array.from({ length: 6 }, (_, i) => new Date(now.getFullYear(), now.getMonth() - (5-i), 1));
    const monthly = months.map(month => {
      const key = `${month.getFullYear()}-${String(month.getMonth()+1).padStart(2,'0')}`;
      const value = valid.filter(e => e.date?.startsWith(key)).reduce((sum,e) => sum+e.value,0);
      return { label: month.toLocaleDateString('en-US',{month:'short'}), value };
    });
    const top = categoryRows[0];
    return { total, count: expenses.length, average: valid.length ? total / valid.length : 0, categoryRows, monthly, top, datedCount: valid.filter(e => e.date).length, validCount: valid.length };
  }, [expenses, currency, rates]);

  const money = (value: number) => `${SYMBOLS[currency]}${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const maxCategory = Math.max(...analytics.categoryRows.map(r => r.value), 1);
  const maxMonth = Math.max(...analytics.monthly.map(r => r.value), 1);

  return <div className="space-y-6">
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
      <div><h2 className="text-2xl font-bold text-neutral">Expense Analytics</h2><p className="text-sm text-slate-500 mt-1">Understand where your trip budget is going.</p></div>
      <div className="flex flex-wrap gap-2">
        <select aria-label="Analytics currency" value={currency} onChange={e => setCurrency(e.target.value)} className="px-3 py-2 rounded-lg border border-base-300 bg-white text-sm">{CURRENCIES.map(c => <option key={c}>{c}</option>)}</select>
        <button onClick={() => downloadCsv(expenses, participants)} disabled={!expenses.length} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-white font-semibold text-sm disabled:opacity-50"><Download size={16}/> Export CSV</button>
      </div>
    </div>
    {ratesError && <div className="flex gap-2 items-start rounded-lg bg-amber-50 text-amber-800 p-3 text-sm"><AlertCircle size={18}/><span>{ratesError} Analytics cannot safely combine different currencies until rates are available.</span></div>}
    {loading && <p className="text-sm text-slate-500">Loading currency conversion…</p>}
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
      <Kpi title="Total spending" value={money(analytics.total)} icon={<Wallet size={19}/>} />
      <Kpi title="Transactions" value={String(analytics.count)} icon={<ReceiptText size={19}/>} />
      <Kpi title="Average transaction" value={money(analytics.average)} icon={<TrendingUp size={19}/>} />
      <Kpi title="Highest category" value={analytics.top?.name || '—'} icon={<Tag size={19}/>} small />
    </div>
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
      <section className="bg-white rounded-2xl shadow-md p-5 sm:p-6">
        <div className="flex items-center gap-2 mb-5"><BarChart3 className="text-primary"/><h3 className="text-lg font-bold text-neutral">Category-wise spending</h3></div>
        {analytics.categoryRows.length ? <div className="space-y-4">{analytics.categoryRows.map(row => <div key={row.name}>
          <div className="flex justify-between gap-3 text-sm mb-1"><span className="font-medium text-slate-700">{row.name}</span><span className="font-semibold text-neutral">{money(row.value)}</span></div>
          <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(2, row.value/maxCategory*100)}%` }}/></div>
        </div>)}</div> : <EmptyState text="Add expenses to see category insights."/>}
      </section>
      <section className="bg-white rounded-2xl shadow-md p-5 sm:p-6">
        <div className="flex items-center gap-2 mb-5"><TrendingUp className="text-primary"/><h3 className="text-lg font-bold text-neutral">Monthly spending</h3></div>
        {analytics.datedCount ? <div className="flex items-end gap-3 h-48 pt-3">{analytics.monthly.map(month => <div key={month.label} className="flex-1 h-full flex flex-col justify-end items-center gap-2 min-w-0"><span className="text-[10px] text-slate-500 truncate">{month.value ? money(month.value) : ''}</span><div className="w-full max-w-12 rounded-t-md bg-primary/85 hover:bg-primary transition-colors" style={{ height: `${month.value ? Math.max(5, month.value/maxMonth*100) : 2}%` }} title={`${month.label}: ${money(month.value)}`}/><span className="text-xs text-slate-500">{month.label}</span></div>)}</div> : <EmptyState text="Monthly trends appear for expenses recorded with a date. New expenses will include dates automatically."/>}
        {analytics.datedCount > 0 && <p className="text-xs text-slate-400 mt-4">Based on {analytics.datedCount} dated transactions in the last six calendar months.</p>}
      </section>
    </div>
    <section className="bg-white rounded-2xl shadow-md p-5 sm:p-6">
      <h3 className="text-lg font-bold text-neutral mb-3">Spending by participant</h3>
      {participants.length && expenses.length ? <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">{participants.map(person => {
        const value = expenses.filter(e => e.paidById === person.id).reduce((sum,e) => sum + e.amount * (e.currency === currency ? 1 : (rates?.[e.currency] ?? 0)),0);
        return <div key={person.id} className="rounded-xl bg-base-100 p-4"><p className="text-sm text-slate-500">Paid by</p><p className="font-semibold text-neutral mt-1">{person.name}</p><p className="text-xl font-bold text-primary mt-2">{money(value)}</p></div>;
      })}</div> : <EmptyState text="Add participants and expenses to compare spending."/>}
    </section>
    <p className="text-xs text-slate-400">Currency conversions use the rates currently provided by the TripSync API. Treat demo-mode rates as illustrative, not live financial rates. Older expenses without dates are included in totals and categories but excluded from monthly trends.</p>
  </div>;
};

const Kpi: React.FC<{title:string;value:string;icon:React.ReactNode;small?:boolean}> = ({title,value,icon,small}) => <div className="bg-white rounded-2xl shadow-md p-5"><div className="flex items-center justify-between"><span className="text-sm text-slate-500">{title}</span><span className="text-primary bg-sky-50 rounded-lg p-2">{icon}</span></div><p className={`${small ? 'text-lg' : 'text-2xl'} font-bold text-neutral mt-3 break-words`}>{value}</p></div>;
const EmptyState: React.FC<{text:string}> = ({text}) => <div className="text-center py-12 text-sm text-slate-500">{text}</div>;
export default ExpenseAnalytics;
