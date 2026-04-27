import { create } from 'zustand';
import type { DailyCashup, ManagerDailyEntry, MonthlyBranchFigures } from '@/types/cashup';
import { v4 as uuidv4 } from 'uuid';
import { supabase } from '@/integrations/supabase/client';

// ── helpers: camelCase ↔ snake_case mappers ──

function cashupToRow(c: DailyCashup) {
  return {
    id: c.id,
    date: c.date,
    month: c.month,
    entered_by: c.enteredBy,
    shop_shift_number: c.shopShiftNumber,
    opt_shift_number: c.optShiftNumber,
    cashier_name: c.cashierName,
    shop: c.shop as unknown,
    opt: c.opt as unknown,
    notes: c.notes,
    locked: c.locked,
  };
}

function rowToCashup(r: Record<string, unknown>): DailyCashup {
  const shop = r.shop as DailyCashup['shop'];
  // Ensure new fields default to 0 for old records
  if (shop && shop.deepFrozenCC === undefined) shop.deepFrozenCC = 0;
  return {
    id: r.id as string,
    date: r.date as string,
    month: r.month as string,
    enteredBy: r.entered_by as string,
    shopShiftNumber: r.shop_shift_number as number,
    optShiftNumber: r.opt_shift_number as number,
    cashierName: r.cashier_name as string,
    shop,
    opt: r.opt as DailyCashup['opt'],
    notes: r.notes as string,
    locked: r.locked as boolean,
  };
}

function managerToRow(e: ManagerDailyEntry) {
  return {
    id: e.id,
    date: e.date,
    cashup_id: e.cashupId,
    entered_by: e.enteredBy,
    explanations: e.explanations,
    payout_invoices: e.payoutInvoices as unknown,
    eft_invoices: e.eftInvoices as unknown,
    coins_opening_balance: e.coinsOpeningBalance,
    easypay_opening_balance: e.easypayOpeningBalance,
    cash_connect_opening_balance: e.cashConnectOpeningBalance,
    daily_coins: e.dailyCoins,
    cash_deposited_easypay: e.cashDepositedEasypay,
    cash_deposited_cash_connect: e.cashDepositedCashConnect,
    cc_bag_closure_coins: e.ccBagClosureCoins,
    cc_bag_closure_easypay: e.ccBagClosureEasypay,
    cc_bag_closure_cash_connect: e.ccBagClosureCashConnect,
    transfer_from_coins: e.transferFromCoins,
    branch_day_end_total: e.branchDayEndTotal,
    branch_day_end_vat: e.branchDayEndVat,
    invoice_notes: e.invoiceNotes,
    cash_reconc_notes: e.cashReconcNotes,
    bank_charges_rate: e.bankChargesRate,
    bank_charges: e.bankCharges,
    banking: e.banking,
    deep_frozen_cc: e.deepFrozenCC,
    blue_label_comm: e.blueLabelComm,
    easypay_comm: e.easypayComm,
    lotto_comm: e.lottoComm,
    lotto_net_sales_comm: e.lottoNetSalesComm,
    lotto_payout_comm: e.lottoPayoutComm,
    locked: e.locked,
  };
}

function rowToManager(r: Record<string, unknown>): ManagerDailyEntry {
  return {
    id: r.id as string,
    date: r.date as string,
    cashupId: r.cashup_id as string,
    enteredBy: r.entered_by as string,
    explanations: r.explanations as string,
    payoutInvoices: (r.payout_invoices ?? []) as ManagerDailyEntry['payoutInvoices'],
    eftInvoices: (r.eft_invoices ?? []) as ManagerDailyEntry['eftInvoices'],
    coinsOpeningBalance: Number(r.coins_opening_balance ?? 0),
    easypayOpeningBalance: Number(r.easypay_opening_balance ?? 0),
    cashConnectOpeningBalance: Number(r.cash_connect_opening_balance ?? 0),
    dailyCoins: Number(r.daily_coins ?? 0),
    cashDepositedEasypay: Number(r.cash_deposited_easypay ?? 0),
    cashDepositedCashConnect: Number(r.cash_deposited_cash_connect ?? 0),
    ccBagClosureCoins: Number(r.cc_bag_closure_coins ?? 0),
    ccBagClosureEasypay: Number(r.cc_bag_closure_easypay ?? 0),
    ccBagClosureCashConnect: Number(r.cc_bag_closure_cash_connect ?? 0),
    transferFromCoins: Number(r.transfer_from_coins ?? 0),
    branchDayEndTotal: Number(r.branch_day_end_total ?? 0),
    branchDayEndVat: Number(r.branch_day_end_vat ?? 0),
    invoiceNotes: r.invoice_notes as string,
    cashReconcNotes: r.cash_reconc_notes as string,
    bankChargesRate: Number(r.bank_charges_rate ?? 37.9),
    bankCharges: Number(r.bank_charges ?? 0),
    banking: Number(r.banking ?? 0),
    deepFrozenCC: Number(r.deep_frozen_cc ?? 0),
    blueLabelComm: Number(r.blue_label_comm ?? 0),
    easypayComm: Number(r.easypay_comm ?? 0),
    lottoComm: Number(r.lotto_comm ?? 0),
    lottoNetSalesComm: Number(r.lotto_net_sales_comm ?? 0),
    lottoPayoutComm: Number(r.lotto_payout_comm ?? 0),
    locked: r.locked as boolean,
  };
}

