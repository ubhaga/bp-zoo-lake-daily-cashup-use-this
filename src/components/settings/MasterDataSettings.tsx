import { useState, useEffect } from 'react';
import { Plus, Trash2, Pencil, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useMasterDataStore, type TankDescription, SITE_SYSTEM_OPTIONS, type SiteSystem } from '@/store/masterDataStore';
import { toast } from '@/hooks/use-toast';
import { SpeedpointTerminalsSettings } from './SpeedpointTerminalsSettings';
import { PumpLayoutSettings } from './PumpLayoutSettings';
import { CommissionSchedulesSettings } from './CommissionSchedulesSettings';

interface EditableListProps {
  title: string;
  color: string;
  items: string[];
  onAdd: (item: string) => void;
  onUpdate: (oldItem: string, newItem: string) => void;
  onDelete: (item: string) => void;
}

interface SupplierWithCategoryListProps {
  title: string;
  color: string;
  items: string[];
  categories: string[];
  supplierCategories: Record<string, string>;
  onAdd: (item: string) => void;
  onUpdate: (oldItem: string, newItem: string) => void;
  onDelete: (item: string) => void;
  onSetCategory: (name: string, category: string) => void;
}

function SupplierWithCategoryList({
  title,
  color,
  items,
  categories,
  supplierCategories,
  onAdd,
  onUpdate,
  onDelete,
  onSetCategory,
}: SupplierWithCategoryListProps) {
  const [newItem, setNewItem] = useState('');
  const [editingItem, setEditingItem] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  const handleAdd = () => {
    const trimmed = newItem.trim();
    if (!trimmed) return;
    if (items.map(i => i.toLowerCase()).includes(trimmed.toLowerCase())) {
      toast({ title: 'Duplicate', description: `"${trimmed}" already exists.`, variant: 'destructive' });
      return;
    }
    onAdd(trimmed);
    setNewItem('');
    toast({ title: 'Added', description: `"${trimmed}" added to ${title}.` });
  };

  const startEdit = (item: string) => {
    setEditingItem(item);
    setEditValue(item);
  };

  const confirmEdit = () => {
    const trimmed = editValue.trim();
    if (!trimmed || !editingItem) return;
    if (trimmed !== editingItem && items.map(i => i.toLowerCase()).includes(trimmed.toLowerCase())) {
      toast({ title: 'Duplicate', description: `"${trimmed}" already exists.`, variant: 'destructive' });
      return;
    }
    onUpdate(editingItem, trimmed);
    setEditingItem(null);
    toast({ title: 'Updated', description: `Renamed to "${trimmed}".` });
  };

  const cancelEdit = () => setEditingItem(null);

  const handleDelete = (item: string) => {
    onDelete(item);
    toast({ title: 'Removed', description: `"${item}" removed.` });
  };

  const sorted = [...items].sort((a, b) => a.localeCompare(b));

  return (
    <div className="border rounded-lg overflow-hidden">
      <div className={`${color} text-white px-4 py-2.5 font-semibold text-sm flex items-center justify-between`}>
        <span>{title}</span>
        <span className="text-xs font-normal opacity-80">{items.length} items</span>
      </div>

      {/* Add new */}
      <div className="flex gap-2 p-3 border-b bg-muted/20">
        <input
          value={newItem}
          onChange={e => setNewItem(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleAdd()}
          placeholder={`Add new supplier...`}
          className="flex-1 text-sm border border-input rounded-md px-3 py-1.5 bg-background focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <Button size="sm" onClick={handleAdd} className="shrink-0">
          <Plus className="h-3.5 w-3.5 mr-1" /> Add
        </Button>
      </div>

      {/* Header */}
      <div className="grid grid-cols-12 gap-2 px-3 py-1.5 bg-muted/30 text-xs font-medium text-muted-foreground border-b">
        <span className="col-span-6">Supplier</span>
        <span className="col-span-5">Default Invoice Category</span>
        <span className="col-span-1"></span>
      </div>

      {/* List */}
      <div className="max-h-96 overflow-y-auto divide-y">
        {sorted.map(item => {
          const currentCat = supplierCategories[item] ?? '';
          return (
            <div key={item} className="grid grid-cols-12 gap-2 items-center px-3 py-1.5 hover:bg-muted/30 group">
              {editingItem === item ? (
                <>
                  <div className="col-span-6 flex items-center gap-1">
                    <input
                      value={editValue}
                      onChange={e => setEditValue(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') confirmEdit(); if (e.key === 'Escape') cancelEdit(); }}
                      autoFocus
                      className="flex-1 text-sm border border-input rounded px-2 py-0.5 bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                    <button onClick={confirmEdit} className="text-green-600 hover:text-green-700 p-1">
                      <Check className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={cancelEdit} className="text-muted-foreground hover:text-foreground p-1">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="col-span-5">
                    <select
                      value={currentCat}
                      onChange={e => onSetCategory(item, e.target.value)}
                      className="w-full text-sm border border-input rounded px-2 py-0.5 bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      <option value="">— None —</option>
                      {categories.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div className="col-span-1"></div>
                </>
              ) : (
                <>
                  <span className="col-span-6 text-sm truncate" title={item}>{item}</span>
                  <div className="col-span-5">
                    <select
                      value={currentCat}
                      onChange={e => onSetCategory(item, e.target.value)}
                      className={`w-full text-sm border border-input rounded px-2 py-0.5 bg-background focus:outline-none focus:ring-2 focus:ring-ring ${currentCat ? '' : 'text-muted-foreground'}`}
                    >
                      <option value="">— None —</option>
                      {categories.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div className="col-span-1 flex justify-end gap-1">
                    <button onClick={() => startEdit(item)}
                      className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground p-1 transition-opacity">
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={() => handleDelete(item)}
                      className="opacity-0 group-hover:opacity-100 text-destructive hover:text-destructive/70 p-1 transition-opacity">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </>
              )}
            </div>
          );
        })}
        {items.length === 0 && (
          <div className="px-3 py-4 text-sm text-muted-foreground text-center">No items yet</div>
        )}
      </div>
    </div>
  );
}

function EditableList({ title, color, items, onAdd, onUpdate, onDelete }: EditableListProps) {
  const [newItem, setNewItem] = useState('');
  const [editingItem, setEditingItem] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  const handleAdd = () => {
    const trimmed = newItem.trim();
    if (!trimmed) return;
    if (items.map(i => i.toLowerCase()).includes(trimmed.toLowerCase())) {
      toast({ title: 'Duplicate', description: `"${trimmed}" already exists.`, variant: 'destructive' });
      return;
    }
    onAdd(trimmed);
    setNewItem('');
    toast({ title: 'Added', description: `"${trimmed}" added to ${title}.` });
  };

  const startEdit = (item: string) => {
    setEditingItem(item);
    setEditValue(item);
  };

  const confirmEdit = () => {
    const trimmed = editValue.trim();
    if (!trimmed || !editingItem) return;
    if (trimmed !== editingItem && items.map(i => i.toLowerCase()).includes(trimmed.toLowerCase())) {
      toast({ title: 'Duplicate', description: `"${trimmed}" already exists.`, variant: 'destructive' });
      return;
    }
    onUpdate(editingItem, trimmed);
    setEditingItem(null);
    toast({ title: 'Updated', description: `Renamed to "${trimmed}".` });
  };

  const cancelEdit = () => setEditingItem(null);

  const handleDelete = (item: string) => {
    onDelete(item);
    toast({ title: 'Removed', description: `"${item}" removed.` });
  };

  const sorted = [...items].sort((a, b) => a.localeCompare(b));

  return (
    <div className="border rounded-lg overflow-hidden">
      <div className={`${color} text-white px-4 py-2.5 font-semibold text-sm flex items-center justify-between`}>
        <span>{title}</span>
        <span className="text-xs font-normal opacity-80">{items.length} items</span>
      </div>

      {/* Add new */}
      <div className="flex gap-2 p-3 border-b bg-muted/20">
        <input
          value={newItem}
          onChange={e => setNewItem(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleAdd()}
          placeholder={`Add new ${title.toLowerCase().replace(/s$/, '')}...`}
          className="flex-1 text-sm border border-input rounded-md px-3 py-1.5 bg-background focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <Button size="sm" onClick={handleAdd} className="shrink-0">
          <Plus className="h-3.5 w-3.5 mr-1" /> Add
        </Button>
      </div>

      {/* List */}
      <div className="max-h-72 overflow-y-auto divide-y">
        {sorted.map(item => (
          <div key={item} className="flex items-center gap-2 px-3 py-1.5 hover:bg-muted/30 group">
            {editingItem === item ? (
              <>
                <input
                  value={editValue}
                  onChange={e => setEditValue(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') confirmEdit(); if (e.key === 'Escape') cancelEdit(); }}
                  autoFocus
                  className="flex-1 text-sm border border-input rounded px-2 py-0.5 bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <button onClick={confirmEdit} className="text-green-600 hover:text-green-700 p-1">
                  <Check className="h-3.5 w-3.5" />
                </button>
                <button onClick={cancelEdit} className="text-muted-foreground hover:text-foreground p-1">
                  <X className="h-3.5 w-3.5" />
                </button>
              </>
            ) : (
              <>
                <span className="flex-1 text-sm">{item}</span>
                <button onClick={() => startEdit(item)}
                  className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground p-1 transition-opacity">
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button onClick={() => handleDelete(item)}
                  className="opacity-0 group-hover:opacity-100 text-destructive hover:text-destructive/70 p-1 transition-opacity">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </>
            )}
          </div>
        ))}
        {items.length === 0 && (
          <div className="px-3 py-4 text-sm text-muted-foreground text-center">No items yet</div>
        )}
      </div>
    </div>
  );
}

export function MasterDataSettings() {
  const store = useMasterDataStore();
  const [siteNameDraft, setSiteNameDraft] = useState(store.siteName);

  // Keep draft in sync if store updates externally (e.g. after loadAll)
  useEffect(() => { setSiteNameDraft(store.siteName); }, [store.siteName]);

  const saveSiteName = () => {
    const trimmed = siteNameDraft.trim();
    if (!trimmed) {
      toast({ title: 'Site name required', variant: 'destructive' });
      return;
    }
    if (trimmed === store.siteName) return;
    store.setSiteName(trimmed);
    toast({ title: 'Site name updated', description: `Now showing "${trimmed}".` });
  };

  return (
    <div className="space-y-6">
      <div className="bg-card border rounded-lg p-4">
        <h2 className="text-base font-bold text-foreground">Master Data / Settings</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Manage the lists used across the cashup forms. Hover over an item to edit or delete it.
        </p>
      </div>

      {/* Site Name + Site System */}
      <div>
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3 px-1">
          Site Name
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-4xl">
          <div className="border rounded-lg overflow-hidden">
            <div className="bg-slate-700 text-white px-4 py-2.5 font-semibold text-sm">
              Site / Branch Name
            </div>
            <div className="p-3 bg-muted/20 space-y-2">
              <p className="text-xs text-muted-foreground">
                Used in the page header, browser tab title, and anywhere the site is referenced.
              </p>
              <div className="flex gap-2">
                <input
                  value={siteNameDraft}
                  onChange={e => setSiteNameDraft(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && saveSiteName()}
                  placeholder="e.g. Shell Craighall"
                  className="flex-1 text-sm border border-input rounded-md px-3 py-1.5 bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <Button size="sm" onClick={saveSiteName} className="shrink-0" disabled={siteNameDraft.trim() === store.siteName}>
                  <Check className="h-3.5 w-3.5 mr-1" /> Save
                </Button>
              </div>
            </div>
          </div>

          <div className="border rounded-lg overflow-hidden">
            <div className="bg-slate-700 text-white px-4 py-2.5 font-semibold text-sm">
              Site System
            </div>
            <div className="p-3 bg-muted/20 space-y-2">
              <p className="text-xs text-muted-foreground">
                Choose which system this site runs on. Controls which tabs/features are available.
              </p>
              <div className="flex gap-2 flex-wrap">
                {SITE_SYSTEM_OPTIONS.map(opt => {
                  const active = store.siteSystem === opt;
                  return (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => {
                        if (store.siteSystem === opt) return;
                        store.setSiteSystem(opt as SiteSystem);
                        toast({ title: 'Site system updated', description: `Now set to "${opt}".` });
                      }}
                      className={
                        'px-4 py-1.5 text-sm rounded-md border transition-colors ' +
                        (active
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'bg-background text-foreground border-input hover:bg-muted')
                      }
                    >
                      {opt}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Section 1.1 & 1.2 — Invoice Tables */}
      <div>
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3 px-1">
          1.1 Payout Invoice Suppliers &amp; 1.2 EFT / Non-Cash Invoice Suppliers
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          <SupplierWithCategoryList
            title="Payout Invoice Suppliers (1.1)"
            color="bg-red-600"
            items={store.payoutSuppliers}
            categories={store.categories}
            supplierCategories={store.payoutSupplierCategories}
            onAdd={item => store.addPayoutSupplier(item)}
            onUpdate={(old, next) => store.updatePayoutSupplier(old, next)}
            onDelete={item => store.deletePayoutSupplier(item)}
            onSetCategory={(name, cat) => store.setPayoutSupplierCategory(name, cat)}
          />
          <SupplierWithCategoryList
            title="EFT / Non-Cash Invoice Suppliers (1.2)"
            color="bg-orange-600"
            items={store.eftSuppliers}
            categories={store.categories}
            supplierCategories={store.eftSupplierCategories}
            onAdd={item => store.addEftSupplier(item)}
            onUpdate={(old, next) => store.updateEftSupplier(old, next)}
            onDelete={item => store.deleteEftSupplier(item)}
            onSetCategory={(name, cat) => store.setEftSupplierCategory(name, cat)}
          />
          <EditableList
            title="Invoice Categories (1.1 &amp; 1.2)"
            color="bg-amber-700"
            items={store.categories}
            onAdd={item => store.addCategory(item)}
            onUpdate={(old, next) => store.updateCategory(old, next)}
            onDelete={item => store.deleteCategory(item)}
          />
        </div>
      </div>

      {/* Other master data */}
      <div>
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3 px-1">
          Other Lists
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          <EditableList
            title="Accounts (Debtors)"
            color="bg-blue-600"
            items={store.accounts}
            onAdd={item => store.addAccount(item)}
            onUpdate={(old, next) => store.updateAccount(old, next)}
            onDelete={item => store.deleteAccount(item)}
          />
          <EditableList
            title="Cashier Names"
            color="bg-green-700"
            items={store.cashierNames}
            onAdd={item => store.addCashierName(item)}
            onUpdate={(old, next) => store.updateCashierName(old, next)}
            onDelete={item => store.deleteCashierName(item)}
          />
          <EditableList
            title="Manager Names"
            color="bg-purple-700"
            items={store.managerNames}
            onAdd={item => store.addManagerName(item)}
            onUpdate={(old, next) => store.updateManagerName(old, next)}
            onDelete={item => store.deleteManagerName(item)}
          />
        </div>
      </div>

      {/* Speedpoint Terminals */}
      <div>
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3 px-1">
          Speedpoint Terminals
        </h3>
        <SpeedpointTerminalsSettings />
      </div>

      {/* Tank Descriptions */}
      <div>
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3 px-1">
          Fuel Tanks
        </h3>
        <TankDescriptionList />
      </div>

      {/* Pump Tank Layout */}
      <div>
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3 px-1">
          Pump Tank Layout
        </h3>
        <PumpLayoutSettings />
      </div>

      {/* Commission Schedules */}
      <div>
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3 px-1">
          Commission Schedules
        </h3>
        <p className="text-xs text-muted-foreground mb-3 px-1">
          Choose which days the Blue Label, Easy Pay, and Lotto commission fields appear in
          Manager Daily. Stack multiple rules per commission if you need (e.g. every Saturday
          and the last day of the month).
        </p>
        <CommissionSchedulesSettings />
      </div>
    </div>
  );
}

const PRESET_COLORS = [
  '#EF4444', '#F97316', '#F59E0B', '#EAB308',
  '#22C55E', '#10B981', '#14B8A6', '#06B6D4',
  '#3B82F6', '#6366F1', '#8B5CF6', '#A855F7',
  '#EC4899', '#F43F5E', '#78716C', '#1E293B',
];

function ColorSwatches({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1">
      {PRESET_COLORS.map(c => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          className={`w-6 h-6 rounded-full border-2 transition-transform ${value === c ? 'border-foreground scale-110' : 'border-transparent hover:scale-110'}`}
          style={{ backgroundColor: c }}
        />
      ))}
    </div>
  );
}

function TankDescriptionList() {
  const store = useMasterDataStore();
  const [newTank, setNewTank] = useState({ tankNumber: '', grade: '', size: '', color: '#3B82F6' });
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [editVal, setEditVal] = useState({ tankNumber: '', grade: '', size: '', color: '#3B82F6' });

  const handleAdd = () => {
    if (!newTank.tankNumber.trim() || !newTank.grade.trim()) return;
    store.addTank({ tankNumber: newTank.tankNumber.trim(), grade: newTank.grade.trim(), size: parseFloat(newTank.size) || 0, color: newTank.color });
    setNewTank({ tankNumber: '', grade: '', size: '', color: '#3B82F6' });
    toast({ title: 'Tank added' });
  };

  const startEdit = (i: number) => {
    const t = store.tanks[i];
    setEditIdx(i);
    setEditVal({ tankNumber: t.tankNumber, grade: t.grade, size: String(t.size), color: t.color || '#3B82F6' });
  };

  const confirmEdit = () => {
    if (editIdx === null) return;
    store.updateTank(editIdx, { tankNumber: editVal.tankNumber.trim(), grade: editVal.grade.trim(), size: parseFloat(editVal.size) || 0, color: editVal.color });
    setEditIdx(null);
    toast({ title: 'Tank updated' });
  };

  return (
    <div className="border rounded-lg overflow-hidden max-w-2xl">
      <div className="bg-emerald-700 text-white px-4 py-2.5 font-semibold text-sm flex items-center justify-between">
        <span>Tank Descriptions</span>
        <span className="text-xs font-normal opacity-80">{store.tanks.length} tanks</span>
      </div>
      <div className="p-3 border-b bg-muted/20 space-y-2">
        <div className="flex gap-2">
          <input value={newTank.tankNumber} onChange={e => setNewTank(p => ({ ...p, tankNumber: e.target.value }))}
            placeholder="Tank #" className="w-24 text-sm border border-input rounded-md px-2 py-1.5 bg-background focus:outline-none focus:ring-2 focus:ring-ring" />
          <input value={newTank.grade} onChange={e => setNewTank(p => ({ ...p, grade: e.target.value }))}
            placeholder="Grade (e.g. ULP95)" className="flex-1 text-sm border border-input rounded-md px-2 py-1.5 bg-background focus:outline-none focus:ring-2 focus:ring-ring" />
          <input value={newTank.size} onChange={e => setNewTank(p => ({ ...p, size: e.target.value }))} type="number"
            placeholder="Size (L)" className="w-28 text-sm border border-input rounded-md px-2 py-1.5 bg-background focus:outline-none focus:ring-2 focus:ring-ring" />
          <Button size="sm" onClick={handleAdd} className="shrink-0"><Plus className="h-3.5 w-3.5 mr-1" /> Add</Button>
        </div>
        <ColorSwatches value={newTank.color} onChange={c => setNewTank(p => ({ ...p, color: c }))} />
      </div>
      <div className="divide-y">
        <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/30 text-xs font-medium text-muted-foreground">
          <span className="w-10">Colour</span>
          <span className="w-24">Tank #</span>
          <span className="flex-1">Grade</span>
          <span className="w-28 text-right">Size (L)</span>
          <span className="w-16"></span>
        </div>
        {store.tanks.map((tank, i) => (
          <div key={i} className="flex items-center gap-2 px-3 py-1.5 hover:bg-muted/30 group">
            {editIdx === i ? (
              <div className="w-full space-y-2">
                <div className="flex items-center gap-2">
                  <span className="w-10 flex items-center"><span className="w-6 h-6 rounded-full border" style={{ backgroundColor: editVal.color }} /></span>
                  <input value={editVal.tankNumber} onChange={e => setEditVal(p => ({ ...p, tankNumber: e.target.value }))}
                    className="w-24 text-sm border border-input rounded px-2 py-0.5 bg-background" autoFocus />
                  <input value={editVal.grade} onChange={e => setEditVal(p => ({ ...p, grade: e.target.value }))}
                    className="flex-1 text-sm border border-input rounded px-2 py-0.5 bg-background" />
                  <input value={editVal.size} onChange={e => setEditVal(p => ({ ...p, size: e.target.value }))} type="number"
                    className="w-28 text-sm border border-input rounded px-2 py-0.5 bg-background text-right" />
                  <div className="w-16 flex gap-1">
                    <button onClick={confirmEdit} className="text-green-600 p-1"><Check className="h-3.5 w-3.5" /></button>
                    <button onClick={() => setEditIdx(null)} className="text-muted-foreground p-1"><X className="h-3.5 w-3.5" /></button>
                  </div>
                </div>
                <div className="pl-10">
                  <ColorSwatches value={editVal.color} onChange={c => setEditVal(p => ({ ...p, color: c }))} />
                </div>
              </div>
            ) : (
              <>
                <span className="w-10 flex items-center"><span className="w-6 h-6 rounded-full border" style={{ backgroundColor: tank.color || '#3B82F6' }} /></span>
                <span className="w-24 text-sm font-medium">{tank.tankNumber}</span>
                <span className="flex-1 text-sm">{tank.grade}</span>
                <span className="w-28 text-sm text-right">{tank.size.toLocaleString()}</span>
                <div className="w-16 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => startEdit(i)} className="text-muted-foreground hover:text-foreground p-1"><Pencil className="h-3.5 w-3.5" /></button>
                  <button onClick={() => { store.deleteTank(i); toast({ title: 'Tank removed' }); }} className="text-destructive hover:text-destructive/70 p-1"><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
              </>
            )}
          </div>
        ))}
        {store.tanks.length === 0 && <div className="px-3 py-4 text-sm text-muted-foreground text-center">No tanks configured. Add your first tank above.</div>}
      </div>
    </div>
  );
}
