import { useState, useEffect } from "react";
import { useCashupStore } from "@/store/cashupStore";
import { useMasterDataStore } from "@/store/masterDataStore";
import type { MonthlyBranchFigures } from "@/types/cashup";
import { Section, DataRow, CurrencyInput, CurrencyDisplay } from "@/components/ui/CashupUI";
import { Button } from "@/components/ui/button";
import { Save, CheckCircle, AlertCircle } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { format } from "date-fns";

interface Props {
  selectedDate: string;
}

const MetricRow = ({
  label,
  spreadsheet,
  branch,
  match,
  onChange,
  explanation,
  onExplanationChange,
}: {
  label: string;
  spreadsheet: number;
  branch: number;
  match: boolean;
  onChange: (v: number) => void;
  explanation: string;
  onExplanationChange: (v: string) => void;
}) => {
  const diff = spreadsheet - branch;
  return (
    <div className="grid grid-cols-[2fr_1fr_1fr_1fr_2fr] gap-3 px-3 py-2 border-b last:border-b-0 text-sm items-center">
      <span className="text-muted-foreground">{label}</span>
      <CurrencyDisplay value={spreadsheet} className="text-right" />
      <div className="flex justify-center">
        <CurrencyInput value={branch} onChange={onChange} className="text-right w-full max-w-[120px]" />
      </div>
      <div
        className={`flex items-center justify-center gap-1 rounded px-2 py-0.5 font-semibold text-xs ${match ? "status-green" : "status-red"}`}
      >
        {match ? <CheckCircle className="h-3 w-3" /> : <AlertCircle className="h-3 w-3" />}
        {match ? "MATCH" : <CurrencyDisplay value={diff} />}
      </div>
      <input
        value={explanation}
        onChange={(e) => onExplanationChange(e.target.value)}
        className="input-cell text-[#020508] bg-[#e4ebf2] w-full text-left text-xs"
        placeholder={match ? "" : "Explain variance..."}
      />
    </div>
  );
};

