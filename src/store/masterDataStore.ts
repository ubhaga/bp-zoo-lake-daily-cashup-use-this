import { create } from 'zustand';
import {
  SUPPLIERS,
  ACCOUNTS as DEFAULT_ACCOUNTS,
  CASHIER_NAMES as DEFAULT_CASHIER_NAMES,
  MANAGER_NAMES as DEFAULT_MANAGER_NAMES,
  CATEGORIES as DEFAULT_CATEGORIES,
} from '@/data/masterData';
import { supabase } from '@/integrations/supabase/client';

const DEFAULT_EFT_SUPPLIERS = [...SUPPLIERS].sort();

export interface TankDescription {
  tankNumber: string;
  grade: string;
  size: number;
  color: string; // hex color for reports/recons
}

export interface PumpNozzle {
  /** Nozzle number (1-6) */
  nozzleNumber: number;
  /** Tank feeder — references TankDescription.tankNumber */
  tankNumber: string;
}

export interface PumpLayout {
  /** Pump number/identifier */
  pumpNumber: string;
  /** Nozzles on this pump (max 6) */
  nozzles: PumpNozzle[];
}

export type SpeedpointShift = 'shop' | 'opt' | 'both';

export interface SpeedpointTerminal {
  /** Display name, e.g. "Term 247608" */
  name: string;
  /** Which cashier shift sections this terminal appears in */
  shift: SpeedpointShift;
  /** Text/regex pattern matched against bank-statement descriptions */
  bankPattern: string;
}

export type SiteSystem = 'Branch' | 'ESO' | 'NetAcc';
export const SITE_SYSTEM_OPTIONS: SiteSystem[] = ['Branch', 'ESO', 'NetAcc'];

export type CashInTransit = 'Cash Connect' | 'Deposita';
export const CASH_IN_TRANSIT_OPTIONS: CashInTransit[] = ['Cash Connect', 'Deposita'];

/** Short label for the active CIT provider — "CC" for Cash Connect, "Dep" for Deposita. */
export function citShort(cit: CashInTransit): string {
  return cit === 'Deposita' ? 'Dep' : 'CC';
}

const DEFAULT_SPEEDPOINT_TERMINALS: SpeedpointTerminal[] = [
  { name: 'Term 247608',       shift: 'both', bankPattern: '247608' },
  { name: 'Forecourt 929661',  shift: 'both', bankPattern: '929661' },
  { name: 'Retail 200660',     shift: 'shop', bankPattern: '200660' },
  { name: 'V Plus',            shift: 'opt',  bankPattern: '' },
  { name: 'Scan to pay',       shift: 'both', bankPattern: '' },
];

/** Look up tank color by gradeId (tank number) or grade description */
export function getTankColor(tanks: TankDescription[], gradeIdOrDesc: string): string | undefined {
  const t = tanks.find(t => t.tankNumber === gradeIdOrDesc || t.grade.toLowerCase() === gradeIdOrDesc.toLowerCase());
  return t?.color;
}

interface MasterDataStore {
  siteName: string;
  siteSystem: SiteSystem;
  cashInTransit: CashInTransit;
  payoutSuppliers: string[];
  eftSuppliers: string[];
  accounts: string[];
  cashierNames: string[];
  managerNames: string[];
  categories: string[];
  tanks: TankDescription[];
  pumps: PumpLayout[];
  speedpointTerminals: SpeedpointTerminal[];
  loaded: boolean;

  /** Default invoice category per Payout supplier (1.1). Keyed by supplier name. */
  payoutSupplierCategories: Record<string, string>;
  /** Default invoice category per EFT/Non-Cash supplier (1.2). Keyed by supplier name. */
  eftSupplierCategories: Record<string, string>;

  loadAll: () => Promise<void>;

  setSiteName: (name: string) => void;
  setSiteSystem: (system: SiteSystem) => void;
  setCashInTransit: (cit: CashInTransit) => void;

