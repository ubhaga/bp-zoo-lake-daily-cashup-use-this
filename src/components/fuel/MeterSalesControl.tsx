import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { parsePumpVariance, type PumpVarianceRow } from '@/lib/fuelReportParser';
import { isNetAccContent, extractNetAccPumpSales } from '@/lib/dayEndNetAcc';
import { format, subDays, parseISO } from 'date-fns';
import { useMasterDataStore, getTankColor } from '@/store/masterDataStore';

/** Adapt NetAcc Totalisors rows into PumpVarianceRow shape so MeterSalesControl
 *  can render them with the same UI. NetAcc only provides volume sold, so
 *  unknown fields are left at 0 (the manual readings fill in actuals). */
function netAccToPumpVarianceRows(content: string): PumpVarianceRow[] {
  return extractNetAccPumpSales(content).map((r) => ({
    pumpNo: r.pumpNo,
    gradeId: r.gradeId,
    gradeDescription: r.gradeDescription,
    startReading: 0,
    endReading: 0,
    calculatedVolume: r.volumeSold,
    actualVolume: r.volumeSold,
    volumeVariance: 0,
    unsettledVolume: 0,
    incUnsettledVariance: 0,
  }));
}

interface Props {
  selectedDate: string;
}

interface DayPumpData {
  date: string;
  rows: PumpVarianceRow[];
}

type Readings = Record<string, number>;

interface Revision {
  id?: string;
  revised_calc_volume: number;
  explanation: string;
}

const MANUAL_CUTOFF = '2026-04-01';

