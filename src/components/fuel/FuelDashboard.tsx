import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { parseEodShort, parsePumpVariance, type EodShortRow, type PumpVarianceRow } from '@/lib/fuelReportParser';
import { format } from 'date-fns';
import { AlertTriangle, CheckCircle, Fuel } from 'lucide-react';
import { useMasterDataStore, getTankColor } from '@/store/masterDataStore';

interface Props {
  selectedDate: string;
}

interface DaySummary {
  date: string;
  grades: GradeSummary[];
  totalPumpVol: number;
  totalTankVol: number;
  totalMeterCalc: number;
  totalMeterActual: number;
  tankVsPumpVar: number;
  meterVsPosVar: number;
}

interface GradeSummary {
  gradeId: string;
  description: string;
  posPumpVol: number;
  posTankVol: number;
  posVariance: number;
  meterCalcVol: number;
  meterActualVol: number;
  meterVariance: number;
}

export function FuelDashboard({ selectedDate }: Props) {
  const [days, setDays] = useState<DaySummary[]>([]);
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
      const summaries: DaySummary[] = data.map(d => {
        const eodShort = parseEodShort(d.content);
        const pumpVar = parsePumpVariance(d.content);

        // Aggregate meter data by grade
        const meterByGrade: Record<string, { calc: number; actual: number; var: number }> = {};
        pumpVar.forEach(p => {
          if (!meterByGrade[p.gradeId]) meterByGrade[p.gradeId] = { calc: 0, actual: 0, var: 0 };
          meterByGrade[p.gradeId].calc += p.calculatedVolume;
          meterByGrade[p.gradeId].actual += p.actualVolume;
          meterByGrade[p.gradeId].var += p.volumeVariance;
        });

        const grades: GradeSummary[] = eodShort.map(e => ({
          gradeId: e.gradeId,
          description: e.gradeDescription,
          posPumpVol: e.pumpVolSales,
          posTankVol: e.tankVolSales,
          posVariance: e.pumpVolVariance,
          meterCalcVol: meterByGrade[e.gradeId]?.calc ?? 0,
          meterActualVol: meterByGrade[e.gradeId]?.actual ?? 0,
          meterVariance: meterByGrade[e.gradeId]?.var ?? 0,
        }));

        const totalPumpVol = grades.reduce((s, g) => s + g.posPumpVol, 0);
        const totalTankVol = grades.reduce((s, g) => s + g.posTankVol, 0);
        const totalMeterCalc = grades.reduce((s, g) => s + g.meterCalcVol, 0);
        const totalMeterActual = grades.reduce((s, g) => s + g.meterActualVol, 0);

        return {
          date: d.date,
          grades,
          totalPumpVol,
          totalTankVol,
          totalMeterCalc,
          totalMeterActual,
          tankVsPumpVar: totalTankVol - totalPumpVol,
          meterVsPosVar: totalMeterActual - totalPumpVol,
        };
      }).filter(d => d.grades.length > 0);

      setDays(summaries);
    } else {
      setDays([]);
    }
    setLoading(false);
  }, [month]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="py-8 text-center text-muted-foreground text-sm">Loading...</div>;
  if (days.length === 0) return <div className="py-8 text-center text-muted-foreground text-sm">No fuel data found. Upload Day End Reports first.</div>;

  const fmtV = (n: number) => n.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const getVarColor = (n: number, threshold = 5) =>
    Math.abs(n) > threshold ? 'text-red-600' : Math.abs(n) > 1 ? 'text-amber-600' : 'text-green-600';

  const getVarIcon = (n: number, threshold = 5) =>
    Math.abs(n) > threshold ? <AlertTriangle className="h-3.5 w-3.5 text-red-500" /> : <CheckCircle className="h-3.5 w-3.5 text-green-500" />;

  return (
    <div className="space-y-4">
      <div className="bg-card border rounded-lg overflow-x-clip">
        <div className="px-4 py-2 bg-muted/50 border-b">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Fuel className="h-4 w-4" />
            Daily Fuel Summary — {format(new Date(month + '-01'), 'MMMM yyyy')}
          </h3>
          <p className="text-xs text-muted-foreground">
            Highlights variances between Tank, Meter, and POS sales per day
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b">
                <th className="px-3 py-2 text-left font-medium sticky top-0 z-10 bg-muted">Date</th>
                <th className="px-3 py-2 text-right font-medium sticky top-0 z-10 bg-muted">POS Pump (L)</th>
                <th className="px-3 py-2 text-right font-medium sticky top-0 z-10 bg-muted">Tank Sales (L)</th>
                <th className="px-3 py-2 text-right font-medium sticky top-0 z-10 bg-muted">Tank vs Pump</th>
                <th className="px-3 py-2 text-right font-medium sticky top-0 z-10 bg-muted">Meter Actual (L)</th>
                <th className="px-3 py-2 text-right font-medium sticky top-0 z-10 bg-muted">Meter vs POS</th>
                <th className="px-3 py-2 text-center font-medium sticky top-0 z-10 bg-muted">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {days.map(day => (
                <tr key={day.date} className="hover:bg-muted/20">
                  <td className="px-3 py-1.5 font-medium">{format(new Date(day.date), 'EEE dd MMM')}</td>
                  <td className="px-3 py-1.5 text-right">{fmtV(day.totalPumpVol)}</td>
                  <td className="px-3 py-1.5 text-right">{fmtV(day.totalTankVol)}</td>
                  <td className={`px-3 py-1.5 text-right font-semibold ${getVarColor(day.tankVsPumpVar, 50)}`}>
                    {fmtV(day.tankVsPumpVar)}
                  </td>
                  <td className="px-3 py-1.5 text-right">{fmtV(day.totalMeterActual)}</td>
                  <td className={`px-3 py-1.5 text-right font-semibold ${getVarColor(day.meterVsPosVar, 10)}`}>
                    {fmtV(day.meterVsPosVar)}
                  </td>
                  <td className="px-3 py-1.5 text-center">
                    {getVarIcon(Math.max(Math.abs(day.tankVsPumpVar), Math.abs(day.meterVsPosVar)), 50)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-muted/50 font-semibold border-t">
                <td className="px-3 py-2">MTD Totals</td>
                <td className="px-3 py-2 text-right">{fmtV(days.reduce((s, d) => s + d.totalPumpVol, 0))}</td>
                <td className="px-3 py-2 text-right">{fmtV(days.reduce((s, d) => s + d.totalTankVol, 0))}</td>
                <td className={`px-3 py-2 text-right ${getVarColor(days.reduce((s, d) => s + d.tankVsPumpVar, 0), 50)}`}>
                  {fmtV(days.reduce((s, d) => s + d.tankVsPumpVar, 0))}
                </td>
                <td className="px-3 py-2 text-right">{fmtV(days.reduce((s, d) => s + d.totalMeterActual, 0))}</td>
                <td className={`px-3 py-2 text-right ${getVarColor(days.reduce((s, d) => s + d.meterVsPosVar, 0), 10)}`}>
                  {fmtV(days.reduce((s, d) => s + d.meterVsPosVar, 0))}
                </td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Variance key */}
      <div className="bg-card border rounded-lg p-4 text-xs text-muted-foreground space-y-1">
        <p className="font-semibold text-foreground text-sm mb-2">Variance Guide</p>
        <p><span className="text-red-600 font-semibold">Tank &gt; POS</span> — Possible tank leak, theft from tank, or leak from tank to pump</p>
        <p><span className="text-amber-600 font-semibold">Meter &gt; POS</span> — Possible meter calibration issue or meter fault (check both meters)</p>
        <p><span className="text-amber-600 font-semibold">POS &gt; Tank/Pump</span> — Possible calibration issue or pump test (fuel returned to tank)</p>
      </div>
    </div>
  );
}
