import React, { useState } from 'react';
import { CurrencyDisplay } from '@/components/ui/CashupUI';
import { SourceBreakdown, type BreakdownEntry } from '@/components/ui/SourceBreakdown';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { ChevronDown, ChevronRight, Pencil, AlertTriangle } from 'lucide-react';
import { ReconAdjustDialog } from './ReconAdjustDialog';

type WeekData = { invoices: number; payments: number };

interface CreditorsTableProps {
  title: string;
  activeSuppliers: string[];
  inactiveSuppliers: string[];
  supplierWeekly: Record<string, WeekData[]>;
  openingBalances: Record<string, number>;
  editingOB: Record<string, string>;
  setEditingOB: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  weekLabels: string[];
  sundays: Date[];
  readOnlyOB?: boolean;
  invoiceEntries?: Record<string, BreakdownEntry[][]>;
  month: string;
  getAdjustment: (target: string, field: string, weekIdx?: number | null) => number;
  saveAdjustment: (params: {
    target_name: string;
    field: string;
    week_index: number | null;
    new_amount: number;
    changed_by: string;
    reason?: string;
  }) => Promise<void>;
  /** Supplier names appearing in invoices that aren't in the master EFT list. */
  unrecognisedSuppliers?: string[];
  /** Synthetic per-vendor keys for Sundry Supplier (prefixed "Sundry: "). */
  sundryKeys?: string[];
}