export function ManagerMonthlyForm({ selectedDate }: Props) {
  const month = selectedDate.slice(0, 7);
  const { getMonthlyFiguresByMonth, addMonthlyFigures, updateMonthlyFigures, cashups, managerEntries } =
    useCashupStore();
  const { managerNames: MANAGER_NAMES } = useMasterDataStore();
  const existing = getMonthlyFiguresByMonth(month);

  const [form, setForm] = useState<Omit<MonthlyBranchFigures, "id">>({
    month,
    enteredBy: "",
    branchNetSales: 0,
    branchTotalPayouts: 0,
    branchTotalReceipts: 0,
    branchTotalInvoicesCapital: 0,
    branchTotalInvoicesVat: 0,
    salesCStore: 0,
    salesWslDsl: 0,
    salesFuel: 0,
    salesGas: 0,
    salesOil: 0,
    adjCStore: 0,
    adjWslDsl: 0,
    adjFuel: 0,
    adjGas: 0,
    adjOil: 0,
    adjVat: 0,
    vatTaxAmount: 0,
    explanationNetSales: "",
    explanationPayouts: "",
    explanationReceipts: "",
    explanationInvoices: "",
    explanationVat: "",
    notes: "",
    airtimeBldBalance: 0,
    airtimeEasypayBalance: 0,
    airtimeLottoBalance: 0,
  });

  useEffect(() => {
    if (existing) setForm({ ...existing });
    else setForm((f) => ({ ...f, month }));
  }, [month, existing?.id]);

  // Compute from store
  const monthCashups = cashups.filter((c) => c.month === month);
  const monthManagers = managerEntries.filter((e) => e.date.startsWith(month));

  const spreadsheetNetSales = monthCashups.reduce((s, c) => {
    const shopNet = c.shop.income - c.shop.returns - (c.shop.returns_today ?? 0);
    const optNet = c.opt.income - c.opt.returns - ((c.opt as any).returns_today ?? 0);
    return s + shopNet + optNet;
  }, 0);

  const spreadsheetPayouts = monthCashups.reduce((s, c) => {
    return s + c.shop.payouts.reduce((ps, p) => ps + p.amount, 0) + c.shop.lottoPayouts;
  }, 0);

  const spreadsheetReceipts = monthCashups.reduce((s, c) => s + c.shop.receipts.reduce((rs, r) => rs + r.amount, 0), 0);

  const spreadsheetInvoicesTotal = monthManagers.reduce(
    (s, e) =>
      s +
      e.payoutInvoices.reduce((is, i) => is + i.inclusive, 0) +
      e.eftInvoices.reduce((is, i) => is + i.inclusive, 0),
    0,
  );

  const spreadsheetInvoicesVat = monthManagers.reduce(
    (s, e) => s + e.payoutInvoices.reduce((is, i) => is + i.vat, 0) + e.eftInvoices.reduce((is, i) => is + i.vat, 0),
    0,
  );

  const salesMatch = Math.abs(spreadsheetNetSales - form.branchNetSales) < 1;
  const payoutsMatch = Math.abs(spreadsheetPayouts - form.branchTotalPayouts) < 1;
  const receiptsMatch = Math.abs(spreadsheetReceipts - form.branchTotalReceipts) < 1;
  const invoicesMatch = Math.abs(spreadsheetInvoicesTotal - form.branchTotalInvoicesCapital) < 1;
  const vatMatch = Math.abs(spreadsheetInvoicesVat - form.branchTotalInvoicesVat) < 1;

  const handleSave = () => {
    if (existing) updateMonthlyFigures(existing.id, form);
    else addMonthlyFigures(form);
    toast({ title: "Monthly figures saved", description: `Saved for ${format(new Date(month + "-01"), "MMM yyyy")}` });
  };

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="bg-card border rounded-lg p-3 grid grid-cols-2 md:grid-cols-3 gap-3">
        <div>
          <label className="text-xs text-muted-foreground">Month</label>
          <div className="input-cell text-[#020508] bg-[#e4ebf2] w-full mt-0.5 text-center font-semibold">
            {format(new Date(month + "-01"), "MMMM yyyy")}
          </div>
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Entered By</label>
          <select
            value={form.enteredBy}
            onChange={(e) => setForm((f) => ({ ...f, enteredBy: e.target.value }))}
            className="input-cell text-[#020508] bg-[#e4ebf2] w-full mt-0.5"
          >
            <option value="">Select...</option>
            {MANAGER_NAMES.map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </div>
        <div className="col-span-1">
          <label className="text-xs text-muted-foreground">Notes</label>
          <input
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            className="input-cell text-[#020508] bg-[#e4ebf2] w-full mt-0.5 text-left"
            placeholder="Any month end notes..."
          />
        </div>
      </div>

      <div className="text-xs text-muted-foreground bg-muted/50 rounded px-3 py-2">
        Showing data for: <strong>{format(new Date(month + "-01"), "MMMM yyyy")}</strong> — {monthCashups.length} cashup
        days recorded this month
      </div>

      {/* Month End Report */}
      <Section title="1. Branch Month End Report" color="blue">
        <div className="grid grid-cols-[2fr_1fr_1fr_1fr_2fr] gap-3 px-3 py-1.5 border-b text-xs font-semibold text-muted-foreground bg-muted/30">
          <span>Metric</span>
          <span className="text-right">Spreadsheet Total</span>
          <span className="text-center">Branch Report (enter below)</span>
          <span className="text-center">Status</span>
          <span>Explanation</span>
        </div>
        <MetricRow
          label="Net Sales"
          spreadsheet={spreadsheetNetSales}
          branch={form.branchNetSales}
          match={salesMatch}
          onChange={(v) => setForm((f) => ({ ...f, branchNetSales: v }))}
          explanation={form.explanationNetSales}
          onExplanationChange={(v) => setForm((f) => ({ ...f, explanationNetSales: v }))}
        />
        <MetricRow
          label="Total Payouts"
          spreadsheet={spreadsheetPayouts}
          branch={form.branchTotalPayouts}
          match={payoutsMatch}
          onChange={(v) => setForm((f) => ({ ...f, branchTotalPayouts: v }))}
          explanation={form.explanationPayouts}
          onExplanationChange={(v) => setForm((f) => ({ ...f, explanationPayouts: v }))}
        />
        <MetricRow
          label="Total Receipts"
          spreadsheet={spreadsheetReceipts}
          branch={form.branchTotalReceipts}
          match={receiptsMatch}
          onChange={(v) => setForm((f) => ({ ...f, branchTotalReceipts: v }))}
          explanation={form.explanationReceipts}
          onExplanationChange={(v) => setForm((f) => ({ ...f, explanationReceipts: v }))}
        />
      </Section>

      {/* Creditors Transactions Report */}
      <Section title="2. Branch Creditors Transactions Report" color="purple">
        <div className="grid grid-cols-[2fr_1fr_1fr_1fr_2fr] gap-3 px-3 py-1.5 border-b text-xs font-semibold text-muted-foreground bg-muted/30">
          <span>Metric</span>
          <span className="text-right">Spreadsheet Total</span>
          <span className="text-center">Branch Report (enter below)</span>
          <span className="text-center">Status</span>
          <span>Explanation</span>
        </div>
        <MetricRow
          label="Total Invoices (Incl.)"
          spreadsheet={spreadsheetInvoicesTotal}
          branch={form.branchTotalInvoicesCapital}
          match={invoicesMatch}
          onChange={(v) => setForm((f) => ({ ...f, branchTotalInvoicesCapital: v }))}
          explanation={form.explanationInvoices}
          onExplanationChange={(v) => setForm((f) => ({ ...f, explanationInvoices: v }))}
        />
        <MetricRow
          label="Total VAT"
          spreadsheet={spreadsheetInvoicesVat}
          branch={form.branchTotalInvoicesVat}
          match={vatMatch}
          onChange={(v) => setForm((f) => ({ ...f, branchTotalInvoicesVat: v }))}
          explanation={form.explanationVat}
          onExplanationChange={(v) => setForm((f) => ({ ...f, explanationVat: v }))}
        />
      </Section>

      {/* Month End Report (Other) */}
      <Section title="3. Branch Month End Report (Other)" color="orange">
        <div className="grid grid-cols-[2fr_1fr_1fr_1fr] gap-3 px-3 py-1.5 border-b text-xs font-semibold text-muted-foreground bg-muted/30">
          <span>Description</span>
          <span className="text-center">Sales Value</span>
          <span className="text-center">Adjustments</span>
          <span className="text-center">Sales Value (adj)</span>
        </div>
        {[
          { label: "Sales C Store", key: "salesCStore" as const, adjKey: "adjCStore" as const },
          { label: "Sales WSL DSL", key: "salesWslDsl" as const, adjKey: "adjWslDsl" as const },
          { label: "Sales Fuel", key: "salesFuel" as const, adjKey: "adjFuel" as const },
          { label: "Sales Gas", key: "salesGas" as const, adjKey: "adjGas" as const },
          { label: "Sales Oil", key: "salesOil" as const, adjKey: "adjOil" as const },
        ].map(({ label, key, adjKey }) => (
          <div key={key} className="grid grid-cols-[2fr_1fr_1fr_1fr] gap-3 px-3 py-2 border-b text-sm items-center">
            <span className="text-muted-foreground">{label}</span>
            <div className="flex justify-center">
              <CurrencyInput
                value={form[key]}
                onChange={(v) => setForm((f) => ({ ...f, [key]: v }))}
                className="text-right w-full max-w-[120px]"
              />
            </div>
            <div className="flex justify-center">
              <CurrencyInput
                value={form[adjKey]}
                onChange={(v) => setForm((f) => ({ ...f, [adjKey]: v }))}
                className="text-right w-full max-w-[120px]"
              />
            </div>
            <div className="flex justify-center">
              <CurrencyDisplay value={form[key] + form[adjKey]} className="text-right w-full max-w-[120px]" />
            </div>
          </div>
        ))}
        <div className="grid grid-cols-[2fr_1fr_1fr_1fr] gap-3 px-3 py-1.5 border-b text-xs font-semibold text-muted-foreground bg-muted/30">
          <span>Tax</span>
          <span className="text-center">Tax Amount</span>
          <span className="text-center">Adjustments</span>
          <span className="text-center">Tax Amount (adj)</span>
        </div>
        <div className="grid grid-cols-[2fr_1fr_1fr_1fr] gap-3 px-3 py-2 border-b text-sm items-center">
          <span className="text-muted-foreground">VAT</span>
          <div className="flex justify-center">
            <CurrencyInput
              value={form.vatTaxAmount}
              onChange={(v) => setForm((f) => ({ ...f, vatTaxAmount: v }))}
              className="text-right w-full max-w-[120px]"
            />
          </div>
          <div className="flex justify-center">
            <CurrencyInput
              value={form.adjVat}
              onChange={(v) => setForm((f) => ({ ...f, adjVat: v }))}
              className="text-right w-full max-w-[120px]"
            />
          </div>
          <div className="flex justify-center">
            <CurrencyDisplay value={form.vatTaxAmount + form.adjVat} className="text-right w-full max-w-[120px]" />
          </div>
        </div>
        <div className="grid grid-cols-[2fr_1fr_1fr_1fr] gap-3 px-3 py-2 text-sm items-center bg-secondary font-semibold">
          <span>Total Sales (incl. VAT)</span>
          <CurrencyDisplay
            value={
              form.salesCStore + form.salesWslDsl + form.salesFuel + form.salesGas + form.salesOil + form.vatTaxAmount
            }
            className="text-right"
          />
          <CurrencyDisplay
            value={form.adjCStore + form.adjWslDsl + form.adjFuel + form.adjGas + form.adjOil + form.adjVat}
            className="text-right"
          />
          <CurrencyDisplay
            value={
              form.salesCStore +
              form.salesWslDsl +
              form.salesFuel +
              form.salesGas +
              form.salesOil +
              form.vatTaxAmount +
              form.adjCStore +
              form.adjWslDsl +
              form.adjFuel +
              form.adjGas +
              form.adjOil +
              form.adjVat
            }
            className="text-right"
          />
        </div>
      </Section>

      {/* Airtime / Lotto Balance */}
      <Section title="4. Airtime / Lotto Balance" color="green">
        <div className="grid grid-cols-[2fr_1fr_1fr_1fr] gap-3 px-3 py-1.5 border-b text-xs font-semibold text-muted-foreground bg-muted/30">
          <span>Description</span>
          <span className="text-center">Blue Label</span>
          <span className="text-center">Easy Pay</span>
          <span className="text-center">Lotto (Unpaid days combined)</span>
        </div>
        <div className="grid grid-cols-[2fr_1fr_1fr_1fr] gap-3 px-3 py-2 border-b text-sm items-center">
          <span className="text-muted-foreground font-medium">Month End Bal</span>
          <div className="flex justify-center">
            <CurrencyInput
              value={form.airtimeBldBalance}
              onChange={(v) => setForm((f) => ({ ...f, airtimeBldBalance: v }))}
              className="text-right w-full max-w-[120px]"
              allowNegative
            />
          </div>
          <div className="flex justify-center">
            <CurrencyInput
              value={form.airtimeEasypayBalance}
              onChange={(v) => setForm((f) => ({ ...f, airtimeEasypayBalance: v }))}
              className="text-right w-full max-w-[120px]"
              allowNegative
            />
          </div>
          <div className="flex justify-center">
            <CurrencyInput
              value={form.airtimeLottoBalance}
              onChange={(v) => setForm((f) => ({ ...f, airtimeLottoBalance: v }))}
              className="text-right w-full max-w-[120px]"
              allowNegative
            />
          </div>
        </div>
      </Section>

      <Button onClick={handleSave} className="w-full" size="sm">
        <Save className="h-3.5 w-3.5 mr-1" />
        Save Monthly
      </Button>

      {/* Month End Status */}
      <div
        className={`rounded-xl border-2 p-4 text-center ${salesMatch && payoutsMatch && receiptsMatch && invoicesMatch && vatMatch ? "border-green-500 bg-green-50" : "border-destructive bg-destructive/5"}`}
      >
        <div className="text-2xl mb-1">
          {salesMatch && payoutsMatch && receiptsMatch && invoicesMatch && vatMatch ? "✅" : "❌"}
        </div>
        <div className="font-bold text-lg">
          {salesMatch && payoutsMatch && receiptsMatch && invoicesMatch && vatMatch
            ? "Month End Reconciled"
            : "Month End NOT Reconciled"}
        </div>
        <div className="text-sm text-muted-foreground">
          {[
            !salesMatch && "Sales mismatch",
            !payoutsMatch && "Payouts mismatch",
            !receiptsMatch && "Receipts mismatch",
            !invoicesMatch && "Invoices mismatch",
            !vatMatch && "VAT mismatch",
          ]
            .filter(Boolean)
            .join(" • ") || "All figures agree ✓"}
        </div>
      </div>
    </div>
  );
}
