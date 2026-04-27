import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { parseMtdSummary, type MtdSummaryGrade } from '@/lib/fuelReportParser';
import { format } from 'date-fns';
import { useMasterDataStore, getTankColor } from '@/store/masterDataStore';

interface Props {
  selectedDate: string;
}

export function FuelSalesControl({ selectedDate }: Props) {
  const [grades, setGrades] = useState<MtdSummaryGrade[]>([]);
  const [loading, setLoading] = useState(true);
  const tanks = useMasterDataStore(s => s.tanks);
  const month = selectedDate.slice(0, 7);

  const load = useCallback(async () => {
    setLoading(true);
    // Get the latest day-end upload for the month (or the selected date)
    const { data } = await supabase
      .from('day_end_uploads')
      .select('content, date')
      .eq('month', month)
      .order('date', { ascending: false })
      .limit(1);

    if (data && data.length > 0) {
      const parsed = parseMtdSummary(data[0].content);
      setGrades(parsed);
    } else {
      setGrades([]);
    }
    setLoading(false);
  }, [month]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="py-8 text-center text-muted-foreground text-sm">Loading...</div>;
  if (grades.length === 0) return <div className="py-8 text-center text-muted-foreground text-sm">No fuel sales data found. Upload a Day End Report first.</div>;

  const fmt = (n: number) => n.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="space-y-6">
      {grades.map(grade => (
        <div key={grade.gradeId} className="border rounded-lg overflow-x-clip">
          <div className="px-4 py-2 text-sm font-semibold flex items-center justify-between text-white"
            style={{ backgroundColor: getTankColor(tanks, grade.gradeId) || getTankColor(tanks, grade.description) || 'hsl(var(--primary))' }}>
            <span>Tank {grade.gradeId} — {grade.description}</span>
            <span className="text-xs font-normal opacity-80">
              MTD Variance: {fmt(grade.monthlyVariance)}L ({fmt(grade.variancePercentage)}%)
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b">
                  <th className="px-2 py-1.5 text-left font-medium sticky top-0 z-10 bg-muted">Date</th>
                  <th className="px-2 py-1.5 text-left font-medium sticky top-0 z-10 bg-muted">Batch</th>
                  <th className="px-2 py-1.5 text-right font-medium sticky top-0 z-10 bg-muted">Pump Vol</th>
                  <th className="px-2 py-1.5 text-right font-medium sticky top-0 z-10 bg-muted">MTD Pump</th>
                  <th className="px-2 py-1.5 text-right font-medium sticky top-0 z-10 bg-muted">Opening</th>
                  <th className="px-2 py-1.5 text-right font-medium sticky top-0 z-10 bg-muted">Purchase</th>
                  <th className="px-2 py-1.5 text-right font-medium sticky top-0 z-10 bg-muted">Closing Dip</th>
                  <th className="px-2 py-1.5 text-right font-medium sticky top-0 z-10 bg-muted">Tank Vol</th>
                  <th className="px-2 py-1.5 text-right font-medium sticky top-0 z-10 bg-muted">MTD Tank</th>
                  <th className="px-2 py-1.5 text-right font-medium sticky top-0 z-10 bg-muted">Day Var</th>
                  <th className="px-2 py-1.5 text-right font-medium sticky top-0 z-10 bg-muted">MTD Var</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {grade.rows.map(row => (
                  <tr key={row.date} className="hover:bg-muted/30">
                    <td className="px-2 py-1">{format(new Date(row.date), 'dd MMM')}</td>
                    <td className="px-2 py-1">{row.batchNo}</td>
                    <td className="px-2 py-1 text-right">{fmt(row.daysPumpVolSales)}</td>
                    <td className="px-2 py-1 text-right">{fmt(row.mtdPumpVolSales)}</td>
                    <td className="px-2 py-1 text-right">{fmt(row.openingVol)}</td>
                    <td className="px-2 py-1 text-right">{fmt(row.daysVolPurchase)}</td>
                    <td className="px-2 py-1 text-right">{fmt(row.closingDip)}</td>
                    <td className="px-2 py-1 text-right">{fmt(row.daysTankVolSales)}</td>
                    <td className="px-2 py-1 text-right">{fmt(row.mtdTankVolSales)}</td>
                    <td className={`px-2 py-1 text-right font-medium ${row.daysPumpVolVariance > 0 ? 'text-green-600' : row.daysPumpVolVariance < 0 ? 'text-red-600' : ''}`}>
                      {fmt(row.daysPumpVolVariance)}
                    </td>
                    <td className={`px-2 py-1 text-right font-medium ${row.mtdPumpVolVariance > 0 ? 'text-green-600' : row.mtdPumpVolVariance < 0 ? 'text-red-600' : ''}`}>
                      {fmt(row.mtdPumpVolVariance)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-muted/50 font-semibold border-t">
                  <td colSpan={7} className="px-2 py-1.5">Monthly Totals</td>
                  <td className="px-2 py-1.5 text-right">{fmt(grade.monthlyTankSales)}</td>
                  <td className="px-2 py-1.5 text-right"></td>
                  <td className="px-2 py-1.5 text-right"></td>
                  <td className={`px-2 py-1.5 text-right ${grade.monthlyVariance > 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {fmt(grade.monthlyVariance)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}
