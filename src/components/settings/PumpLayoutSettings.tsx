import { useState } from 'react';
import { Plus, Trash2, Pencil, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useMasterDataStore, type PumpLayout, type PumpNozzle } from '@/store/masterDataStore';
import { toast } from '@/hooks/use-toast';

const MAX_NOZZLES = 6;

const emptyDraft = (): { pumpNumber: string; nozzles: PumpNozzle[] } => ({
  pumpNumber: '',
  nozzles: [{ nozzleNumber: 1, tankNumber: '' }],
});

function PumpEditor({
  draft,
  setDraft,
  tankOptions,
}: {
  draft: { pumpNumber: string; nozzles: PumpNozzle[] };
  setDraft: (d: { pumpNumber: string; nozzles: PumpNozzle[] }) => void;
  tankOptions: { tankNumber: string; grade: string }[];
}) {
  const setNozzle = (idx: number, patch: Partial<PumpNozzle>) => {
    setDraft({
      ...draft,
      nozzles: draft.nozzles.map((n, i) => (i === idx ? { ...n, ...patch } : n)),
    });
  };
  const addNozzle = () => {
    if (draft.nozzles.length >= MAX_NOZZLES) return;
    setDraft({
      ...draft,
      nozzles: [...draft.nozzles, { nozzleNumber: draft.nozzles.length + 1, tankNumber: '' }],
    });
  };
  const removeNozzle = (idx: number) => {
    if (draft.nozzles.length <= 1) return;
    const next = draft.nozzles.filter((_, i) => i !== idx).map((n, i) => ({ ...n, nozzleNumber: i + 1 }));
    setDraft({ ...draft, nozzles: next });
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <label className="text-xs text-muted-foreground w-24">Pump #</label>
        <input
          value={draft.pumpNumber}
          onChange={e => setDraft({ ...draft, pumpNumber: e.target.value })}
          placeholder="e.g. 1"
          className="w-32 text-sm border border-input rounded-md px-2 py-1.5 bg-background focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <span className="text-xs text-muted-foreground ml-auto">
          {draft.nozzles.length}/{MAX_NOZZLES} nozzles
        </span>
        <Button
          size="sm"
          variant="outline"
          onClick={addNozzle}
          disabled={draft.nozzles.length >= MAX_NOZZLES}
        >
          <Plus className="h-3.5 w-3.5 mr-1" /> Nozzle
        </Button>
      </div>

      <div className="border rounded-md divide-y">
        <div className="flex items-center gap-2 px-2 py-1 bg-muted/40 text-xs font-medium text-muted-foreground">
          <span className="w-20">Nozzle #</span>
          <span className="flex-1">Tank Feeder</span>
          <span className="w-8" />
        </div>
        {draft.nozzles.map((n, i) => (
          <div key={i} className="flex items-center gap-2 px-2 py-1.5">
            <span className="w-20 text-sm font-medium">#{n.nozzleNumber}</span>
            <select
              value={n.tankNumber}
              onChange={e => setNozzle(i, { tankNumber: e.target.value })}
              className="flex-1 text-sm border border-input rounded-md px-2 py-1 bg-background focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">— Select tank —</option>
              {tankOptions.map(t => (
                <option key={t.tankNumber} value={t.tankNumber}>
                  Tank {t.tankNumber} — {t.grade}
                </option>
              ))}
            </select>
            <button
              onClick={() => removeNozzle(i)}
              disabled={draft.nozzles.length <= 1}
              className="text-destructive hover:text-destructive/70 p-1 disabled:opacity-30 disabled:cursor-not-allowed"
              title="Remove nozzle"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export function PumpLayoutSettings() {
  const store = useMasterDataStore();
  const [newDraft, setNewDraft] = useState(emptyDraft());
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState(emptyDraft());

  const tankOptions = store.tanks.map(t => ({ tankNumber: t.tankNumber, grade: t.grade }));

  const validate = (d: { pumpNumber: string; nozzles: PumpNozzle[] }): string | null => {
    if (!d.pumpNumber.trim()) return 'Pump # is required.';
    if (d.nozzles.length === 0) return 'At least one nozzle required.';
    if (d.nozzles.some(n => !n.tankNumber)) return 'Every nozzle must have a tank feeder.';
    return null;
  };

  const handleAdd = () => {
    const err = validate(newDraft);
    if (err) { toast({ title: 'Cannot add pump', description: err, variant: 'destructive' }); return; }
    if (store.pumps.some(p => p.pumpNumber.toLowerCase() === newDraft.pumpNumber.trim().toLowerCase())) {
      toast({ title: 'Duplicate', description: `Pump ${newDraft.pumpNumber} already exists.`, variant: 'destructive' });
      return;
    }
    store.addPump({ pumpNumber: newDraft.pumpNumber.trim(), nozzles: newDraft.nozzles });
    setNewDraft(emptyDraft());
    toast({ title: 'Pump added' });
  };

  const startEdit = (i: number) => {
    const p = store.pumps[i];
    setEditIdx(i);
    setEditDraft({ pumpNumber: p.pumpNumber, nozzles: p.nozzles.map(n => ({ ...n })) });
  };

  const confirmEdit = () => {
    if (editIdx === null) return;
    const err = validate(editDraft);
    if (err) { toast({ title: 'Cannot save', description: err, variant: 'destructive' }); return; }
    store.updatePump(editIdx, { pumpNumber: editDraft.pumpNumber.trim(), nozzles: editDraft.nozzles });
    setEditIdx(null);
    toast({ title: 'Pump updated' });
  };

  const tankLabel = (tankNumber: string) => {
    const t = store.tanks.find(x => x.tankNumber === tankNumber);
    return t ? `Tank ${t.tankNumber} — ${t.grade}` : `Tank ${tankNumber}`;
  };

  const tankColor = (tankNumber: string) =>
    store.tanks.find(x => x.tankNumber === tankNumber)?.color || '#94A3B8';

  return (
    <div className="border rounded-lg overflow-hidden max-w-3xl">
      <div className="bg-sky-700 text-white px-4 py-2.5 font-semibold text-sm flex items-center justify-between">
        <span>Pump Tank Layout</span>
        <span className="text-xs font-normal opacity-80">{store.pumps.length} pumps</span>
      </div>

      {/* Add new pump */}
      <div className="p-3 border-b bg-muted/20 space-y-3">
        {store.tanks.length === 0 ? (
          <p className="text-xs text-destructive">
            Add at least one tank in <strong>Tank Descriptions</strong> before configuring pumps.
          </p>
        ) : (
          <>
            <PumpEditor draft={newDraft} setDraft={setNewDraft} tankOptions={tankOptions} />
            <div className="flex justify-end">
              <Button size="sm" onClick={handleAdd}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Add Pump
              </Button>
            </div>
          </>
        )}
      </div>

      {/* Existing pumps */}
      <div className="divide-y">
        {store.pumps.map((pump, i) => (
          <div key={i} className="px-3 py-2 hover:bg-muted/30 group">
            {editIdx === i ? (
              <div className="space-y-2">
                <PumpEditor draft={editDraft} setDraft={setEditDraft} tankOptions={tankOptions} />
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setEditIdx(null)}>
                    <X className="h-3.5 w-3.5 mr-1" /> Cancel
                  </Button>
                  <Button size="sm" onClick={confirmEdit}>
                    <Check className="h-3.5 w-3.5 mr-1" /> Save
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-3">
                <div className="w-20 shrink-0">
                  <div className="text-xs text-muted-foreground">Pump</div>
                  <div className="text-base font-bold">#{pump.pumpNumber}</div>
                </div>
                <div className="flex-1 space-y-1">
                  {pump.nozzles.map((n, ni) => (
                    <div key={ni} className="flex items-center gap-2 text-sm">
                      <span className="w-16 text-muted-foreground">Nozzle {n.nozzleNumber}</span>
                      <span
                        className="w-3 h-3 rounded-full border shrink-0"
                        style={{ backgroundColor: tankColor(n.tankNumber) }}
                      />
                      <span>{tankLabel(n.tankNumber)}</span>
                    </div>
                  ))}
                </div>
                <div className="opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
                  <button onClick={() => startEdit(i)} className="text-muted-foreground hover:text-foreground p-1">
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => { store.deletePump(i); toast({ title: 'Pump removed' }); }}
                    className="text-destructive hover:text-destructive/70 p-1"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
        {store.pumps.length === 0 && (
          <div className="px-3 py-4 text-sm text-muted-foreground text-center">
            No pumps configured. Add your first pump above.
          </div>
        )}
      </div>
    </div>
  );
}