export function MeterSalesControl({ selectedDate }: Props) {
  const [dayData, setDayData] = useState<DayPumpData[]>([]);
  const [readingsByDate, setReadingsByDate] = useState<Record<string, Readings>>({});
  const [revisions, setRevisions] = useState<Record<string, Revision>>({}); // key: `${date}|${pumpNo}`
  const [expandedDate, setExpandedDate] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const tanks = useMasterDataStore(s => s.tanks);
  const pumps = useMasterDataStore(s => s.pumps);
  const month = selectedDate.slice(0, 7);
  const prevMonth = format(subDays(parseISO(month + '-01'), 1), 'yyyy-MM');

  const load = useCallback(async () => {
    setLoading(true);
    const [uploadsRes, readingsRes, revisionsRes] = await Promise.all([
      supabase.from('day_end_uploads').select('content, date').eq('month', month).order('date'),
      supabase.from('manual_pump_readings').select('date, readings').or(`month.eq.${month},month.eq.${prevMonth}`),
      supabase.from('pump_variance_revisions').select('*').eq('month', month),
    ]);

    if (uploadsRes.data) {
      const parsed: DayPumpData[] = uploadsRes.data.map(d => ({
        date: d.date,
        rows: isNetAccContent(d.content)
          ? netAccToPumpVarianceRows(d.content)
          : parsePumpVariance(d.content),
      })).filter(d => d.rows.length > 0);
      setDayData(parsed);
    } else {
      setDayData([]);
    }

    const map: Record<string, Readings> = {};
    (readingsRes.data ?? []).forEach(r => { map[r.date] = (r.readings as Readings) ?? {}; });
    setReadingsByDate(map);

    const revMap: Record<string, Revision> = {};
    (revisionsRes.data ?? []).forEach((r: any) => {
      revMap[`${r.date}|${r.pump_no}`] = {
        id: r.id,
        revised_calc_volume: Number(r.revised_calc_volume),
        explanation: r.explanation ?? '',
      };
    });
    setRevisions(revMap);

    setLoading(false);
  }, [month, prevMonth]);

  useEffect(() => { load(); }, [load]);

  const fmtV = (n: number) => n.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const normalizePump = (pumpNo: string) =>
    String(pumpNo).replace(/\D/g, '').replace(/^0+/, '') || pumpNo;

  // Find nozzle number on a pump that feeds the given tank/grade.
  // Day-end Grade ID corresponds directly to tank number (01→T1, 02→T2…).
  const findNozzleNumber = (pumpNo: string, gradeId: string): number | null => {
    const pumpNum = normalizePump(pumpNo);
    const pump = pumps.find(p => normalizePump(p.pumpNumber) === pumpNum);
    if (!pump) return null;
    const tankNum = String(parseInt(gradeId, 10));
    const nozzle = pump.nozzles.find(n => String(n.tankNumber) === tankNum);
    return nozzle ? nozzle.nozzleNumber : null;
  };

  // Per-nozzle manual volume: matches the day-end report row (one row per nozzle).
  const getManualVolForNozzle = (date: string, pumpNo: string, gradeId: string): number | null => {
    if (date < MANUAL_CUTOFF) return null;
    const today = readingsByDate[date];
    if (!today) return null;
    const prevDate = format(subDays(parseISO(date), 1), 'yyyy-MM-dd');
    const prev = readingsByDate[prevDate];
    if (!prev) return null;
    const nozzleNum = findNozzleNumber(pumpNo, gradeId);
    if (nozzleNum == null) return null;
    const pumpNum = normalizePump(pumpNo);
    const key = `p${pumpNum}_n${nozzleNum}`;
    const t = today[key];
    const p = prev[key];
    if (t == null || p == null || t === 0 || p === 0) return null;
    if (t < p) return (1000000 - p) + t; // meter rollover at 1,000,000
    return t - p;
  };

  const saveRevision = async (date: string, pumpNo: string, patch: Partial<Revision>) => {
    const key = `${date}|${pumpNo}`;
    const existing = revisions[key];
    const next: Revision = {
      ...existing,
      revised_calc_volume: existing?.revised_calc_volume ?? 0,
      explanation: existing?.explanation ?? '',
      ...patch,
    };
    setRevisions(prev => ({ ...prev, [key]: next }));
    setSavingKey(key);
    const dayMonth = date.slice(0, 7);
    if (existing?.id) {
      await supabase.from('pump_variance_revisions').update({
        revised_calc_volume: next.revised_calc_volume,
        explanation: next.explanation,
        updated_at: new Date().toISOString(),
      } as never).eq('id', existing.id);
    } else {
      const { data } = await supabase.from('pump_variance_revisions').insert({
        date, month: dayMonth, pump_no: pumpNo,
        revised_calc_volume: next.revised_calc_volume,
        explanation: next.explanation,
      } as never).select().single();
      if (data) {
        setRevisions(prev => ({ ...prev, [key]: { ...next, id: (data as any).id } }));
      }
    }
    setSavingKey(null);
  };

  const clearRevision = async (date: string, pumpNo: string) => {
    const key = `${date}|${pumpNo}`;
    const existing = revisions[key];
    if (existing?.id) {
      await supabase.from('pump_variance_revisions').delete().eq('id', existing.id);
    }
    setRevisions(prev => {
      const { [key]: _, ...rest } = prev;
      return rest;
    });
  };

  if (loading) return <div className="py-8 text-center text-muted-foreground text-sm">Loading...</div>;
  if (dayData.length === 0) return <div className="py-8 text-center text-muted-foreground text-sm">No pump variance data found. Upload Day End Reports first.</div>;

  return (
    <div className="space-y-4">
      <div className="bg-card border rounded-lg">
        <div className="px-4 py-2 bg-muted/50 border-b">
          <h3 className="text-sm font-semibold">EOD Pump Variance — {format(new Date(month + '-01'), 'MMMM yyyy')}</h3>
          <p className="text-xs text-muted-foreground">Meter readings per pump per day. Click a day to expand. Enter a Revised Calc Vol to override variance and add an explanation.</p>
        </div>
        <div className="divide-y">
          {(() => {
            let cumVar = 0;
            let cumManual = 0;
            return dayData.map(day => {
            const isExpanded = expandedDate === day.date;
            const showManual = day.date >= MANUAL_CUTOFF;
            // Effective variance using revisions where present
            const effectiveVar = day.rows.reduce((s, r) => {
              const rev = revisions[`${day.date}|${r.pumpNo}`];
              const calc = rev && rev.revised_calc_volume !== 0 ? rev.revised_calc_volume : r.calculatedVolume;
              return s + (r.actualVolume - calc);
            }, 0);
            const manualTotals = day.rows.reduce((acc, r) => {
              const mv = getManualVolForNozzle(day.date, r.pumpNo, r.gradeId);
              if (mv != null) {
                acc.var += r.actualVolume - mv;
                acc.has = true;
              }
              return acc;
            }, { var: 0, has: false });
            cumVar += effectiveVar;
            if (manualTotals.has) cumManual += manualTotals.var;
            const dayCumVar = cumVar;
            const dayCumManual = cumManual;
            const dayHasManual = manualTotals.has;
            return (
              <div key={day.date}>
                <button
                  onClick={() => setExpandedDate(isExpanded ? null : day.date)}
                  className="w-full grid grid-cols-[1fr_auto_auto_auto_auto_auto] items-center gap-6 px-4 py-2 text-sm hover:bg-muted/30 text-left"
                >
                  <span className="font-medium">{format(new Date(day.date), 'EEE dd MMM')}</span>
                  <span className="text-xs text-muted-foreground tabular-nums w-20 text-right">{day.rows.length} pumps</span>
                  <span className="text-xs font-semibold tabular-nums w-32 text-right text-amber-700">
                    Var: {fmtV(effectiveVar)}L
                  </span>
                  <span className="text-xs font-semibold tabular-nums w-32 text-right text-amber-700">
                    Cum: {fmtV(dayCumVar)}L
                  </span>
                  {showManual ? (
                    <>
                      <span className="text-xs font-semibold tabular-nums w-40 text-right text-blue-700">
                        Var (Manual): {dayHasManual ? `${fmtV(manualTotals.var)}L` : '—'}
                      </span>
                      <span className="text-xs font-semibold tabular-nums w-40 text-right text-blue-700">
                        Cum (Manual): {fmtV(dayCumManual)}L
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="w-40" />
                      <span className="w-40" />
                    </>
                  )}
                </button>
                {isExpanded && (
                  <div className="overflow-x-auto border-t bg-muted/10">
                    <table className="w-full text-xs">
                      <thead>
                        <tr>
                          <th className="px-2 py-1 text-left font-medium sticky top-0 z-10 bg-muted">Pump</th>
                          <th className="px-2 py-1 text-left font-medium sticky top-0 z-10 bg-muted">Grade</th>
                          <th className="px-2 py-1 text-right font-medium sticky top-0 z-10 bg-muted">Start</th>
                          <th className="px-2 py-1 text-right font-medium sticky top-0 z-10 bg-muted">End</th>
                          <th className="px-2 py-1 text-right font-medium sticky top-0 z-10 bg-muted">Calc Vol</th>
                          <th className="px-2 py-1 text-right font-medium sticky top-0 z-10 bg-muted">Revised Calc Vol</th>
                          <th className="px-2 py-1 text-right font-medium sticky top-0 z-10 bg-muted">Actual Vol</th>
                          <th className="px-2 py-1 text-right font-medium sticky top-0 z-10 bg-muted">Variance</th>
                          {showManual && <th className="px-2 py-1 text-right font-medium sticky top-0 z-10 bg-muted">Calc Vol (Manual)</th>}
                          {showManual && <th className="px-2 py-1 text-right font-medium sticky top-0 z-10 bg-muted">Variance (Manual)</th>}
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {day.rows.map((r, i) => {
                          const key = `${day.date}|${r.pumpNo}`;
                          const rev = revisions[key];
                          const hasRevision = !!rev && (rev.revised_calc_volume !== 0 || rev.explanation !== '');
                          const effectiveCalc = rev && rev.revised_calc_volume !== 0 ? rev.revised_calc_volume : r.calculatedVolume;
                          const variance = r.actualVolume - effectiveCalc;
                          const manualVol = showManual ? getManualVolForNozzle(day.date, r.pumpNo, r.gradeId) : null;
                          const manualVar = manualVol != null ? r.actualVolume - manualVol : null;
                          const colCount = showManual ? 10 : 8;
                          return (
                            <>
                              <tr key={i} className="hover:bg-muted/20">
                                <td className="px-2 py-1">{r.pumpNo}</td>
                                <td className="px-2 py-1">
                                  <span className="flex items-center gap-1.5">
                                    <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: getTankColor(tanks, r.gradeId) || getTankColor(tanks, r.gradeDescription) || '#94a3b8' }} />
                                    {r.gradeDescription}
                                  </span>
                                </td>
                                <td className="px-2 py-1 text-right">{fmtV(r.startReading)}</td>
                                <td className="px-2 py-1 text-right">{fmtV(r.endReading)}</td>
                                <td className={`px-2 py-1 text-right ${r.calculatedVolume < 0 ? 'text-red-600 font-semibold bg-red-50' : ''}`}>
                                  {r.calculatedVolume < 0 && <span className="mr-1">⚠</span>}
                                  {fmtV(r.calculatedVolume)}
                                </td>
                                <td className="px-2 py-1 text-right">
                                  <input
                                    type="number"
                                    step="0.01"
                                    value={rev?.revised_calc_volume || ''}
                                    onChange={e => saveRevision(day.date, r.pumpNo, { revised_calc_volume: parseFloat(e.target.value) || 0 })}
                                    className="input-cell text-[#020508] bg-[#e4ebf2] w-24 text-right ml-auto"
                                    placeholder="—"
                                  />
                                </td>
                                <td className="px-2 py-1 text-right">{fmtV(r.actualVolume)}</td>
                                <td className={`px-2 py-1 text-right font-medium ${variance < 0 ? 'text-red-600' : variance > 0 ? 'text-amber-600' : ''}`}>
                                  {fmtV(variance)}
                                  {hasRevision && rev.revised_calc_volume !== 0 && <span className="ml-1 text-[10px] text-primary" title="Using revised calc vol">*</span>}
                                </td>
                                {showManual && (
                                  <td className="px-2 py-1 text-right">{manualVol != null ? fmtV(manualVol) : '—'}</td>
                                )}
                                {showManual && (
                                  <td className={`px-2 py-1 text-right font-medium ${manualVar != null && manualVar < 0 ? 'text-red-600' : manualVar != null && manualVar > 0 ? 'text-amber-600' : ''}`}>
                                    {manualVar != null ? fmtV(manualVar) : '—'}
                                  </td>
                                )}
                              </tr>
                              {hasRevision && (
                                <tr key={`${i}-exp`} className="bg-amber-50/40">
                                  <td colSpan={colCount} className="px-2 py-1.5">
                                    <div className="flex items-start gap-2">
                                      <span className="text-[11px] font-medium text-amber-700 whitespace-nowrap pt-1">Explanation (P{r.pumpNo}):</span>
                                      <textarea
                                        value={rev.explanation}
                                        onChange={e => saveRevision(day.date, r.pumpNo, { explanation: e.target.value })}
                                        placeholder="Why was the calc vol revised?"
                                        rows={1}
                                        className="flex-1 text-xs border rounded px-2 py-1 bg-background resize-y min-h-[28px]"
                                      />
                                      <button
                                        onClick={() => clearRevision(day.date, r.pumpNo)}
                                        className="text-[11px] text-destructive hover:underline whitespace-nowrap pt-1"
                                      >
                                        Clear
                                      </button>
                                      {savingKey === key && <span className="text-[11px] text-primary pt-1">Saving...</span>}
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        <tr className="bg-muted/40 font-semibold">
                          <td colSpan={4} className="px-2 py-1">Total</td>
                          <td className="px-2 py-1 text-right">{fmtV(day.rows.reduce((s, r) => s + r.calculatedVolume, 0))}</td>
                          <td className="px-2 py-1 text-right">{fmtV(day.rows.reduce((s, r) => {
                            const rev = revisions[`${day.date}|${r.pumpNo}`];
                            return s + (rev && rev.revised_calc_volume !== 0 ? rev.revised_calc_volume : 0);
                          }, 0))}</td>
                          <td className="px-2 py-1 text-right">{fmtV(day.rows.reduce((s, r) => s + r.actualVolume, 0))}</td>
                          <td className={`px-2 py-1 text-right ${effectiveVar < 0 ? 'text-red-600' : 'text-amber-600'}`}>{fmtV(effectiveVar)}</td>
                          {showManual && (() => {
                            const totals = day.rows.reduce((acc, r) => {
                              const mv = getManualVolForNozzle(day.date, r.pumpNo, r.gradeId);
                              if (mv != null) {
                                acc.manual += mv;
                                acc.var += r.actualVolume - mv;
                                acc.has = true;
                              }
                              return acc;
                            }, { manual: 0, var: 0, has: false });
                            return (
                              <>
                                <td className="px-2 py-1 text-right">{totals.has ? fmtV(totals.manual) : '—'}</td>
                                <td className={`px-2 py-1 text-right ${totals.var < 0 ? 'text-red-600' : totals.var > 0 ? 'text-amber-600' : ''}`}>
                                  {totals.has ? fmtV(totals.var) : '—'}
                                </td>
                              </>
                            );
                          })()}
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </div>
            );
          });
          })()}
        </div>
      </div>
    </div>
  );
}