  addPayoutSupplier: (name: string) => void;
  updatePayoutSupplier: (old: string, next: string) => void;
  deletePayoutSupplier: (name: string) => void;
  setPayoutSupplierCategory: (name: string, category: string) => void;

  addEftSupplier: (name: string) => void;
  updateEftSupplier: (old: string, next: string) => void;
  deleteEftSupplier: (name: string) => void;
  setEftSupplierCategory: (name: string, category: string) => void;

  addAccount: (name: string) => void;
  updateAccount: (old: string, next: string) => void;
  deleteAccount: (name: string) => void;

  addCashierName: (name: string) => void;
  updateCashierName: (old: string, next: string) => void;
  deleteCashierName: (name: string) => void;

  addManagerName: (name: string) => void;
  updateManagerName: (old: string, next: string) => void;
  deleteManagerName: (name: string) => void;

  addCategory: (name: string) => void;
  updateCategory: (old: string, next: string) => void;
  deleteCategory: (name: string) => void;

  addTank: (tank: TankDescription) => void;
  updateTank: (index: number, tank: TankDescription) => void;
  deleteTank: (index: number) => void;

  addPump: (pump: PumpLayout) => void;
  updatePump: (index: number, pump: PumpLayout) => void;
  deletePump: (index: number) => void;

  addSpeedpointTerminal: (term: SpeedpointTerminal) => void;
  updateSpeedpointTerminal: (oldName: string, term: SpeedpointTerminal) => Promise<{ renamedRows: number }>;
  deleteSpeedpointTerminal: (name: string) => Promise<{ ok: boolean; usedIn?: string }>;
}

const replace = (list: string[], old: string, next: string) =>
  list.map(i => (i === old ? next : i));

// Persist a single key to the master_data table
async function persistKey(key: string, data: unknown) {
  await supabase
    .from('master_data')
    .upsert({ key, data: data as never, updated_at: new Date().toISOString() } as never, { onConflict: 'key' });
}

