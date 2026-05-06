import { useState, useEffect } from 'react';
import { useCashupStore } from '@/store/cashupStore';
import { useMasterDataStore } from '@/store/masterDataStore';
import { CurrencyDisplay } from '@/components/ui/CashupUI';
import { CheckCircle, XCircle, AlertCircle, CalendarDays, Calendar } from 'lucide-react';
import { format } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { getCashierBalanceMetrics, parseDayEndReportMetrics, type DayEndReportMetrics } from '@/lib/cashierBalanceMetrics';
import { MonthlyDashboard } from './MonthlyDashboard';

interface Props {
  selectedDate: string;
  onNavigateToDate?: (date: string) => void;
}

export function Dashboard({ selectedDate, onNavigateToDate }: Props) {
  const [view, setView] = useState<'daily' | 'monthly'>('monthly');
  const { getCashupByDate, getManagerEntryByDate } = useCashupStore();

  return (
    <div className="space-y-4">
      {/* View toggle */}
      <div className="flex gap-1 bg-muted rounded-lg p-1 w-fit">
        <button
          onClick={() => setView('monthly')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${view === 'monthly' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
        >
          <Calendar className="h-4 w-4" />
          Monthly
        </button>
        <button
          onClick={() => setView('daily')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${view === 'daily' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
        >
          <CalendarDays className="h-4 w-4" />
          Daily
        </button>
      </div>

      {view === 'monthly' ? (
        <MonthlyDashboard selectedDate={selectedDate} onNavigateToDate={onNavigateToDate} />
      ) : (
        <DailyDashboard selectedDate={selectedDate} />
      )}
    </div>
  );
}

function DailyDashboard({ selectedDate }: Props) {
  const { getCashupByDate, getManagerEntryByDate } = useCashupStore();
  const cashInTransit = useMasterDataStore(s => s.cashInTransit);
  const citLabel = cashInTransit === 'Deposita' ? 'Deposita' : 'Cash Connect';
  const cashup = getCashupByDate(selectedDate);
  const managerEntry = getManagerEntryByDate(selectedDate);

  const useDayEndPayouts = selectedDate >= "2026-03-01";
  const [reportMetrics, setReportMetrics] = useState<DayEndReportMetrics | null>(null);
  useEffect(() => {
    if (!useDayEndPayouts) { setReportMetrics(null); return; }
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from('day_end_uploads').select('content').eq('date', selectedDate).maybeSingle();
      if (cancelled) return;
      setReportMetrics(parseDayEndReportMetrics(data?.content));
    })();
    return () => { cancelled = true; };
  }, [selectedDate, useDayEndPayouts]);

  if (!cashup && !managerEntry) {
    return (
      <div className="text-center py-16">
        <div className="text-5xl mb-3">📋</div>
        <h2 className="text-xl font-bold mb-1">No data for {format(new Date(selectedDate), 'dd MMMM yyyy')}</h2>
        <p className="text-muted-foreground text-sm">Enter cashier data and manager data to see the daily dashboard.</p>
      </div>
    );
  }

  const selected = new Date(selectedDate);
  const previousDate = format(new Date(selected.getFullYear(), selected.getMonth(), selected.getDate() - 1), 'yyyy-MM-dd');
  const metrics = cashup
    ? getCashierBalanceMetrics(cashup, selectedDate, reportMetrics, getCashupByDate(previousDate))
    : null;
  const shopNetSales = metrics?.shopNetSales ?? 0;
  const optNetSales = metrics?.optNetSales ?? 0;
  const totalNetSales = metrics?.totalNetSales ?? 0;
  const shopPayoutsTotal = metrics?.shopPayoutsTotal ?? 0;
  const shopReceipts = metrics?.shopReceipts ?? 0;
  const shopTakings = metrics?.shopTakings ?? 0;
  const shopSP = metrics?.shopSP ?? 0;
  const optSP = metrics?.optSP ?? 0;
  const cashConnectTotal = metrics?.cashConnectTotal ?? 0;
  const shopDiff = metrics?.shopDiff ?? 0;
  const optDiff = metrics?.optDiff ?? 0;

  const invTotal = managerEntry
    ? managerEntry.payoutInvoices.reduce((s, i) => s + i.inclusive, 0) + managerEntry.eftInvoices.reduce((s, i) => s + i.inclusive, 0)
    : 0;
  const invVat = managerEntry
    ? managerEntry.payoutInvoices.reduce((s, i) => s + i.vat, 0) + managerEntry.eftInvoices.reduce((s, i) => s + i.vat, 0)
    : 0;
  const invMatch = managerEntry ? Math.abs(invTotal - managerEntry.branchDayEndTotal) < 0.50 : false;
  const vatMatch = managerEntry ? Math.abs(invVat - managerEntry.branchDayEndVat) < 1.00 : false;

  const shopBalanced = Math.abs(shopDiff) < 20;
  const optBalanced = Math.abs(optDiff) < 0.01;
  const allGreen = shopBalanced && optBalanced && (!managerEntry || (invMatch && vatMatch));

  interface StatusCardProps {
    label: string;
    value: React.ReactNode;
    status: 'green' | 'red' | 'pending';
    detail?: string;
  }

  const StatusCard = ({ label, value, status, detail }: StatusCardProps) => {
    const colors = {
      green: 'border-green-500 bg-green-50',
      red: 'border-red-500 bg-red-50',
      pending: 'border-amber-400 bg-amber-50',
    };
    const icons = {
      green: <CheckCircle className="h-5 w-5 text-green-600" />,
      red: <XCircle className="h-5 w-5 text-red-600" />,
      pending: <AlertCircle className="h-5 w-5 text-amber-500" />,
    };
    return (
      <div className={`rounded-xl border-2 p-4 ${colors[status]}`}>
        <div className="flex items-start justify-between">
          <div>
            <div className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{label}</div>
            <div className="mt-1 text-lg font-bold">{value}</div>
            {detail && <div className="text-xs text-muted-foreground mt-0.5">{detail}</div>}
          </div>
          <div>{icons[status]}</div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className={`rounded-2xl border-2 p-5 flex items-center gap-4 ${allGreen ? 'border-green-500 bg-green-50' : 'border-red-500 bg-red-50'}`}>
        <div className="text-4xl">{allGreen ? '🟢' : '🔴'}</div>
        <div>
          <div className="text-xl font-bold">{allGreen ? 'All Clear — Day Balanced' : 'Attention Required'}</div>
          <div className="text-sm text-muted-foreground">
            {format(new Date(selectedDate), 'EEEE, dd MMMM yyyy')} — {cashup?.cashierName}
          </div>
        </div>
        <div className="ml-auto text-right">
          <div className="text-xs text-muted-foreground">Total Net Sales</div>
          <CurrencyDisplay value={totalNetSales} highlight className="text-2xl" />
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatusCard label="Shop Till Balance" value={<CurrencyDisplay value={shopDiff} />} status={!cashup ? 'pending' : Math.abs(shopDiff) < 20 ? 'green' : 'red'} detail={!cashup ? 'No data' : Math.abs(shopDiff) < 20 ? 'Within tolerance ✓' : 'Short/(Over)'} />
        <StatusCard label="OPT Balance" value={<CurrencyDisplay value={optDiff} />} status={!cashup ? 'pending' : optBalanced ? 'green' : 'red'} detail={cashup ? (optBalanced ? 'Balanced ✓' : 'Short/(Over)') : 'No data'} />
        <StatusCard label="Invoice vs Branch" value={managerEntry ? (invMatch ? 'MATCH' : `Diff R${Math.abs(invTotal - managerEntry.branchDayEndTotal).toFixed(2)}`) : 'Pending'} status={!managerEntry ? 'pending' : invMatch ? 'green' : 'red'} detail="Invoices captured vs branch" />
        <StatusCard label="VAT Reconciliation" value={managerEntry ? (vatMatch ? 'MATCH' : `Diff R${Math.abs(invVat - managerEntry.branchDayEndVat).toFixed(2)}`) : 'Pending'} status={!managerEntry ? 'pending' : vatMatch ? 'green' : 'red'} detail="VAT component verification" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {cashup && (
          <div className="bg-card border rounded-xl p-4">
            <h3 className="font-bold text-sm mb-3 text-primary">Cashier Summary</h3>
            <div className="space-y-1.5">
              {[
                { label: 'Shop Net Sales', v: shopNetSales },
                { label: 'OPT Net Sales', v: optNetSales },
                { label: 'Total Net Sales', v: totalNetSales, bold: true },
                { label: 'Total Payouts', v: shopPayoutsTotal + (cashup.shop.lottoPayouts ?? 0) },
                { label: 'Total Receipts', v: shopReceipts },
                { label: 'Shop Total Takings', v: shopTakings, bold: true },
                { label: citLabel, v: cashConnectTotal },
                { label: 'Shop Speedpoints', v: shopSP },
                { label: 'OPT Speedpoints', v: optSP },
                { label: 'Total Speedpoints', v: shopSP + optSP, bold: true },
              ].map(({ label, v, bold }) => (
                <div key={label} className={`flex justify-between text-sm ${bold ? 'font-semibold border-t pt-1' : ''}`}>
                  <span className="text-muted-foreground">{label}</span>
                  <CurrencyDisplay value={v} highlight={bold} />
                </div>
              ))}
            </div>
          </div>
        )}
        {managerEntry && (
          <div className="bg-card border rounded-xl p-4">
            <h3 className="font-bold text-sm mb-3 text-primary">Manager Summary</h3>
            <div className="space-y-1.5">
              {[
                { label: 'Payout Invoices', v: managerEntry.payoutInvoices.reduce((s, i) => s + i.inclusive, 0) },
                { label: 'EFT Invoices', v: managerEntry.eftInvoices.reduce((s, i) => s + i.inclusive, 0) },
                { label: 'Total Invoices', v: invTotal, bold: true },
                { label: 'Total VAT', v: invVat },
                { label: 'Branch Day End', v: managerEntry.branchDayEndTotal },
                { label: 'Coins Balance', v: managerEntry.coinsOpeningBalance + managerEntry.dailyCoins - managerEntry.ccBagClosureCoins },
                { label: `${citLabel} Balance`, v: managerEntry.cashConnectOpeningBalance + managerEntry.cashDepositedCashConnect - managerEntry.ccBagClosureCashConnect },
                { label: 'Banking', v: managerEntry.banking, bold: true },
              ].map(({ label, v, bold }) => (
                <div key={label} className={`flex justify-between text-sm ${bold ? 'font-semibold border-t pt-1' : ''}`}>
                  <span className="text-muted-foreground">{label}</span>
                  <CurrencyDisplay value={v} highlight={bold} />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
