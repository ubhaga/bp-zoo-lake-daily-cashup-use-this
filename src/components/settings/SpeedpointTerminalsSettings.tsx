import { useState } from 'react';
import { Plus, Trash2, Pencil, Check, X, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useMasterDataStore, type SpeedpointTerminal, type SpeedpointShift } from '@/store/masterDataStore';
import { toast } from '@/hooks/use-toast';

interface SectionProps {
  title: string;
  color: string;
  shift: 'shop' | 'opt';
  /** Terminals visible in this section (shift matches OR shift === 'both') */
  terminals: SpeedpointTerminal[];
  allTerminals: SpeedpointTerminal[];
  onAdd: (term: SpeedpointTerminal) => void;
  onUpdate: (oldName: string, term: SpeedpointTerminal) => Promise<{ renamedRows: number }>;
  onDelete: (name: string) => Promise<{ ok: boolean; usedIn?: string }>;
  onOpenBank: (pattern: string, terminalName: string) => void;
}

function TerminalSection({
  title, color, shift, terminals, allTerminals, onAdd, onUpdate, onDelete, onOpenBank,
}: SectionProps) {
  const [newName, setNewName] = useState('');
  const [newPattern, setNewPattern] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editPattern, setEditPattern] = useState('');
  const [editShift, setEditShift] = useState<SpeedpointShift>('shop');

  const handleAdd = () => {
    const name = newName.trim();
    if (!name) {
      toast({ title: 'Missing name', description: 'Enter a terminal name first.', variant: 'destructive' });
      return;
    }
    if (allTerminals.some(t => t.name.toLowerCase() === name.toLowerCase())) {
      toast({ title: 'Duplicate', description: `"${name}" already exists.`, variant: 'destructive' });
      return;
    }
    onAdd({ name, shift, bankPattern: newPattern.trim() });
    setNewName('');
    setNewPattern('');
    toast({ title: 'Terminal added', description: `${name} added to ${shift.toUpperCase()}.` });
  };

  const startEdit = (t: SpeedpointTerminal) => {
    setEditing(t.name);
    setEditName(t.name);
    setEditPattern(t.bankPattern);
    setEditShift(t.shift);
  };

  const confirmEdit = async (oldName: string) => {
    const name = editName.trim();
    if (!name) return;
    if (name !== oldName && allTerminals.some(t => t.name.toLowerCase() === name.toLowerCase())) {
      toast({ title: 'Duplicate', description: `"${name}" already exists.`, variant: 'destructive' });
      return;
    }
    const { renamedRows } = await onUpdate(oldName, { name, shift: editShift, bankPattern: editPattern.trim() });
    setEditing(null);
    toast({
      title: 'Terminal updated',
      description: oldName !== name && renamedRows > 0
        ? `Renamed across ${renamedRows} cashup record(s).`
        : 'Saved.',
    });
  };

  const handleDelete = async (name: string) => {
    const result = await onDelete(name);
    if (!result.ok) {
      toast({
        title: 'Cannot delete',
        description: `"${name}" is referenced by ${result.usedIn}. Rename it instead.`,
        variant: 'destructive',
      });
      return;
    }
    toast({ title: 'Removed', description: `"${name}" removed.` });
  };

  return (
    <div className="border rounded-lg overflow-hidden">
      <div className={`${color} text-white px-4 py-2.5 font-semibold text-sm flex items-center justify-between`}>
        <span>{title}</span>
        <span className="text-xs font-normal opacity-80">{terminals.length} terminals</span>
      </div>

      {/* Add new */}
      <div className="grid grid-cols-[1fr_1fr_auto] gap-2 p-3 border-b bg-muted/20 items-center">
        <input
          value={newName}
          onChange={e => setNewName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleAdd()}
          placeholder="Terminal # / Description (e.g. Term 247608)"
          className="text-sm border border-input rounded-md px-3 py-1.5 bg-background focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <input
          value={newPattern}
          onChange={e => setNewPattern(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleAdd()}
          placeholder="Bank statement match (e.g. 247608)"
          className="text-sm border border-input rounded-md px-3 py-1.5 bg-background focus:outline-none focus:ring-2 focus:ring-ring font-mono"
        />
        <Button size="sm" onClick={handleAdd}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Add
        </Button>
      </div>

      {/* Column headers */}
      <div className="grid grid-cols-[1fr_1fr_auto_auto] gap-2 px-3 py-1.5 bg-muted/30 text-xs font-medium text-muted-foreground items-center">
        <span>Terminal # / Description</span>
        <span>Bank Statement Pattern</span>
        <span className="w-20 text-center">In Both?</span>
        <span className="w-20 text-right">Actions</span>
      </div>

      {/* List */}
      <div className="max-h-72 overflow-y-auto divide-y">
        {terminals.map(t => (
          <div key={t.name} className="grid grid-cols-[1fr_1fr_auto_auto] gap-2 px-3 py-1.5 items-center hover:bg-muted/30 group">
            {editing === t.name ? (
              <>
                <input
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') confirmEdit(t.name); if (e.key === 'Escape') setEditing(null); }}
                  autoFocus
                  className="text-sm border border-input rounded px-2 py-0.5 bg-background"
                />
                <input
                  value={editPattern}
                  onChange={e => setEditPattern(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') confirmEdit(t.name); if (e.key === 'Escape') setEditing(null); }}
                  placeholder="(no auto-match)"
                  className="text-sm border border-input rounded px-2 py-0.5 bg-background font-mono"
                />
                <select
                  value={editShift}
                  onChange={e => setEditShift(e.target.value as SpeedpointShift)}
                  className="text-xs border border-input rounded px-1 py-0.5 bg-background w-20"
                >
                  <option value={shift}>{shift.toUpperCase()} only</option>
                  <option value="both">Both</option>
                </select>
                <div className="w-20 flex justify-end gap-1">
                  <button onClick={() => confirmEdit(t.name)} className="text-green-600 hover:text-green-700 p-1">
                    <Check className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => setEditing(null)} className="text-muted-foreground hover:text-foreground p-1">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </>
            ) : (
              <>
                <span className="text-sm font-medium">{t.name}</span>
                <span className="text-sm font-mono text-muted-foreground flex items-center gap-1">
                  {t.bankPattern || <span className="italic text-xs">— no auto-match —</span>}
                  {t.bankPattern && (
                    <button
                      onClick={() => onOpenBank(t.bankPattern, t.name)}
                      title="View matched bank statement lines"
                      className="text-primary hover:text-primary/70 p-0.5 opacity-60 group-hover:opacity-100 transition-opacity"
                    >
                      <ExternalLink className="h-3 w-3" />
                    </button>
                  )}
                </span>
                <span className="w-20 text-center text-xs text-muted-foreground">
                  {t.shift === 'both' ? '✓ Both' : '—'}
                </span>
                <div className="w-20 flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => startEdit(t)} className="text-muted-foreground hover:text-foreground p-1">
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => handleDelete(t.name)} className="text-destructive hover:text-destructive/70 p-1">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </>
            )}
          </div>
        ))}
        {terminals.length === 0 && (
          <div className="px-3 py-4 text-sm text-muted-foreground text-center">
            No terminals in this section yet.
          </div>
        )}
      </div>
    </div>
  );
}

