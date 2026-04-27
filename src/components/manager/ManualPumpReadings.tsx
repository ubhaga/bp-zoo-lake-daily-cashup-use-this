import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Section } from '@/components/ui/CashupUI';
import { format, subDays, parseISO } from 'date-fns';
import { useMasterDataStore } from '@/store/masterDataStore';

type ReadingKey = string;
type Readings = Record<ReadingKey, number>;

interface NozzleRow {
  key: ReadingKey;          // e.g. "p1_n2"
  pumpNumber: string;
  nozzleNumber: number;
  tankNumber: string;       // references TankDescription.tankNumber
  label: string;            // "Pump 1 — Nozzle 2"
}

interface ReadingRow {
  id: string;
  date: string;
  month: string;
  readings: Readings;
}

interface Props {
  selectedDate: string;
}

export function ManualPumpReadings({ selectedDate }: Props) {
  const tanks = useMasterDataStore(s => s.tanks);
  const pumps = useMasterDataStore(s => s.pumps);
  const [allReadings, setAllReadings] = useState<ReadingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<Readings>({});
  const [dirty, setDirty] = useState(false);
  const month = selectedDate.slice(0, 7);
  const prevMonthLastDay = format(subDays(parseISO(month + '-01'), 1), 'yyyy-MM-dd');
  const prevMonth = prevMonthLastDay.slice(0, 7);

  // Build flat nozzle list from settings (one row per nozzle)
  const nozzleRows: NozzleRow[] = pumps.flatMap(p =>
    p.nozzles.map(n => ({
      key: `p${p.pumpNumber}_n${n.nozzleNumber}`,
      pumpNumber: p.pumpNumber,
      nozzleNumber: n.nozzleNumber,
      tankNumber: n.tankNumber,
      label: `Pump ${p.pumpNumber} — Nozzle ${n.nozzleNumber}`,
    }))
  );

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('manual_pump_readings')
      .select('*')
      .or(`month.eq.${month},month.eq.${prevMonth}`)
      .order('date');
    if (data) {
      setAllReadings(data.map(r => ({
        id: r.id, date: r.date, month: r.month,
        readings: (r.readings as Readings) ?? {},
      })));
    }
    setLoading(false);
  }, [month, prevMonth]);

  useEffect(() => { load(); }, [load]);

  const currentDayReading = allReadings.find(r => r.date === selectedDate);
  const currentReadings: Readings = currentDayReading?.readings ?? {};
  const prevDate = format(subDays(parseISO(selectedDate), 1), 'yyyy-MM-dd');
  const prevDayReading = allReadings.find(r => r.date === prevDate);
  const prevReadings: Readings = prevDayReading?.readings ?? {};

  // Sync draft from persisted readings whenever the selected date or its row changes
  useEffect(() => {
    setDraft(currentReadings);
    setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, currentDayReading?.id, loading]);

  const handleChange = (readingKey: ReadingKey, value: number) => {
    setDraft(prev => ({ ...prev, [readingKey]: value }));
    setDirty(true);
  };

  const handleSave = async () => {
    setSaving(true);
    const newReadings = draft;
    if (currentDayReading) {
      await supabase
        .from('manual_pump_readings')
        .update({ readings: newReadings as unknown as Record<string, unknown>, updated_at: new Date().toISOString() } as never)
        .eq('id', currentDayReading.id);
      setAllReadings(prev => prev.map(r => r.id === currentDayReading.id ? { ...r, readings: newReadings } : r));
    } else {
      const { data } = await supabase
        .from('manual_pump_readings')
        .insert({ date: selectedDate, month, readings: newReadings as unknown as Record<string, unknown> } as never)
        .select()
        .single();
      if (data) {
        setAllReadings(prev => [...prev, { id: (data as any).id, date: selectedDate, month, readings: newReadings }]);
      }
    }
    setSaving(false);
    setDirty(false);
  };

  const fmtV = (n: number) => n.toLocaleString('en-ZA', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

  // Calculate volumes per nozzle (handle meter rollover at 1,000,000)
  const getVolume = (key: ReadingKey) => {
    const today = draft[key] ?? 0;
    const prev = prevReadings[key] ?? 0;
    if (today <= 0 || prev <= 0) return 0;
    if (today < prev) {
      // Meter rolled over from 999999 → 0
      return (1000000 - prev) + today;
    }
    return today - prev;
  };

  // Tank summary — aggregate nozzle volumes by tank
  const tankSummary = tanks.map(t => {
    const tankNozzles = nozzleRows.filter(n => n.tankNumber === t.tankNumber);
    const totalVolume = tankNozzles.reduce((sum, n) => sum + getVolume(n.key), 0);
    return {
      tankNumber: t.tankNumber,
      label: `Tank ${t.tankNumber} — ${t.grade}`,
      color: t.color,
      nozzles: tankNozzles,
      totalVolume,
    };
  });

  const tankLabel = (tankNumber: string) => {
    const t = tanks.find(x => x.tankNumber === tankNumber);
    return t ? `Tank ${t.tankNumber} — ${t.grade}` : `Tank ${tankNumber}`;
  };
  const tankColor = (tankNumber: string) =>
    tanks.find(x => x.tankNumber === tankNumber)?.color || 'hsl(var(--muted-foreground))';

  if (loading) return <div className="py-4 text-center text-muted-foreground text-sm">Loading pump readings...</div>;

  return (
    <Section title="4. Manual Pump Readings" color="default">
      <div className="px-3 py-2">
        <p className="text-xs text-muted-foreground mb-2">
          Capture daily cumulative meter readings per nozzle. Volume = Today − Yesterday. Pump &amp; nozzle layout is configured in <strong>Settings → Pump Tank Layout</strong>.
        </p>
        <div className="flex items-center justify-end gap-3 mb-2">
          {dirty && !saving && <span className="text-xs text-destructive font-medium">Unsaved changes</span>}
          {saving && <span className="text-xs text-primary font-medium">Saving...</span>}
          <button
            type="button"
            onClick={handleSave}
            disabled={!dirty || saving}
            className="px-3 py-1.5 text-xs font-medium rounded-md bg-primary text-primary-foreground disabled:opacity-50 disabled:cursor-not-allowed hover:bg-primary/90"
          >
            Save Entry
          </button>
        </div>

        {nozzleRows.length === 0 ? (
          <div className="border rounded-lg p-4 text-sm text-muted-foreground text-center bg-muted/20">
            No pumps configured. Add pumps and nozzles in <strong>Settings → Pump Tank Layout</strong>.
          </div>
        ) : (
          <>
        {/* Tabular readings */}
        <div className="overflow-x-auto border rounded-lg mb-4">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-muted/40 border-b">
                <th className="px-2 py-1.5 text-left font-medium w-16">Pump</th>
                <th className="px-2 py-1.5 text-left font-medium w-16">Nozzle</th>
                <th className="px-2 py-1.5 text-left font-medium">Tank Feeder</th>
                <th className="px-2 py-1.5 text-right font-medium">Yesterday</th>
                <th className="px-2 py-1.5 text-right font-medium">Today's Reading</th>
                <th className="px-2 py-1.5 text-right font-medium">Volume</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {nozzleRows.map(row => {
                const reading = draft[row.key] ?? 0;
                const prev = prevReadings[row.key] ?? 0;
                const volume = getVolume(row.key);
                return (
                  <tr key={row.key} className="hover:bg-muted/20">
                    <td className="px-2 py-1 font-medium">#{row.pumpNumber}</td>
                    <td className="px-2 py-1">{row.nozzleNumber}</td>
                    <td className="px-2 py-1">
                      <span className="inline-flex items-center gap-1.5">
                        <span
                          className="w-2.5 h-2.5 rounded-full border shrink-0"
                          style={{ backgroundColor: tankColor(row.tankNumber) }}
                        />
                        {tankLabel(row.tankNumber)}
                      </span>
                    </td>
                    <td className="px-2 py-1 text-right text-muted-foreground">{prev > 0 ? fmtV(prev) : '—'}</td>
                    <td className="px-2 py-1 text-right">
                      <input
                        type="number"
                        value={reading || ''}
                        onChange={e => handleChange(row.key, parseInt(e.target.value) || 0)}
                        className="input-cell text-[#020508] bg-[#e4ebf2] w-28 text-right ml-auto"
                        placeholder="0"
                      />
                    </td>
                    <td className={`px-2 py-1 text-right font-semibold ${volume < 0 ? 'text-destructive' : ''}`}>
                      {volume !== 0 ? fmtV(volume) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Tank Summary */}
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-muted/40 border-b">
                <th className="px-2 py-1.5 text-left font-medium">Tank</th>
                <th className="px-2 py-1.5 text-left font-medium">Nozzles</th>
                <th className="px-2 py-1.5 text-right font-medium">Total Volume</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {tankSummary.map(t => (
                <tr key={t.tankNumber} className="hover:bg-muted/20">
                  <td className="px-2 py-1.5 font-medium">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full border shrink-0" style={{ backgroundColor: t.color }} />
                      {t.label}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-muted-foreground">
                    {t.nozzles.length === 0
                      ? '—'
                      : t.nozzles.map(n => `P${n.pumpNumber}/N${n.nozzleNumber}`).join(', ')}
                  </td>
                  <td className="px-2 py-1.5 text-right font-semibold">{t.totalVolume !== 0 ? fmtV(t.totalVolume) : '—'}</td>
                </tr>
              ))}
              <tr className="bg-muted/20 font-semibold">
                <td className="px-2 py-1.5" colSpan={2}>Total All Tanks</td>
                <td className="px-2 py-1.5 text-right">{fmtV(tankSummary.reduce((s, t) => s + t.totalVolume, 0))}</td>
              </tr>
            </tbody>
          </table>
        </div>
          </>
        )}
      </div>
    </Section>
  );
}
