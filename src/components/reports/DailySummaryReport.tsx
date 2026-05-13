import React, { useEffect, useState } from 'react';
import { useCashupStore } from '@/store/cashupStore';
import { CurrencyDisplay } from '@/components/ui/CashupUI';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from '@/components/ui/table';
import { Download } from 'lucide-react';
import { format } from 'date-fns';
import type { DailyCashup } from '@/types/cashup';
import { supabase } from '@/integrations/supabase/client';
import { parseDayEndReportMetrics, type DayEndReportMetrics } from '@/lib/cashierBalanceMetrics';

interface Props {
  filterMonth: string;
}

function computeDaySummary(c: DailyCashup, report?: DayEndReportMetrics | null) {
  const shopIncome = report?.shopIncome ?? c.shop.income;
  const optIncome = report?.optIncome ?? c.opt.income;
  const totalIncome = shopIncome + optIncome;

  const shopReturnsYest = c.shop.returns;
  const optReturnsYest = c.opt.returns;
  const totalReturnsYest = shopReturnsYest + optReturnsYest;

  const shopReturnsToday = c.shop.returns_today;
  const optReturnsToday = c.opt.returns_today;
  const totalReturnsToday = shopReturnsToday + optReturnsToday;

  const netSales = totalIncome - totalReturnsYest - totalReturnsToday;

  const payoutsTotal = c.shop.payouts.reduce((s, p) => s + p.amount, 0);
  const lottoPayouts = c.shop.lottoPayouts;
  const totalPayouts = payoutsTotal + lottoPayouts;

  const totalReceipts = c.shop.receipts.reduce((s, r) => s + r.amount, 0);

  const cashBanking = c.shop.cashDepositedBanking;
  const easyPay = c.shop.easyPay;
  const coins = c.shop.coins;
  const cashConnectTotal = cashBanking + easyPay + coins;

  // Separate V Plus from other speedpoints
  const shopSPExVPlus = c.shop.speedpoints
    .filter(sp => sp.terminal !== 'V Plus')
    .reduce((s, sp) => s + (sp.shopAmount || 0), 0);
  const optSPExVPlus = c.opt.speedpoints
    .filter(sp => sp.terminal !== 'V Plus')
    .reduce((s, sp) => s + (sp.optAmount || 0), 0);
  const totalSpeedpoints = shopSPExVPlus + optSPExVPlus;

  const shopVPlus = c.shop.speedpoints
    .filter(sp => sp.terminal === 'V Plus')
    .reduce((s, sp) => s + (sp.shopAmount || 0), 0);
  const optVPlus = c.opt.speedpoints
    .filter(sp => sp.terminal === 'V Plus')
    .reduce((s, sp) => s + (sp.optAmount || 0), 0);
  const totalVPlus = shopVPlus + optVPlus;

  const shopAccounts = c.shop.accounts.reduce((s, a) => s + a.amount, 0);
  const optAccounts = c.opt.accounts.reduce((s, a) => s + a.amount, 0);
  const totalAccounts = shopAccounts + optAccounts;

  const manualOtherAdj = c.shop.otherAdjustments.reduce((s, a) => s + a.amount, 0);
  const returnsMop = c.shop.returns_mop;
  const returnsNotCaptured = c.shop.returnsNotCaptured ?? 0;
  const attendantShortOver = c.shop.attendantShortOver;
  const extraAttendant = (c.shop.extraAttendantShortOvers ?? []).reduce((s, r) => s + (r.amount || 0), 0);
  const extraCustomer = (c.shop.extraCustomerToPays ?? []).reduce((s, r) => s + (r.amount || 0), 0);
  const extraCustomerEFT = (c.shop.extraCustomerPaidEFTs ?? []).reduce((s, r) => s + (r.amount || 0), 0);
  const customerToPay = c.shop.customerToPay ?? 0;
  const customerPaidEFT = c.shop.customerPaidEFT ?? 0;
  const totalOtherAdj =
    manualOtherAdj + returnsMop + returnsNotCaptured + attendantShortOver + customerToPay + customerPaidEFT + extraAttendant + extraCustomer + extraCustomerEFT;

  const shopSP = shopSPExVPlus + shopVPlus;
  const optSP = optSPExVPlus + optVPlus;

  const shopNetSales = c.shop.income - c.shop.returns - c.shop.returns_today;
  const shopTakings = shopNetSales - payoutsTotal - lottoPayouts + totalReceipts;
  const shopBalance =
    shopTakings -
    cashConnectTotal -
    shopSP -
    shopAccounts -
    manualOtherAdj -
    returnsMop -
    returnsNotCaptured -
    attendantShortOver -
    customerToPay -
    customerPaidEFT -
    extraAttendant -
    extraCustomer -
    extraCustomerEFT;

  const optNetSales = c.opt.income - c.opt.returns;
  const optBalance = optNetSales - optSP - optAccounts;

  const combinedShortOver = shopBalance + optBalance;

  return {
    date: c.date,
    cashier: c.cashierName,
    totalIncome,
    totalReturnsYest,
    totalReturnsToday,
    netSales,
    totalPayouts,
    totalReceipts,
    cashBanking,
    easyPay,
    coins,
    totalSpeedpoints,
    totalVPlus,
    totalAccounts,
    totalOtherAdj,
    shortOver: combinedShortOver,
  };
}

