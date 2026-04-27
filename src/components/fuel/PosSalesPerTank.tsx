import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { parseEodShort, type EodShortRow } from '@/lib/fuelReportParser';
import { format } from 'date-fns';
import { useMasterDataStore, getTankColor } from '@/store/masterDataStore';

interface Props {
  selectedDate: string;
}

interface DayEodShort {
  date: string;
  rows: EodShortRow[];
}

export function PosSalesPerTank({ selectedDate }: Props) {
  const [dayData, setDayData] = useState<DayEodShort[]>([]);
  const [loading, setLoading] = useState(true);
  const tanks = useMasterDataStore(s => s.tanks);
  const month = selectedDate.slice(0, 7);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('day_end_uploads')
      .select('content, date')
      .eq('month', month)
      .order('date');

    if (data) {
      const parsed: DayEodShort[] = data.map(d => ({
        date: d.date,
        rows: parseEodShort(d.content),
      })).filter(d => d.rows.length > 0);
      setDayData(parsed);
    } else {
      setDayData([]);
    }
    setLoading(false);
  }, [month]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="py-8 text-center text-muted-foreground text-sm">Loading...</div>;
  if (dayData.length === 0) return <div className="py-8 text-center text-muted-foreground text-sm">No POS fuel sales data found. Upload Day End Reports first.</div>;

  const fmtN = (n: number) => n.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtV = (n: number) => n.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="space-y-4">
      {dayData.map(day => (
        <div key={day.date} className="border rounded-lg overflow-x-clip">
          <div className="bg-muted/50 px-4 py-2 border-b flex items-center justify-between">
            <span className="text-sm font-semibold">{format(new Date(day.date), 'EEE dd MMM yyyy')}</span>
            <span className="text-xs text-muted-foreground">
              Total Pump: {fmtV(day.rows.reduce((s, r) => s + r.pumpVolSales, 0))}L
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b">
                  <th className="px-2 py-1.5 text-left font-medium sticky top-0 z-10 bg-muted">Grade</th>
                  <th className="px-2 py-1.5 text-left font-medium sticky top-0 z-10 bg-muted">Description</th>
                  <th className="px-2 py-1.5 text-right font-medium sticky top-0 z-10 bg-muted">Amt Sales (R)</th>
                  <th className="px-2 py-1.5 text-right font-medium sticky top-0 z-10 bg-muted">Pump Vol (L)</th>
                  <th className="px-2 py-1.5 text-right font-medium sticky top-0 z-10 bg-muted">Tank Vol (L)</th>
                  <th className="px-2 py-1.5 text-right font-medium sticky top-0 z-10 bg-muted">Pump Var (L)</th>
                  <th className="px-2 py-1.5 text-right font-medium sticky top-0 z-10 bg-muted">Opening (L)</th>
                  <th className="px-2 py-1.5 text-right font-medium sticky top-0 z-10 bg-muted">Purchase (L)</th>
                  <th className="px-2 py-1.5 text-right font-medium sticky top-0 z-10 bg-muted">Closing Dip (L)</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {day.rows.map((r, i) => (
                  <tr key={i} className="hover:bg-muted/20">
                    <td className="px-2 py-1">
                      <span className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: getTankColor(tanks, r.gradeId) || getTankColor(tanks, r.gradeDescription) || '#94a3b8' }} />
                        {r.gradeId}
                      </span>
                    </td>
                    <td className="px-2 py-1">{r.gradeDescription}</td>
                    <td className="px-2 py-1 text-right">{fmtN(r.amtSales)}</td>
                    <td className="px-2 py-1 text-right">{fmtV(r.pumpVolSales)}</td>
                    <td className="px-2 py-1 text-right">{fmtV(r.tankVolSales)}</td>
                    <td className={`px-2 py-1 text-right font-medium ${r.pumpVolVariance < 0 ? 'text-red-600' : r.pumpVolVariance > 0 ? 'text-amber-600' : ''}`}>
                      {fmtV(r.pumpVolVariance)}
                    </td>
                    <td className="px-2 py-1 text-right">{fmtV(r.openingVol)}</td>
                    <td className="px-2 py-1 text-right">{fmtV(r.volPurchase)}</td>
                    <td className="px-2 py-1 text-right">{fmtV(r.closingDip)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-muted/40 font-semibold border-t">
                  <td colSpan={2} className="px-2 py-1.5">Total</td>
                  <td className="px-2 py-1.5 text-right">{fmtN(day.rows.reduce((s, r) => s + r.amtSales, 0))}</td>
                  <td className="px-2 py-1.5 text-right">{fmtV(day.rows.reduce((s, r) => s + r.pumpVolSales, 0))}</td>
                  <td className="px-2 py-1.5 text-right">{fmtV(day.rows.reduce((s, r) => s + r.tankVolSales, 0))}</td>
                  <td className={`px-2 py-1.5 text-right ${day.rows.reduce((s, r) => s + r.pumpVolVariance, 0) < 0 ? 'text-red-600' : 'text-amber-600'}`}>
                    {fmtV(day.rows.reduce((s, r) => s + r.pumpVolVariance, 0))}
                  </td>
                  <td colSpan={3}></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}
