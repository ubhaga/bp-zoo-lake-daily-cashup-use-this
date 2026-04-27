import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { fetchAuditLog, type ReconAuditEntry, type ReconType } from '@/hooks/useReconAdjustments';
import { format } from 'date-fns';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reconType: ReconType;
  month: string;
  targetName: string;
  field: string;            // 'invoices' | 'payments' | 'adjustment'
  weekIndex?: number | null;
  weekLabel?: string;
  autoAmount: number;       // system-calculated value
  currentAdjustment: number; // existing user delta/override
  fieldLabel: string;
  isOverride?: boolean;     // debtor "adjustment" is an override, creditor delta is an adjustment
  onSave: (newAmount: number, changedBy: string, reason: string) => Promise<void>;
}

export function ReconAdjustDialog({
  open, onOpenChange, reconType, month, targetName, field, weekIndex = null, weekLabel,
  autoAmount, currentAdjustment, fieldLabel, isOverride, onSave,
}: Props) {
  const [amount, setAmount] = useState(String(currentAdjustment ?? 0));
  const [changedBy, setChangedBy] = useState(localStorage.getItem('recon_user_name') ?? '');
  const [reason, setReason] = useState('');
  const [history, setHistory] = useState<ReconAuditEntry[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setAmount(String(currentAdjustment ?? 0));
      setReason('');
      fetchAuditLog(reconType, month, targetName).then(rows => {
        setHistory(rows.filter(r => r.field === field && (r.week_index ?? null) === (weekIndex ?? null)));
      });
    }
  }, [open, currentAdjustment, reconType, month, targetName, field, weekIndex]);

  const handleSave = async () => {
    if (!changedBy.trim()) {
      alert('Please enter your name to log this change.');
      return;
    }
    setSaving(true);
    localStorage.setItem('recon_user_name', changedBy.trim());
    await onSave(parseFloat(amount) || 0, changedBy.trim(), reason);
    setSaving(false);
    onOpenChange(false);
  };

  const effectiveTotal = isOverride
    ? (parseFloat(amount) || 0)
    : autoAmount + (parseFloat(amount) || 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit {fieldLabel} — {targetName}</DialogTitle>
          <DialogDescription>
            {weekLabel ? `Week ending ${weekLabel} • ` : ''}{month}
            {isOverride
              ? ' • Enter the override amount that will replace the auto-calculated value.'
              : ' • Enter a +/- adjustment to add to the auto-calculated value.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <Label className="text-xs text-muted-foreground">Auto-calculated</Label>
              <div className="font-mono">{autoAmount.toFixed(2)}</div>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Effective total after edit</Label>
              <div className="font-mono font-semibold">{effectiveTotal.toFixed(2)}</div>
            </div>
          </div>

          <div>
            <Label htmlFor="amt">{isOverride ? 'Override amount' : 'Adjustment (+/-)'}</Label>
            <Input id="amt" type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="who">Your name *</Label>
              <Input id="who" value={changedBy} onChange={e => setChangedBy(e.target.value)} placeholder="e.g. John" />
            </div>
            <div>
              <Label htmlFor="reason">Reason (optional)</Label>
              <Input id="reason" value={reason} onChange={e => setReason(e.target.value)} placeholder="Why this change" />
            </div>
          </div>

          {history.length > 0 && (
            <div className="border rounded-md mt-3">
              <div className="px-3 py-2 text-xs font-semibold bg-muted/40 border-b">Change history</div>
              <div className="max-h-48 overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">When</TableHead>
                      <TableHead className="text-xs">Who</TableHead>
                      <TableHead className="text-xs text-right">Old</TableHead>
                      <TableHead className="text-xs text-right">New</TableHead>
                      <TableHead className="text-xs">Reason</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {history.map(h => (
                      <TableRow key={h.id}>
                        <TableCell className="text-xs">{format(new Date(h.created_at), 'dd MMM HH:mm')}</TableCell>
                        <TableCell className="text-xs">{h.changed_by}</TableCell>
                        <TableCell className="text-xs text-right font-mono">{h.old_amount?.toFixed(2) ?? '—'}</TableCell>
                        <TableCell className="text-xs text-right font-mono">{h.new_amount.toFixed(2)}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{h.reason || '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save & Log'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
