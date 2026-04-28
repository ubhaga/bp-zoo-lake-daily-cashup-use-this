import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { Upload, FileText, Trash2, CheckCircle, AlertTriangle } from 'lucide-react';
import { format, getDaysInMonth, parse } from 'date-fns';
import { useMasterDataStore } from '@/store/masterDataStore';
import { extractPdfText } from '@/lib/pdfText';
import { NETACC_MARKER, extractNetAccBatchDate, isNetAccContent } from '@/lib/dayEndNetAcc';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface Props {
  filterMonth: string; // yyyy-MM
}

interface DayEndRow {
  id: string;
  date: string;
  filename: string;
  content: string;
  created_at: string;
  date_mismatch?: boolean;
}

/** Strip page break markers from RPT content */
function stripPageBreaks(content: string): string {
  return content
    .replace(/<---\s*Ver:.*?Rpt Type:\s*\w+\s*--->/g, '')
    .replace(/<<\s*Page Break\s*>>/g, '')
    .replace(/\s+Page\s*:\s*\d+\s*$/gm, '')
    .replace(/\n{3,}/g, '\n\n');
}

/** Extract Batch Date from any uploaded report (Branch .rpt or NetAcc PDF). */
function extractBatchDate(content: string): string | null {
  if (isNetAccContent(content)) {
    return extractNetAccBatchDate(content);
  }
  const m = content.match(/Batch\s+Date\s*:\s*(\d{2}\/\d{2}\/\d{4})/i);
  if (!m) return null;
  try {
    const parsed = parse(m[1], 'dd/MM/yyyy', new Date());
    return format(parsed, 'yyyy-MM-dd');
  } catch {
    return null;
  }
}