function monthlyToRow(f: MonthlyBranchFigures) {
  return {
    id: f.id,
    month: f.month,
    entered_by: f.enteredBy,
    branch_net_sales: f.branchNetSales,
    branch_total_payouts: f.branchTotalPayouts,
    branch_total_receipts: f.branchTotalReceipts,
    branch_total_invoices_capital: f.branchTotalInvoicesCapital,
    branch_total_invoices_vat: f.branchTotalInvoicesVat,
    sales_c_store: f.salesCStore,
    sales_wsl_dsl: f.salesWslDsl,
    sales_fuel: f.salesFuel,
    sales_gas: f.salesGas,
    sales_oil: f.salesOil,
    adj_c_store: f.adjCStore,
    adj_wsl_dsl: f.adjWslDsl,
    adj_fuel: f.adjFuel,
    adj_gas: f.adjGas,
    adj_oil: f.adjOil,
    adj_vat: f.adjVat,
    vat_tax_amount: f.vatTaxAmount,
    explanation_net_sales: f.explanationNetSales,
    explanation_payouts: f.explanationPayouts,
    explanation_receipts: f.explanationReceipts,
    explanation_invoices: f.explanationInvoices,
    explanation_vat: f.explanationVat,
    notes: f.notes,
    airtime_bld_balance: f.airtimeBldBalance,
    airtime_easypay_balance: f.airtimeEasypayBalance,
    airtime_lotto_balance: f.airtimeLottoBalance,
  };
}

function rowToMonthly(r: Record<string, unknown>): MonthlyBranchFigures {
  return {
    id: r.id as string,
    month: r.month as string,
    enteredBy: r.entered_by as string,
    branchNetSales: Number(r.branch_net_sales ?? 0),
    branchTotalPayouts: Number(r.branch_total_payouts ?? 0),
    branchTotalReceipts: Number(r.branch_total_receipts ?? 0),
    branchTotalInvoicesCapital: Number(r.branch_total_invoices_capital ?? 0),
    branchTotalInvoicesVat: Number(r.branch_total_invoices_vat ?? 0),
    salesCStore: Number(r.sales_c_store ?? 0),
    salesWslDsl: Number(r.sales_wsl_dsl ?? 0),
    salesFuel: Number(r.sales_fuel ?? 0),
    salesGas: Number(r.sales_gas ?? 0),
    salesOil: Number(r.sales_oil ?? 0),
    adjCStore: Number(r.adj_c_store ?? 0),
    adjWslDsl: Number(r.adj_wsl_dsl ?? 0),
    adjFuel: Number(r.adj_fuel ?? 0),
    adjGas: Number(r.adj_gas ?? 0),
    adjOil: Number(r.adj_oil ?? 0),
    adjVat: Number(r.adj_vat ?? 0),
    vatTaxAmount: Number(r.vat_tax_amount ?? 0),
    explanationNetSales: (r.explanation_net_sales as string) ?? '',
    explanationPayouts: (r.explanation_payouts as string) ?? '',
    explanationReceipts: (r.explanation_receipts as string) ?? '',
    explanationInvoices: (r.explanation_invoices as string) ?? '',
    explanationVat: (r.explanation_vat as string) ?? '',
    notes: r.notes as string,
    airtimeBldBalance: Number(r.airtime_bld_balance ?? 0),
    airtimeEasypayBalance: Number(r.airtime_easypay_balance ?? 0),
    airtimeLottoBalance: Number(r.airtime_lotto_balance ?? 0),
  };
}

// ── Store ──