export function DailySummaryReport({ filterMonth }: Props) {
  const { cashups } = useCashupStore();
  const monthCashups = cashups.filter(c => c.month === filterMonth).sort((a, b) => a.date.localeCompare(b.date));

  const rows = monthCashups.map(computeDaySummary);

  const totals = rows.reduce(
    (acc, r) => {
      (Object.keys(acc) as (keyof typeof acc)[]).forEach(k => {
        acc[k] += r[k as keyof typeof r] as number;
      });
      return acc;
    },
    {
      totalIncome: 0, totalReturnsYest: 0, totalReturnsToday: 0, netSales: 0,
      totalPayouts: 0, totalReceipts: 0,
      cashBanking: 0, easyPay: 0, coins: 0,
      totalSpeedpoints: 0, totalVPlus: 0, totalAccounts: 0, totalOtherAdj: 0,
      shortOver: 0,
    }
  );

  const monthLabel = format(new Date(filterMonth + '-01'), 'MMMM yyyy');
  const formatDate = (d: string) => { try { return format(new Date(d), 'dd MMM'); } catch { return d; } };

  const exportCSV = () => {
    const headers = ['Date', 'Cashier', 'Income', 'Returns (Yest)', 'Returns (Today)', 'Net Sales', 'Payouts', 'Receipts', 'Banking', 'EasyPay', 'Coins', 'Speedpoints', 'V Plus', 'Accounts', 'Other Adj', 'Short/Over'];
    const csvRows = rows.map(r => [
      r.date, r.cashier, r.totalIncome, r.totalReturnsYest, r.totalReturnsToday, r.netSales,
      r.totalPayouts, r.totalReceipts, r.cashBanking, r.easyPay, r.coins,
      r.totalSpeedpoints, r.totalVPlus, r.totalAccounts, r.totalOtherAdj, r.shortOver,
    ].join(','));
    const csv = [headers.join(','), ...csvRows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `daily-summary-${filterMonth}.csv`; a.click();
  };

  return (
    <div className="bg-card border rounded-lg overflow-x-clip">
      <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/30">
        <h3 className="font-semibold text-sm">Daily Cashier Summary — {monthLabel}</h3>
        <Button size="sm" variant="outline" onClick={exportCSV}>
          <Download className="h-3.5 w-3.5 mr-1" />Export CSV
        </Button>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="text-xs whitespace-nowrap">Date</TableHead>
              <TableHead className="text-xs whitespace-nowrap">Cashier</TableHead>
              <TableHead className="text-xs text-right whitespace-nowrap">Income</TableHead>
              <TableHead className="text-xs text-right whitespace-nowrap">Returns (Yest)</TableHead>
              <TableHead className="text-xs text-right whitespace-nowrap">Returns (Today)</TableHead>
              <TableHead className="text-xs text-right whitespace-nowrap font-bold">Net Sales</TableHead>
              <TableHead className="text-xs text-right whitespace-nowrap">Payouts</TableHead>
              <TableHead className="text-xs text-right whitespace-nowrap">Receipts</TableHead>
              <TableHead className="text-xs text-right whitespace-nowrap">Banking</TableHead>
              <TableHead className="text-xs text-right whitespace-nowrap">EasyPay</TableHead>
              <TableHead className="text-xs text-right whitespace-nowrap">Coins</TableHead>
              <TableHead className="text-xs text-right whitespace-nowrap">Speedpoints</TableHead>
              <TableHead className="text-xs text-right whitespace-nowrap">V Plus</TableHead>
              <TableHead className="text-xs text-right whitespace-nowrap">Accounts</TableHead>
              <TableHead className="text-xs text-right whitespace-nowrap">Other Adj</TableHead>
              <TableHead className="text-xs text-right whitespace-nowrap">Short/Over</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow><TableCell colSpan={16} className="text-center text-muted-foreground py-8">No cashup data for this month</TableCell></TableRow>
            )}
            {rows.map(r => (
              <TableRow key={r.date}>
                <TableCell className="text-xs whitespace-nowrap">{formatDate(r.date)}</TableCell>
                <TableCell className="text-xs whitespace-nowrap">{r.cashier}</TableCell>
                <TableCell className="text-right"><CurrencyDisplay value={r.totalIncome} /></TableCell>
                <TableCell className="text-right"><CurrencyDisplay value={r.totalReturnsYest} /></TableCell>
                <TableCell className="text-right"><CurrencyDisplay value={r.totalReturnsToday} /></TableCell>
                <TableCell className="text-right"><CurrencyDisplay value={r.netSales} highlight /></TableCell>
                <TableCell className="text-right"><CurrencyDisplay value={r.totalPayouts} /></TableCell>
                <TableCell className="text-right"><CurrencyDisplay value={r.totalReceipts} /></TableCell>
                <TableCell className="text-right"><CurrencyDisplay value={r.cashBanking} /></TableCell>
                <TableCell className="text-right"><CurrencyDisplay value={r.easyPay} /></TableCell>
                <TableCell className="text-right"><CurrencyDisplay value={r.coins} /></TableCell>
                <TableCell className="text-right"><CurrencyDisplay value={r.totalSpeedpoints} /></TableCell>
                <TableCell className="text-right"><CurrencyDisplay value={r.totalVPlus} /></TableCell>
                <TableCell className="text-right"><CurrencyDisplay value={r.totalAccounts} /></TableCell>
                <TableCell className="text-right"><CurrencyDisplay value={r.totalOtherAdj} /></TableCell>
                <TableCell className="text-right"><CurrencyDisplay value={r.shortOver} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
          {rows.length > 0 && (
            <TableFooter>
              <TableRow className="font-bold">
                <TableCell className="text-xs">Totals</TableCell>
                <TableCell />
                <TableCell className="text-right"><CurrencyDisplay value={totals.totalIncome} highlight /></TableCell>
                <TableCell className="text-right"><CurrencyDisplay value={totals.totalReturnsYest} highlight /></TableCell>
                <TableCell className="text-right"><CurrencyDisplay value={totals.totalReturnsToday} highlight /></TableCell>
                <TableCell className="text-right"><CurrencyDisplay value={totals.netSales} highlight /></TableCell>
                <TableCell className="text-right"><CurrencyDisplay value={totals.totalPayouts} highlight /></TableCell>
                <TableCell className="text-right"><CurrencyDisplay value={totals.totalReceipts} highlight /></TableCell>
                <TableCell className="text-right"><CurrencyDisplay value={totals.cashBanking} highlight /></TableCell>
                <TableCell className="text-right"><CurrencyDisplay value={totals.easyPay} highlight /></TableCell>
                <TableCell className="text-right"><CurrencyDisplay value={totals.coins} highlight /></TableCell>
                <TableCell className="text-right"><CurrencyDisplay value={totals.totalSpeedpoints} highlight /></TableCell>
                <TableCell className="text-right"><CurrencyDisplay value={totals.totalVPlus} highlight /></TableCell>
                <TableCell className="text-right"><CurrencyDisplay value={totals.totalAccounts} highlight /></TableCell>
                <TableCell className="text-right"><CurrencyDisplay value={totals.totalOtherAdj} highlight /></TableCell>
                <TableCell className="text-right"><CurrencyDisplay value={totals.shortOver} highlight /></TableCell>
              </TableRow>
            </TableFooter>
          )}
        </Table>
      </div>
    </div>
  );
}