export function DayEndUpload({ filterMonth }: Props) {
  const [uploads, setUploads] = useState<DayEndRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [mismatchDialog, setMismatchDialog] = useState<{
    targetDate: string;
    batchDate: string;
    file: File;
    text: string;
  } | null>(null);
  // Track which dates had mismatched uploads
  const [mismatchDates, setMismatchDates] = useState<Set<string>>(new Set());

  const loadUploads = useCallback(async () => {
    const { data } = await supabase
      .from('day_end_uploads')
      .select('*')
      .eq('month', filterMonth)
      .order('date');
    const rows = (data ?? []) as DayEndRow[];
    // Detect mismatches for loaded rows
    const mismatches = new Set<string>();
    for (const row of rows) {
      const batchDate = extractBatchDate(row.content);
      if (batchDate && batchDate !== row.date) {
        mismatches.add(row.date);
      }
    }
    setMismatchDates(mismatches);
    setUploads(rows);
  }, [filterMonth]);

  useEffect(() => { loadUploads(); }, [loadUploads]);

  const doUpload = async (date: string, file: File, text: string, isMismatch: boolean) => {
    setLoading(true);
    try {
      const existing = uploads.find(u => u.date === date);
      if (existing) {
        await supabase.from('day_end_uploads').update({
          filename: file.name,
          content: text,
          updated_at: new Date().toISOString(),
        } as never).eq('id', existing.id);
      } else {
        await supabase.from('day_end_uploads').insert({
          date,
          month: filterMonth,
          filename: file.name,
          content: text,
        } as never);
      }
      if (isMismatch) {
        setMismatchDates(prev => new Set(prev).add(date));
      } else {
        setMismatchDates(prev => {
          const next = new Set(prev);
          next.delete(date);
          return next;
        });
      }
      toast({ title: 'Day end uploaded', description: `${file.name} for ${format(new Date(date), 'dd MMM yyyy')}` });
      await loadUploads();
    } catch {
      toast({ title: 'Upload failed', variant: 'destructive' });
    }
    setLoading(false);
  };

  const handleFileUpload = async (date: string, file: File) => {
    const raw = await file.text();
    const text = stripPageBreaks(raw);
    const batchDate = extractBatchDate(text);

    if (batchDate && batchDate !== date) {
      setMismatchDialog({ targetDate: date, batchDate, file, text });
      return;
    }
    await doUpload(date, file, text, false);
  };

  const handleDelete = async (row: DayEndRow) => {
    await supabase.from('day_end_uploads').delete().eq('id', row.id);
    setMismatchDates(prev => {
      const next = new Set(prev);
      next.delete(row.date);
      return next;
    });
    toast({ title: 'Deleted', description: row.filename });
    await loadUploads();
  };

  // Build list of dates in the month
  const year = parseInt(filterMonth.slice(0, 4));
  const month = parseInt(filterMonth.slice(5, 7));
  const daysInMonth = getDaysInMonth(new Date(year, month - 1));
  const dates = Array.from({ length: daysInMonth }, (_, i) => {
    const d = `${filterMonth}-${String(i + 1).padStart(2, '0')}`;
    return d;
  });

  const uploadMap = new Map(uploads.map(u => [u.date, u]));

  return (
    <>
      <div className="bg-card border rounded-lg">
        <div className="px-4 py-3 border-b bg-muted/50">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Day End Reports — {format(new Date(year, month - 1), 'MMMM yyyy')}
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">Upload .rpt day end files for each day</p>
        </div>
        <div className="divide-y max-h-[500px] overflow-y-auto">
          {dates.map(date => {
            const row = uploadMap.get(date);
            const dayLabel = format(new Date(date), 'EEE dd MMM');
            const isMismatch = mismatchDates.has(date);
            const bgClass = row
              ? isMismatch
                ? 'bg-amber-50'
                : 'bg-green-50'
              : 'hover:bg-muted/30';
            return (
              <div key={date} className={`flex items-center justify-between px-4 py-2 text-sm ${bgClass}`}>
                <div className="flex items-center gap-3 min-w-[140px]">
                  <span className="font-medium">{dayLabel}</span>
                </div>
                {row ? (
                  <div className="flex items-center gap-3">
                    {isMismatch ? (
                      <AlertTriangle className="h-4 w-4 text-amber-600" />
                    ) : (
                      <CheckCircle className="h-4 w-4 text-green-600" />
                    )}
                    <span className={`text-xs ${isMismatch ? 'text-amber-700 font-medium' : 'text-muted-foreground'}`}>
                      {row.filename}
                      {isMismatch && ' (date mismatch)'}
                    </span>
                    <label className="cursor-pointer text-xs text-primary hover:underline">
                      Replace
                      <input type="file" accept=".rpt,.txt" className="hidden" onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleFileUpload(date, f);
                        e.target.value = '';
                      }} />
                    </label>
                    <button onClick={() => handleDelete(row)} className="text-destructive hover:text-destructive/80">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <label className={`cursor-pointer flex items-center gap-1.5 text-xs text-primary hover:underline ${loading ? 'opacity-50 pointer-events-none' : ''}`}>
                    <Upload className="h-3.5 w-3.5" />
                    Upload
                    <input type="file" accept=".rpt,.txt" className="hidden" onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleFileUpload(date, f);
                      e.target.value = '';
                    }} />
                  </label>
                )}
              </div>
            );
          })}
          {dates.length === 0 && (
            <div className="px-4 py-8 text-center text-muted-foreground text-sm">No dates available for this month yet.</div>
          )}
        </div>
        <div className="px-4 py-2 border-t bg-muted/30 text-xs text-muted-foreground">
          {uploads.length} / {dates.length} days uploaded
        </div>
      </div>

      <AlertDialog open={!!mismatchDialog} onOpenChange={(open) => { if (!open) setMismatchDialog(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Batch Date Mismatch
            </AlertDialogTitle>
            <AlertDialogDescription>
              The file's batch date is <strong>{mismatchDialog ? format(new Date(mismatchDialog.batchDate), 'dd MMM yyyy') : ''}</strong> but you are uploading to <strong>{mismatchDialog ? format(new Date(mismatchDialog.targetDate), 'dd MMM yyyy') : ''}</strong>.
              <br /><br />
              Do you want to proceed? The row will be highlighted in amber to indicate a date mismatch.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (mismatchDialog) {
                  doUpload(mismatchDialog.targetDate, mismatchDialog.file, mismatchDialog.text, true);
                }
                setMismatchDialog(null);
              }}
            >
              Upload Anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
