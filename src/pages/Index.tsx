import { useState, useEffect } from "react";
import { format, getDaysInMonth } from "date-fns";
import { CashierDailyForm } from "@/components/cashier/CashierDailyForm";
import { ManagerDailyForm } from "@/components/manager/ManagerDailyForm";
import { ManagerMonthlyForm } from "@/components/manager/ManagerMonthlyForm";
import { Dashboard } from "@/components/dashboard/Dashboard";
import { Reports } from "@/components/reports/Reports";
import { MasterDataSettings } from "@/components/settings/MasterDataSettings";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  LayoutDashboard,
  ClipboardList,
  Briefcase,
  BarChart3,
  CalendarCheck,
  Settings,
  Loader2,
  GitCompareArrows,
  FileSpreadsheet,
  ChevronLeft,
  ChevronRight,
  Fuel,
  Upload,
} from "lucide-react";
import { BankStatementTab } from "@/components/reports/BankStatementTab";
import { BankRulesTab } from "@/components/reports/BankRulesTab";
import { DayEndUpload } from "@/components/uploads/DayEndUpload";
import { AfsJournalEntries } from "@/components/afs/AfsJournalEntries";
import { AfsMonthly } from "@/components/afs/AfsMonthly";
import { FuelDashboard } from "@/components/fuel/FuelDashboard";
import { FuelSalesControl } from "@/components/fuel/FuelSalesControl";
import { MeterSalesControl } from "@/components/fuel/MeterSalesControl";
import { PosSalesPerTank } from "@/components/fuel/PosSalesPerTank";
import { useCashupStore } from "@/store/cashupStore";
import { useMasterDataStore } from "@/store/masterDataStore";