export const useMasterDataStore = create<MasterDataStore>()((set, get) => ({
  siteName: 'Shell Craighall',
  siteSystem: 'Branch' as SiteSystem,
  cashInTransit: 'Cash Connect' as CashInTransit,
  payoutSuppliers: [...SUPPLIERS].sort(),
  eftSuppliers: DEFAULT_EFT_SUPPLIERS,
  accounts: [...DEFAULT_ACCOUNTS],
  cashierNames: [...DEFAULT_CASHIER_NAMES],
  managerNames: [...DEFAULT_MANAGER_NAMES],
  categories: [...DEFAULT_CATEGORIES].sort(),
  tanks: [] as TankDescription[],
  pumps: [] as PumpLayout[],
  speedpointTerminals: [...DEFAULT_SPEEDPOINT_TERMINALS],
  loaded: false,
  payoutSupplierCategories: {},
  eftSupplierCategories: {},

  loadAll: async () => {
    const { data } = await supabase.from('master_data').select('*');
    if (data && data.length > 0) {
      const map: Record<string, unknown> = {};
      data.forEach((r: { key: string; data: unknown }) => { map[r.key] = r.data; });
      set({
        siteName: (map.siteName as string) ?? get().siteName,
        siteSystem: ((map.siteSystem as SiteSystem) ?? get().siteSystem),
        payoutSuppliers: (map.payoutSuppliers as string[]) ?? get().payoutSuppliers,
        eftSuppliers: (map.eftSuppliers as string[]) ?? get().eftSuppliers,
        accounts: (map.accounts as string[]) ?? get().accounts,
        cashierNames: (map.cashierNames as string[]) ?? get().cashierNames,
        managerNames: (map.managerNames as string[]) ?? get().managerNames,
        categories: (map.categories as string[]) ?? get().categories,
        tanks: (map.tanks as TankDescription[]) ?? get().tanks,
        pumps: (map.pumps as PumpLayout[]) ?? get().pumps,
        speedpointTerminals: (map.speedpointTerminals as SpeedpointTerminal[]) ?? get().speedpointTerminals,
        payoutSupplierCategories: (map.payoutSupplierCategories as Record<string, string>) ?? get().payoutSupplierCategories,
        eftSupplierCategories: (map.eftSupplierCategories as Record<string, string>) ?? get().eftSupplierCategories,
        loaded: true,
      });
      // Seed speedpointTerminals for existing installs that pre-date this key
      if (!map.speedpointTerminals) {
        await persistKey('speedpointTerminals', get().speedpointTerminals);
      }
      // Seed siteName for existing installs that pre-date this key
      if (!map.siteName) {
        await persistKey('siteName', get().siteName);
      }
    } else {
      // First time: seed defaults to DB
      const state = get();
      await Promise.all([
        persistKey('siteName', state.siteName),
        persistKey('payoutSuppliers', state.payoutSuppliers),
        persistKey('eftSuppliers', state.eftSuppliers),
        persistKey('accounts', state.accounts),
        persistKey('cashierNames', state.cashierNames),
        persistKey('managerNames', state.managerNames),
        persistKey('categories', state.categories),
        persistKey('speedpointTerminals', state.speedpointTerminals),
      ]);
      set({ loaded: true });
    }
  },

  setSiteName: (name) => {
    const trimmed = name.trim() || 'Site';
    set({ siteName: trimmed });
    persistKey('siteName', trimmed);
  },

  setSiteSystem: (system) => {
    set({ siteSystem: system });
    persistKey('siteSystem', system);
  },

  setCashInTransit: (cit) => {
    set({ cashInTransit: cit });
    persistKey('cashInTransit', cit);
  },

  addPayoutSupplier: (name) => {
    set(s => {
      const next = [...s.payoutSuppliers, name].sort();
      persistKey('payoutSuppliers', next);
      return { payoutSuppliers: next };
    });
  },
  updatePayoutSupplier: (old, next) => {
    set(s => {
      const list = replace(s.payoutSuppliers, old, next).sort();
      persistKey('payoutSuppliers', list);
      const cats = { ...s.payoutSupplierCategories };
      if (cats[old] !== undefined && old !== next) {
        cats[next] = cats[old];
        delete cats[old];
        persistKey('payoutSupplierCategories', cats);
      }
      return { payoutSuppliers: list, payoutSupplierCategories: cats };
    });
  },
  deletePayoutSupplier: (name) => {
    set(s => {
      const list = s.payoutSuppliers.filter(i => i !== name);
      persistKey('payoutSuppliers', list);
      const cats = { ...s.payoutSupplierCategories };
      if (cats[name] !== undefined) {
        delete cats[name];
        persistKey('payoutSupplierCategories', cats);
      }
      return { payoutSuppliers: list, payoutSupplierCategories: cats };
    });
  },
  setPayoutSupplierCategory: (name, category) => {
    set(s => {
      const cats = { ...s.payoutSupplierCategories };
      if (!category) delete cats[name];
      else cats[name] = category;
      persistKey('payoutSupplierCategories', cats);
      return { payoutSupplierCategories: cats };
    });
  },

  addEftSupplier: (name) => {
    set(s => {
      const next = [...s.eftSuppliers, name].sort();
      persistKey('eftSuppliers', next);
      return { eftSuppliers: next };
    });
  },
  updateEftSupplier: (old, next) => {
    set(s => {
      const list = replace(s.eftSuppliers, old, next).sort();
      persistKey('eftSuppliers', list);
      const cats = { ...s.eftSupplierCategories };
      if (cats[old] !== undefined && old !== next) {
        cats[next] = cats[old];
        delete cats[old];
        persistKey('eftSupplierCategories', cats);
      }
      return { eftSuppliers: list, eftSupplierCategories: cats };
    });
  },
  deleteEftSupplier: (name) => {
    set(s => {
      const list = s.eftSuppliers.filter(i => i !== name);
      persistKey('eftSuppliers', list);
      const cats = { ...s.eftSupplierCategories };
      if (cats[name] !== undefined) {
        delete cats[name];
        persistKey('eftSupplierCategories', cats);
      }
      return { eftSuppliers: list, eftSupplierCategories: cats };
    });
  },
  setEftSupplierCategory: (name, category) => {
    set(s => {
      const cats = { ...s.eftSupplierCategories };
      if (!category) delete cats[name];
      else cats[name] = category;
      persistKey('eftSupplierCategories', cats);
      return { eftSupplierCategories: cats };
    });
  },

  addAccount: (name) => {
    set(s => {
      const next = [...s.accounts, name];
      persistKey('accounts', next);
      return { accounts: next };
    });
  },
  updateAccount: (old, next) => {
    set(s => {
      const list = replace(s.accounts, old, next);
      persistKey('accounts', list);
      return { accounts: list };
    });
  },
  deleteAccount: (name) => {
    set(s => {
      const list = s.accounts.filter(i => i !== name);
      persistKey('accounts', list);
      return { accounts: list };
    });
  },

  addCashierName: (name) => {
    set(s => {
      const next = [...s.cashierNames, name];
      persistKey('cashierNames', next);
      return { cashierNames: next };
    });
  },
  updateCashierName: (old, next) => {
    set(s => {
      const list = replace(s.cashierNames, old, next);
      persistKey('cashierNames', list);
      return { cashierNames: list };
    });
  },
  deleteCashierName: (name) => {
    set(s => {
      const list = s.cashierNames.filter(i => i !== name);
      persistKey('cashierNames', list);
      return { cashierNames: list };
    });
  },

  addManagerName: (name) => {
    set(s => {
      const next = [...s.managerNames, name];
      persistKey('managerNames', next);
      return { managerNames: next };
    });
  },
  updateManagerName: (old, next) => {
    set(s => {
      const list = replace(s.managerNames, old, next);
      persistKey('managerNames', list);
      return { managerNames: list };
    });
  },
  deleteManagerName: (name) => {
    set(s => {
      const list = s.managerNames.filter(i => i !== name);
      persistKey('managerNames', list);
      return { managerNames: list };
    });
  },

  addCategory: (name) => {
    set(s => {
      const next = [...s.categories, name].sort();
      persistKey('categories', next);
      return { categories: next };
    });
  },
  updateCategory: (old, next) => {
    set(s => {
      const list = replace(s.categories, old, next).sort();
      persistKey('categories', list);
      return { categories: list };
    });
  },
  deleteCategory: (name) => {
    set(s => {
      const list = s.categories.filter(i => i !== name);
      persistKey('categories', list);
      return { categories: list };
    });
  },

  addTank: (tank) => {
    set(s => {
      const next = [...s.tanks, tank];
      persistKey('tanks', next);
      return { tanks: next };
    });
  },
  updateTank: (index, tank) => {
    set(s => {
      const next = [...s.tanks];
      next[index] = tank;
      persistKey('tanks', next);
      return { tanks: next };
    });
  },
  deleteTank: (index) => {
    set(s => {
      const next = s.tanks.filter((_, i) => i !== index);
      persistKey('tanks', next);
      return { tanks: next };
    });
  },

  addPump: (pump) => {
    set(s => {
      if (s.pumps.some(p => p.pumpNumber.toLowerCase() === pump.pumpNumber.toLowerCase())) {
        return {};
      }
      const next = [...s.pumps, pump];
      persistKey('pumps', next);
      return { pumps: next };
    });
  },
  updatePump: (index, pump) => {
    set(s => {
      const next = [...s.pumps];
      next[index] = pump;
      persistKey('pumps', next);
      return { pumps: next };
    });
  },
  deletePump: (index) => {
    set(s => {
      const next = s.pumps.filter((_, i) => i !== index);
      persistKey('pumps', next);
      return { pumps: next };
    });
  },

  addSpeedpointTerminal: (term) => {
    set(s => {
      if (s.speedpointTerminals.some(t => t.name.toLowerCase() === term.name.toLowerCase())) {
        return {};
      }
      const next = [...s.speedpointTerminals, term];
      persistKey('speedpointTerminals', next);
      return { speedpointTerminals: next };
    });
  },

  updateSpeedpointTerminal: async (oldName, term) => {
    const state = get();
    const next = state.speedpointTerminals.map(t => (t.name === oldName ? term : t));
    set({ speedpointTerminals: next });
    await persistKey('speedpointTerminals', next);

    let renamedRows = 0;
    if (oldName !== term.name) {
      const { data: cashups } = await supabase
        .from('daily_cashups')
        .select('id, shop, opt');
      if (cashups) {
        for (const c of cashups as Array<{ id: string; shop: { speedpoints?: Array<{ terminal: string }> }; opt: { speedpoints?: Array<{ terminal: string }> } }>) {
          let touched = false;
          const shopSp = c.shop?.speedpoints?.map(sp => {
            if (sp.terminal === oldName) { touched = true; return { ...sp, terminal: term.name }; }
            return sp;
          });
          const optSp = c.opt?.speedpoints?.map(sp => {
            if (sp.terminal === oldName) { touched = true; return { ...sp, terminal: term.name }; }
            return sp;
          });
          if (touched) {
            await supabase
              .from('daily_cashups')
              .update({ shop: { ...c.shop, speedpoints: shopSp }, opt: { ...c.opt, speedpoints: optSp } } as never)
              .eq('id', c.id);
            renamedRows++;
          }
        }
      }
      await supabase
        .from('bank_statement_lines')
        .update({ matched_terminal: term.name } as never)
        .eq('matched_terminal', oldName);
      await supabase
        .from('speedpoint_manual_matches')
        .update({ terminal: term.name } as never)
        .eq('terminal', oldName);
      await supabase
        .from('speedpoint_diff_clearances')
        .update({ terminal: term.name } as never)
        .eq('terminal', oldName);
    }
    return { renamedRows };
  },

  deleteSpeedpointTerminal: async (name) => {
    const [cashups, bankLines, matches] = await Promise.all([
      supabase.from('daily_cashups').select('shop, opt'),
      supabase.from('bank_statement_lines').select('id', { count: 'exact', head: true }).eq('matched_terminal', name),
      supabase.from('speedpoint_manual_matches').select('id', { count: 'exact', head: true }).eq('terminal', name),
    ]);
    let cashupHits = 0;
    if (cashups.data) {
      for (const c of cashups.data as Array<{ shop: { speedpoints?: Array<{ terminal: string; shopAmount?: number; optAmount?: number; batchNo?: string }> }; opt: { speedpoints?: Array<{ terminal: string; shopAmount?: number; optAmount?: number; batchNo?: string }> } }>) {
        const used = [
          ...(c.shop?.speedpoints ?? []),
          ...(c.opt?.speedpoints ?? []),
        ].some(sp => sp.terminal === name && ((sp.shopAmount ?? 0) !== 0 || (sp.optAmount ?? 0) !== 0 || (sp.batchNo ?? '').trim() !== ''));
        if (used) cashupHits++;
      }
    }
    if (cashupHits > 0) return { ok: false, usedIn: `${cashupHits} cashup(s)` };
    if ((bankLines.count ?? 0) > 0) return { ok: false, usedIn: `${bankLines.count} bank line(s)` };
    if ((matches.count ?? 0) > 0) return { ok: false, usedIn: `${matches.count} manual match(es)` };

    const next = get().speedpointTerminals.filter(t => t.name !== name);
    set({ speedpointTerminals: next });
    await persistKey('speedpointTerminals', next);
    return { ok: true };
  },
}));