export function SpeedpointTerminalsSettings() {
  const store = useMasterDataStore();

  const shopTerminals = store.speedpointTerminals.filter(t => t.shift === 'shop' || t.shift === 'both');
  const optTerminals = store.speedpointTerminals.filter(t => t.shift === 'opt' || t.shift === 'both');

  // When user clicks the bank-link icon, jump to Uploads → Bank tab and pre-filter by pattern
  const handleOpenBank = (pattern: string, terminalName: string) => {
    try {
      sessionStorage.setItem('bank_filter_pattern', pattern);
      sessionStorage.setItem('bank_filter_label', terminalName);
    } catch {
      // noop
    }
    window.dispatchEvent(new CustomEvent('lovable:nav', { detail: { tab: 'uploads', subtab: 'bank' } }));
    toast({
      title: 'Bank Statement',
      description: `Showing lines matching "${pattern}" (${terminalName}).`,
    });
  };

  return (
    <div className="space-y-4 max-w-5xl">
      <p className="text-xs text-muted-foreground px-1">
        Define every speedpoint terminal used at the till. The <strong>Bank Statement Pattern</strong> is matched
        against the bank statement description (case-insensitive substring or regex) to auto-categorise upload
        lines. Terminals marked <em>Both</em> appear in both the Shop and OPT MOP sections.
      </p>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <TerminalSection
          title="Shop Speedpoint Terminals"
          color="bg-blue-700"
          shift="shop"
          terminals={shopTerminals}
          allTerminals={store.speedpointTerminals}
          onAdd={t => store.addSpeedpointTerminal(t)}
          onUpdate={(old, t) => store.updateSpeedpointTerminal(old, t)}
          onDelete={name => store.deleteSpeedpointTerminal(name)}
          onOpenBank={handleOpenBank}
        />
        <TerminalSection
          title="OPT (Forecourt) Speedpoint Terminals"
          color="bg-orange-700"
          shift="opt"
          terminals={optTerminals}
          allTerminals={store.speedpointTerminals}
          onAdd={t => store.addSpeedpointTerminal(t)}
          onUpdate={(old, t) => store.updateSpeedpointTerminal(old, t)}
          onDelete={name => store.deleteSpeedpointTerminal(name)}
          onOpenBank={handleOpenBank}
        />
      </div>
    </div>
  );
}