export default function Index() {
  const [activeTab, setActiveTab] = useState("dashboard");
  const [afsSubTab, setAfsSubTab] = useState("jes");
  const [fuelSubTab, setFuelSubTab] = useState("fuel-dashboard");
  const [uploadsSubTab, setUploadsSubTab] = useState("bank");
  const [selectedDate, setSelectedDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const cashupLoaded = useCashupStore((s) => s.loaded);
  const loadCashups = useCashupStore((s) => s.loadAll);
  const masterLoaded = useMasterDataStore((s) => s.loaded);
  const loadMaster = useMasterDataStore((s) => s.loadAll);
  const siteName = useMasterDataStore((s) => s.siteName);

  useEffect(() => {
    if (!cashupLoaded) loadCashups();
    if (!masterLoaded) loadMaster();
  }, []);

  // Keep document title in sync with the site name from settings
  useEffect(() => {
    if (siteName) document.title = `${siteName} Daily Cashup`;
  }, [siteName]);

  // Cross-tab navigation requested by other components (e.g. Settings → Bank Statement link)
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ tab?: string; subtab?: string; date?: string }>).detail;
      if (!detail) return;
      if (detail.date) setSelectedDate(detail.date);
      if (detail.tab === 'bank' || detail.subtab === 'bank') {
        setActiveTab('uploads');
        setUploadsSubTab('bank');
      } else if (detail.tab) {
        setActiveTab(detail.tab);
      }
    };
    window.addEventListener('lovable:nav', handler as EventListener);
    return () => window.removeEventListener('lovable:nav', handler as EventListener);
  }, []);

  if (!cashupLoaded || !masterLoaded) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex items-center gap-3 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>Loading data...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background sticky-table-scope">
      {/* Header */}
      <header className="border-b bg-card shadow-sm">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-primary rounded-lg p-2">
              <ClipboardList className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-foreground">{siteName} Cashup System</h1>
              <p className="text-xs text-muted-foreground">Daily Cashup & Reconciliation</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {activeTab === "manager-monthly" ? (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    const d = new Date(selectedDate.slice(0, 7) + "-01");
                    d.setMonth(d.getMonth() - 1);
                    if (d >= new Date("2026-01-01")) setSelectedDate(format(d, "yyyy-MM") + "-01");
                  }}
                  className="p-1.5 rounded-md border border-blue-600 bg-blue-600 text-primary-foreground disabled:opacity-50"
                  disabled={selectedDate.slice(0, 7) <= "2026-01"}
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <input
                  type="month"
                  value={selectedDate.slice(0, 7)}
                  min="2026-01"
                  onChange={(e) => setSelectedDate(e.target.value + "-01")}
                  className="border border-input rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-ring bg-blue-600 text-primary-foreground text-base font-bold"
                />
                <button
                  onClick={() => {
                    const d = new Date(selectedDate.slice(0, 7) + "-01");
                    d.setMonth(d.getMonth() + 1);
                    setSelectedDate(format(d, "yyyy-MM") + "-01");
                  }}
                  className="p-1.5 rounded-md border border-blue-600 bg-blue-600 text-primary-foreground"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      const d = new Date(selectedDate.slice(0, 7) + "-01");
                      d.setMonth(d.getMonth() - 1);
                      if (d >= new Date("2026-01-01")) {
                        const newMonth = format(d, "yyyy-MM");
                        const currentDay = parseInt(selectedDate.slice(8, 10), 10) || 1;
                        const daysInNewMonth = getDaysInMonth(new Date(newMonth + "-01"));
                        const clampedDay = Math.min(currentDay, daysInNewMonth);
                        setSelectedDate(`${newMonth}-${String(clampedDay).padStart(2, "0")}`);
                      }
                    }}
                    className="p-1.5 rounded-md border border-blue-600 bg-blue-600 text-primary-foreground disabled:opacity-50"
                    disabled={selectedDate.slice(0, 7) <= "2026-01"}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <input
                    type="month"
                    value={selectedDate.slice(0, 7)}
                    min="2026-01"
                    onChange={(e) => {
                      const newMonth = e.target.value;
                      const currentDay = parseInt(selectedDate.slice(8, 10), 10) || 1;
                      const daysInNewMonth = getDaysInMonth(new Date(newMonth + "-01"));
                      const clampedDay = Math.min(currentDay, daysInNewMonth);
                      setSelectedDate(`${newMonth}-${String(clampedDay).padStart(2, "0")}`);
                    }}
                    className="border border-input rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-ring bg-blue-600 text-primary-foreground text-base font-bold"
                  />
                  <button
                    onClick={() => {
                      const d = new Date(selectedDate.slice(0, 7) + "-01");
                      d.setMonth(d.getMonth() + 1);
                      const newMonth = format(d, "yyyy-MM");
                      const currentDay = parseInt(selectedDate.slice(8, 10), 10) || 1;
                      const daysInNewMonth = getDaysInMonth(new Date(newMonth + "-01"));
                      const clampedDay = Math.min(currentDay, daysInNewMonth);
                      setSelectedDate(`${newMonth}-${String(clampedDay).padStart(2, "0")}`);
                    }}
                    className="p-1.5 rounded-md border border-blue-600 bg-blue-600 text-primary-foreground"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground w-10 text-right">
                    Day {parseInt(selectedDate.slice(8, 10), 10)}
                  </span>
                  <input
                    type="range"
                    min={1}
                    max={getDaysInMonth(new Date(selectedDate.slice(0, 7) + "-01"))}
                    value={parseInt(selectedDate.slice(8, 10), 10) || 1}
                    onChange={(e) => {
                      const day = parseInt(e.target.value, 10);
                      setSelectedDate(`${selectedDate.slice(0, 7)}-${String(day).padStart(2, "0")}`);
                    }}
                    className="w-40 accent-primary cursor-pointer"
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-4">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid grid-cols-10 w-full mb-4">
            <TabsTrigger value="dashboard" className="flex items-center gap-1.5 text-xs">
              <LayoutDashboard className="h-3.5 w-3.5" />
              Dashboard
            </TabsTrigger>
            <TabsTrigger value="cashier" className="flex items-center gap-1.5 text-xs">
              <ClipboardList className="h-3.5 w-3.5" />
              Cashier Daily
            </TabsTrigger>
            <TabsTrigger value="manager-daily" className="flex items-center gap-1.5 text-xs">
              <Briefcase className="h-3.5 w-3.5" />
              Manager Daily
            </TabsTrigger>
            <TabsTrigger value="manager-monthly" className="flex items-center gap-1.5 text-xs">
              <CalendarCheck className="h-3.5 w-3.5" />
              Manager Monthly
            </TabsTrigger>
            <TabsTrigger value="reports" className="flex items-center gap-1.5 text-xs">
              <BarChart3 className="h-3.5 w-3.5" />
              Reports
            </TabsTrigger>
            <TabsTrigger value="recons" className="flex items-center gap-1.5 text-xs">
              <GitCompareArrows className="h-3.5 w-3.5" />
              Daily Sales Recons
            </TabsTrigger>
            <TabsTrigger value="fuel-recon" className="flex items-center gap-1.5 text-xs">
              <Fuel className="h-3.5 w-3.5" />
              Fuel Recon
            </TabsTrigger>
            <TabsTrigger value="afs" className="flex items-center gap-1.5 text-xs">
              <FileSpreadsheet className="h-3.5 w-3.5" />
              AFS
            </TabsTrigger>
            <TabsTrigger value="uploads" className="flex items-center gap-1.5 text-xs">
              <Upload className="h-3.5 w-3.5" />
              Uploads
            </TabsTrigger>
            <TabsTrigger value="settings" className="flex items-center gap-1.5 text-xs">
              <Settings className="h-3.5 w-3.5" />
              Settings
            </TabsTrigger>
          </TabsList>

          <TabsContent value="dashboard">
            <Dashboard
              selectedDate={selectedDate}
              onNavigateToDate={(date) => {
                setSelectedDate(date);
                setActiveTab("cashier");
              }}
            />
          </TabsContent>
          <TabsContent value="cashier">
            <CashierDailyForm selectedDate={selectedDate} onDateChange={setSelectedDate} />
          </TabsContent>
          <TabsContent value="manager-daily">
            <ManagerDailyForm selectedDate={selectedDate} onDateChange={setSelectedDate} />
          </TabsContent>
          <TabsContent value="manager-monthly">
            <ManagerMonthlyForm selectedDate={selectedDate} />
          </TabsContent>
          <TabsContent value="reports">
            <Reports
              mode="reports"
              onNavigateToDate={(date) => {
                setSelectedDate(date);
                setActiveTab("manager-daily");
              }}
            />
          </TabsContent>
          <TabsContent value="recons">
            <Reports
              mode="recons"
              onNavigateToDate={(date) => {
                setSelectedDate(date);
                setActiveTab("cashier");
              }}
            />
          </TabsContent>
          <TabsContent value="afs">
            <Tabs value={afsSubTab} onValueChange={setAfsSubTab}>
              <div className="flex items-center justify-between mb-4">
                <TabsList>
                  <TabsTrigger value="jes" className="text-xs">
                    JE's
                  </TabsTrigger>
                  <TabsTrigger value="afs-monthly" className="text-xs">
                    AFS Monthly
                  </TabsTrigger>
                </TabsList>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      const d = new Date(selectedDate.slice(0, 7) + "-01");
                      d.setMonth(d.getMonth() - 1);
                      if (d >= new Date("2026-01-01")) setSelectedDate(format(d, "yyyy-MM") + "-01");
                    }}
                    className="p-1.5 rounded-md border bg-blue-600 text-primary-foreground disabled:opacity-50"
                    disabled={selectedDate.slice(0, 7) <= "2026-01"}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <input
                    type="month"
                    value={selectedDate.slice(0, 7)}
                    min="2026-01"
                    onChange={(e) => setSelectedDate(e.target.value + "-01")}
                    className="text-sm border border-input rounded-md px-3 py-1.5 bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                  <button
                    onClick={() => {
                      const d = new Date(selectedDate.slice(0, 7) + "-01");
                      d.setMonth(d.getMonth() + 1);
                      setSelectedDate(format(d, "yyyy-MM") + "-01");
                    }}
                    className="p-1.5 rounded-md border bg-blue-600 text-primary-foreground"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <TabsContent value="jes">
                <AfsJournalEntries
                  selectedDate={selectedDate}
                  onNavigateToDate={(date) => {
                    setSelectedDate(date);
                    setActiveTab("manager-daily");
                  }}
                />
              </TabsContent>
              <TabsContent value="afs-monthly">
                <AfsMonthly selectedDate={selectedDate} />
              </TabsContent>
            </Tabs>
          </TabsContent>
          <TabsContent value="fuel-recon">
            <Tabs value={fuelSubTab} onValueChange={setFuelSubTab}>
              <div className="flex items-center justify-between mb-4">
                <TabsList>
                  <TabsTrigger value="fuel-dashboard" className="text-xs">
                    Daily Summ Dashboard
                  </TabsTrigger>
                  <TabsTrigger value="fuel-sales" className="text-xs">
                    Fuel Sales Control
                  </TabsTrigger>
                  <TabsTrigger value="meter-sales" className="text-xs">
                    Electric Meter Sales Control
                  </TabsTrigger>

                  <TabsTrigger value="meter-sales" className="text-xs">​</TabsTrigger>
                  <TabsTrigger value="pos-sales" className="text-xs">
                    POS Sales Per Tank
                  </TabsTrigger>
                </TabsList>
                <div className="flex items-center gap-2">
                  <input
                    type="month"
                    value={selectedDate.slice(0, 7)}
                    min="2026-01"
                    onChange={(e) => setSelectedDate(e.target.value + "-01")}
                    className="text-sm border border-input rounded-md px-3 py-1.5 bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
              </div>
              <TabsContent value="fuel-dashboard">
                <FuelDashboard selectedDate={selectedDate} />
              </TabsContent>
              <TabsContent value="fuel-sales">
                <FuelSalesControl selectedDate={selectedDate} />
              </TabsContent>
              <TabsContent value="meter-sales">
                <MeterSalesControl selectedDate={selectedDate} />
              </TabsContent>
              <TabsContent value="pos-sales">
                <PosSalesPerTank selectedDate={selectedDate} />
              </TabsContent>
            </Tabs>
          </TabsContent>
          <TabsContent value="uploads">
            <Tabs value={uploadsSubTab} onValueChange={setUploadsSubTab}>
              <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
                <TabsList>
                  <TabsTrigger value="dayend" className="text-xs">
                    Day End Reports
                  </TabsTrigger>
                  <TabsTrigger value="bank" className="text-xs">
                    Bank Statement
                  </TabsTrigger>
                  <TabsTrigger value="bank-rules" className="text-xs">
                    Bank Rules
                  </TabsTrigger>
                </TabsList>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      const d = new Date(selectedDate.slice(0, 7) + "-01");
                      d.setMonth(d.getMonth() - 1);
                      if (d >= new Date("2026-01-01")) {
                        const newMonth = format(d, "yyyy-MM");
                        const currentDay = parseInt(selectedDate.slice(8, 10), 10) || 1;
                        const daysInNewMonth = getDaysInMonth(new Date(newMonth + "-01"));
                        const clampedDay = Math.min(currentDay, daysInNewMonth);
                        setSelectedDate(`${newMonth}-${String(clampedDay).padStart(2, "0")}`);
                      }
                    }}
                    className="p-1.5 rounded-md border border-blue-600 bg-blue-600 text-primary-foreground disabled:opacity-50"
                    disabled={selectedDate.slice(0, 7) <= "2026-01"}
                    aria-label="Previous month"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <input
                    type="month"
                    value={selectedDate.slice(0, 7)}
                    min="2026-01"
                    onChange={(e) => {
                      const newMonth = e.target.value;
                      const currentDay = parseInt(selectedDate.slice(8, 10), 10) || 1;
                      const daysInNewMonth = getDaysInMonth(new Date(newMonth + "-01"));
                      const clampedDay = Math.min(currentDay, daysInNewMonth);
                      setSelectedDate(`${newMonth}-${String(clampedDay).padStart(2, "0")}`);
                    }}
                    className="border border-input rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-ring bg-blue-600 text-primary-foreground text-sm font-bold"
                  />
                  <button
                    onClick={() => {
                      const d = new Date(selectedDate.slice(0, 7) + "-01");
                      d.setMonth(d.getMonth() + 1);
                      const newMonth = format(d, "yyyy-MM");
                      const currentDay = parseInt(selectedDate.slice(8, 10), 10) || 1;
                      const daysInNewMonth = getDaysInMonth(new Date(newMonth + "-01"));
                      const clampedDay = Math.min(currentDay, daysInNewMonth);
                      setSelectedDate(`${newMonth}-${String(clampedDay).padStart(2, "0")}`);
                    }}
                    className="p-1.5 rounded-md border border-blue-600 bg-blue-600 text-primary-foreground"
                    aria-label="Next month"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <TabsContent value="bank">
                <BankStatementTab
                  filterMonth={selectedDate.slice(0, 7)}
                  monthLabel={format(new Date(selectedDate.slice(0, 7) + "-01"), "MMMM yyyy")}
                />
              </TabsContent>
              <TabsContent value="bank-rules">
                <BankRulesTab filterMonth={selectedDate.slice(0, 7)} />
              </TabsContent>
              <TabsContent value="dayend">
                <DayEndUpload filterMonth={selectedDate.slice(0, 7)} />
              </TabsContent>
            </Tabs>
          </TabsContent>
          <TabsContent value="settings">
            <MasterDataSettings />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
