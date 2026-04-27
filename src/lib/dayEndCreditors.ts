import type { InvoiceLine } from '@/types/cashup';

export interface DayEndCreditorsSplit {
  payoutInvoices: InvoiceLine[];
  eftInvoices: InvoiceLine[];
}

function parseAmount(value: string): number {
  return parseFloat(value.replace(/,/g, '')) || 0;
}

function normalizeMethod(value: string): 'cash' | 'eft' | null {
  const method = value.trim().toUpperCase();
  if (method === 'CASH') return 'cash';
  if (method === 'EFT') return 'eft';
  return null;
}

export function extractDayEndCreditors(content: string): DayEndCreditorsSplit {
  if (!content) return { payoutInvoices: [], eftInvoices: [] };

  const idx = content.indexOf('EOD Creditors Transactions');
  if (idx < 0) return { payoutInvoices: [], eftInvoices: [] };

  const scope = content.slice(idx, idx + 8000);
  const lines = scope.split('\n');
  const payoutInvoices: InvoiceLine[] = [];
  const eftInvoices: InvoiceLine[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('EOD Creditors Transactions') || trimmed.startsWith('Batch Number')) continue;
    if (trimmed.startsWith('Trx Desc') || trimmed.startsWith('--------') || trimmed.startsWith('Total for :')) continue;
    if (/^[-=.]+$/.test(trimmed.replace(/\s+/g, ''))) continue;

    const match = line.match(/^\s*(TAX INVOICE|G\.R\.N\.\/?\s*TAX INVOICE|GOODS RET\.?\s*\/\s*CREDIT)\s+(\S+)\s+(.+?)\s+(\d+)\s+(CASH|EFT)\s+(\d{2}\/\d{2}\/\d{4})\s+(-?[\d,]+\.\d{2})\s+(-?[\d,]+\.\d{2})\s+(-?[\d,]+\.\d{2})\s*$/i);
    if (!match) continue;

    const supplier = match[3].trim();
    const branchDocNum = match[4].trim();
    const method = normalizeMethod(match[5]);
    const vat = parseAmount(match[8]);
    const inclusive = parseAmount(match[9]);

    if (!method) continue;

    const invoice: InvoiceLine = {
      id: `auto-${method}-${branchDocNum}`,
      supplier,
      category: '',
      branchDocNum,
      inclusive,
      vat,
      autoImported: true,
    };

    if (method === 'cash') payoutInvoices.push(invoice);
    else eftInvoices.push(invoice);
  }

  return { payoutInvoices, eftInvoices };
}