export function CreditorsTable({
  title,
  activeSuppliers,
  inactiveSuppliers,
  supplierWeekly,
  openingBalances,
  editingOB,
  setEditingOB,
  weekLabels,
  sundays,
  readOnlyOB = false,
  invoiceEntries,
  month,
  getAdjustment,
  saveAdjustment,
  unrecognisedSuppliers = [],
  sundryKeys = [],
}: CreditorsTableProps) {
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<{
    supplier: string;
    field: 'invoices' | 'payments';
    weekIdx: number;
    auto: number;
  } | null>(null);
  const allSuppliers = [...activeSuppliers, ...(showInactive ? inactiveSuppliers : [])];
  const unrecognisedSet = new Set(unrecognisedSuppliers);
  const sundrySet = new Set(sundryKeys);

  const renderSupplierLabel = (supplier: string) => {
    const isSundry = sundrySet.has(supplier);
    const isUnrecog = unrecognisedSet.has(supplier);
    return (
      <span className="flex items-center gap-1">
        {isSundry && <span className="text-[9px] uppercase tracking-wide text-amber-700 bg-amber-100 rounded px-1 py-0.5">Sundry</span>}
        <span>{isSundry ? supplier.replace(/^Sundry:\s*/, '') : supplier}</span>
        {isUnrecog && (
          <AlertTriangle
            className="h-3 w-3 text-amber-600"
            aria-label="Supplier not in master list — add to Settings → Master Data"
          />
        )}
      </span>
    );
  };

  const renderSupplierRow = (supplier: string) => {
    const ob = editingOB[supplier] !== undefined
      ? parseFloat(editingOB[supplier]) || 0
      : (openingBalances[supplier] ?? 0);
    const weeks = supplierWeekly[supplier];
    let runningBalance = ob;

    return (
      <TableRow key={supplier}>
        <TableCell
          className="sticky left-0 bg-card z-10 text-xs font-medium whitespace-nowrap"
          title={unrecognisedSet.has(supplier)
            ? "This supplier name isn't in your master EFT supplier list. Add it under Settings → Master Data so it's available in dropdowns."
            : undefined}
        >
          {renderSupplierLabel(supplier)}
        </TableCell>
        <TableCell className="text-right p-1">
          {readOnlyOB ? (
            <span className="text-xs px-2"><CurrencyDisplay value={openingBalances[supplier] ?? 0} /></span>
          ) : (
            <Input
              type="number"
              className="w-24 text-right text-xs h-7"
              value={editingOB[supplier] ?? (openingBalances[supplier] ?? '')}
              onChange={e => setEditingOB(prev => ({ ...prev, [supplier]: e.target.value }))}
            />
          )}
        </TableCell>
        {weeks.map((week, wi) => {
          runningBalance = runningBalance + week.invoices - week.payments;
          const invEntries = invoiceEntries?.[supplier]?.[wi] ?? [];
          const invAdj = getAdjustment(supplier, 'invoices', wi);
          const payAdj = getAdjustment(supplier, 'payments', wi);
          // weekly values shown already include applied adjustments (added upstream)
          const autoInv = week.invoices - invAdj;
          const autoPay = week.payments - payAdj;
          return (
            <React.Fragment key={wi}>
              <TableCell className="text-right text-xs group">
                <div className="flex items-center justify-end gap-1">
                  {week.invoices !== 0 ? (
                    invEntries.length > 0 ? (
                      <SourceBreakdown entries={invEntries} source="manager-daily">
                        <CurrencyDisplay value={week.invoices} />
                      </SourceBreakdown>
                    ) : <CurrencyDisplay value={week.invoices} />
                  ) : <span className="text-muted-foreground">—</span>}
                  {invAdj !== 0 && <span className="text-[10px] text-amber-600" title={`User adjustment: ${invAdj.toFixed(2)}`}>*</span>}
                  <button
                    type="button"
                    onClick={() => setEditing({ supplier, field: 'invoices', weekIdx: wi, auto: autoInv })}
                    className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
                    title="Edit invoices"
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                </div>
              </TableCell>
              <TableCell className="text-right text-xs group">
                <div className="flex items-center justify-end gap-1">
                  {week.payments !== 0
                    ? <span className="text-red-600"><CurrencyDisplay value={week.payments} /></span>
                    : <span className="text-muted-foreground">—</span>}
                  {payAdj !== 0 && <span className="text-[10px] text-amber-600" title={`User adjustment: ${payAdj.toFixed(2)}`}>*</span>}
                  <button
                    type="button"
                    onClick={() => setEditing({ supplier, field: 'payments', weekIdx: wi, auto: autoPay })}
                    className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
                    title="Edit payments"
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                </div>
              </TableCell>
              <TableCell className="text-right text-xs font-semibold bg-accent/40">
                <CurrencyDisplay value={runningBalance} />
              </TableCell>
            </React.Fragment>
          );
        })}
      </TableRow>
    );
  };

  const totalSuppliers = [...activeSuppliers, ...inactiveSuppliers];

  return (
    <div className="bg-card border rounded-lg overflow-x-clip">
      <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/30">
        <h3 className="font-semibold text-sm">{title}</h3>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="sticky left-0 bg-muted z-10 min-w-[120px]">Supplier</TableHead>
              <TableHead className="text-right min-w-[100px]">Opening Bal</TableHead>
              {weekLabels.map((label, i) => (
                <React.Fragment key={i}>
                  <TableHead className="text-right min-w-[90px] text-xs text-green-600">+ Inv</TableHead>
                  <TableHead className="text-right min-w-[90px] text-xs text-red-600">− Paid</TableHead>
                  <TableHead className="text-right min-w-[100px] font-semibold bg-accent/20">{label}</TableHead>
                </React.Fragment>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {allSuppliers.map(renderSupplierRow)}

            {inactiveSuppliers.length > 0 && (
              <TableRow
                className="cursor-pointer hover:bg-muted/50"
                onClick={() => setShowInactive(!showInactive)}
              >
                <TableCell colSpan={2 + sundays.length * 3} className="text-xs text-muted-foreground py-1.5">
                  <span className="flex items-center gap-1">
                    {showInactive ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                    {showInactive ? 'Hide' : 'Show'} {inactiveSuppliers.length} inactive supplier{inactiveSuppliers.length !== 1 ? 's' : ''}
                  </span>
                </TableCell>
              </TableRow>
            )}

            <TableRow className="bg-secondary font-semibold">
              <TableCell className="sticky left-0 bg-secondary z-10 text-xs">TOTAL</TableCell>
              <TableCell className="text-right text-xs">
                <CurrencyDisplay value={totalSuppliers.reduce((s, sup) => s + (openingBalances[sup] ?? 0), 0)} highlight />
              </TableCell>
              {sundays.map((_, wi) => {
                const totalInv = totalSuppliers.reduce((s, sup) => s + supplierWeekly[sup][wi].invoices, 0);
                const totalPay = totalSuppliers.reduce((s, sup) => s + supplierWeekly[sup][wi].payments, 0);
                let totalBal = 0;
                totalSuppliers.forEach(sup => {
                  let bal = openingBalances[sup] ?? 0;
                  for (let w = 0; w <= wi; w++) {
                    bal += supplierWeekly[sup][w].invoices - supplierWeekly[sup][w].payments;
                  }
                  totalBal += bal;
                });
                return (
                  <React.Fragment key={wi}>
                    <TableCell className="text-right text-xs"><CurrencyDisplay value={totalInv} highlight /></TableCell>
                    <TableCell className="text-right text-xs text-red-600"><CurrencyDisplay value={totalPay} /></TableCell>
                    <TableCell className="text-right text-xs font-bold bg-accent/40"><CurrencyDisplay value={totalBal} highlight /></TableCell>
                  </React.Fragment>
                );
              })}
            </TableRow>
          </TableBody>
        </Table>
      </div>
      {editing && (
        <ReconAdjustDialog
          open={!!editing}
          onOpenChange={(o) => !o && setEditing(null)}
          reconType="creditor"
          month={month}
          targetName={editing.supplier}
          field={editing.field}
          weekIndex={editing.weekIdx}
          weekLabel={weekLabels[editing.weekIdx]}
          autoAmount={editing.auto}
          currentAdjustment={getAdjustment(editing.supplier, editing.field, editing.weekIdx)}
          fieldLabel={editing.field === 'invoices' ? 'Invoices' : 'Payments'}
          isOverride={false}
          onSave={async (newAmount, changedBy, reason) => {
            await saveAdjustment({
              target_name: editing.supplier,
              field: editing.field,
              week_index: editing.weekIdx,
              new_amount: newAmount,
              changed_by: changedBy,
              reason,
            });
          }}
        />
      )}
    </div>
  );
}