interface CashupStore {
  cashups: DailyCashup[];
  managerEntries: ManagerDailyEntry[];
  monthlyFigures: MonthlyBranchFigures[];
  loaded: boolean;

  // Init
  loadAll: () => Promise<void>;

  // Cashier actions
  addCashup: (cashup: Omit<DailyCashup, 'id'>) => Promise<string>;
  updateCashup: (id: string, cashup: Partial<DailyCashup>) => Promise<void>;
  deleteCashup: (id: string) => Promise<void>;
  getCashupByDate: (date: string) => DailyCashup | undefined;

  // Manager daily actions
  addManagerEntry: (entry: Omit<ManagerDailyEntry, 'id'>) => Promise<string>;
  updateManagerEntry: (id: string, entry: Partial<ManagerDailyEntry>) => Promise<void>;
  getManagerEntryByDate: (date: string) => ManagerDailyEntry | undefined;

  // Monthly actions
  addMonthlyFigures: (figures: Omit<MonthlyBranchFigures, 'id'>) => Promise<string>;
  updateMonthlyFigures: (id: string, figures: Partial<MonthlyBranchFigures>) => Promise<void>;
  getMonthlyFiguresByMonth: (month: string) => MonthlyBranchFigures | undefined;
}

export const useCashupStore = create<CashupStore>()((set, get) => ({
  cashups: [],
  managerEntries: [],
  monthlyFigures: [],
  loaded: false,

  loadAll: async () => {
    const [cashRes, manRes, monRes] = await Promise.all([
      supabase.from('daily_cashups').select('*').order('date'),
      supabase.from('manager_daily_entries').select('*').order('date'),
      supabase.from('monthly_branch_figures').select('*').order('month'),
    ]);
    set({
      cashups: (cashRes.data ?? []).map(r => rowToCashup(r as Record<string, unknown>)),
      managerEntries: (manRes.data ?? []).map(r => rowToManager(r as Record<string, unknown>)),
      monthlyFigures: (monRes.data ?? []).map(r => rowToMonthly(r as Record<string, unknown>)),
      loaded: true,
    });
  },

  addCashup: async (cashup) => {
    const id = uuidv4();
    const full = { ...cashup, id } as DailyCashup;
    set((s) => ({ cashups: [...s.cashups, full] }));
    await supabase.from('daily_cashups').insert(cashupToRow(full) as never);
    return id;
  },
  updateCashup: async (id, cashup) => {
    set((s) => ({ cashups: s.cashups.map((c) => (c.id === id ? { ...c, ...cashup } : c)) }));
    const updated = get().cashups.find(c => c.id === id);
    if (updated) await supabase.from('daily_cashups').update(cashupToRow(updated) as never).eq('id', id);
  },
  deleteCashup: async (id) => {
    set((s) => ({ cashups: s.cashups.filter((c) => c.id !== id) }));
    await supabase.from('daily_cashups').delete().eq('id', id);
  },
  getCashupByDate: (date) => get().cashups.find((c) => c.date === date),

  addManagerEntry: async (entry) => {
    const id = uuidv4();
    const full = { ...entry, id } as ManagerDailyEntry;
    set((s) => ({ managerEntries: [...s.managerEntries, full] }));
    await supabase.from('manager_daily_entries').insert(managerToRow(full) as never);
    return id;
  },
  updateManagerEntry: async (id, entry) => {
    set((s) => ({ managerEntries: s.managerEntries.map((e) => (e.id === id ? { ...e, ...entry } : e)) }));
    const updated = get().managerEntries.find(e => e.id === id);
    if (updated) await supabase.from('manager_daily_entries').update(managerToRow(updated) as never).eq('id', id);
  },
  getManagerEntryByDate: (date) => get().managerEntries.find((e) => e.date === date),

  addMonthlyFigures: async (figures) => {
    const id = uuidv4();
    const full = { ...figures, id } as MonthlyBranchFigures;
    set((s) => ({ monthlyFigures: [...s.monthlyFigures, full] }));
    await supabase.from('monthly_branch_figures').insert(monthlyToRow(full) as never);
    return id;
  },
  updateMonthlyFigures: async (id, figures) => {
    set((s) => ({ monthlyFigures: s.monthlyFigures.map((f) => (f.id === id ? { ...f, ...figures } : f)) }));
    const updated = get().monthlyFigures.find(f => f.id === id);
    if (updated) await supabase.from('monthly_branch_figures').update(monthlyToRow(updated) as never).eq('id', id);
  },
  getMonthlyFiguresByMonth: (month) => get().monthlyFigures.find((f) => f.month === month),
}));
