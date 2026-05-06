export interface PayoutLine {
  id: string;
  vendor: string;
  amount: number;
  isLotto?: boolean;
}

export interface ReceiptLine {
  id: string;
  type: string;
  seqNo: string;
  amount: number;
}

export interface OtherAdjustment {
  id: string;
  explanation: string;
  amount: number;
}

export interface NamedAdjustment {
  id: string;
  name: string;
  amount: number;
}

export interface SpeedpointEntry {
  terminal: string;
  batchNo: string;
  shopAmount: number;
  optAmount: number;
}

export interface AccountEntry {
  id: string;
  name: string;
  amount: number;
}

export interface CashierShift {
  // Section 1 - Income
  income: number;
  returns: number; // yesterday shift
  returns_today: number; // new field
  // Section 2 - Payouts
  payouts: PayoutLine[];
  lottoPayouts: number;
  // Section 3 - Receipts
  receipts: ReceiptLine[];
  // MOP Cash (shop only)
  cashConnectTotal: number;
  cashDepositedBanking: number;
  easyPay: number;
  deepFrozenCC: number;
  coins: number;
  // MOP Speedpoints
  speedpoints: SpeedpointEntry[];
  // MOP Account
  accounts: AccountEntry[];
  // Other adjustments
  otherAdjustments: OtherAdjustment[];
  returns_mop: number;
  returnsNotCaptured: number;
  attendantShortOver: number;
  attendantName: string;
  customerToPay: number;
  customerName: string;
  // Additional rows added via "Add Attendant Short/(Over)" / "Add Customer to Pay/(Paid)" buttons.
  // Each follows the same rules as the base row (amount + name required when amount != 0)
  // and is summed into Section 8 totals across the system.
  extraAttendantShortOvers?: NamedAdjustment[];
  extraCustomerToPays?: NamedAdjustment[];
  extraCustomerPaidEFTs?: NamedAdjustment[];
  customerPaidEFT?: number;
  customerPaidEFTName?: string;
  /** Exact Short/(Over) shown and saved from the Cashier Daily form. */
  shortOver?: number;
}

export interface DailyCashup {
  id: string;
  date: string;
  month: string;
  enteredBy: string;
  shopShiftNumber: number;
  optShiftNumber: number;
  cashierName: string;
  shop: CashierShift;
  opt: Omit<
    CashierShift,
    | "cashConnectTotal"
    | "cashDepositedBanking"
    | "easyPay"
    | "deepFrozenCC"
    | "coins"
    | "receipts"
    | "otherAdjustments"
    | "accounts"
    | "payouts"
    | "lottoPayouts"
    | "returns_mop"
    | "returnsNotCaptured"
    | "attendantShortOver"
    | "attendantName"
    | "customerToPay"
    | "customerName"
  > & {
    income: number;
    returns: number;
    speedpoints: SpeedpointEntry[];
    accounts: AccountEntry[];
    /** Exact Short/(Over) shown and saved from the Cashier Daily form. */
    shortOver?: number;
  };
  notes: string;
  locked: boolean;
}

export interface InvoiceLine {
  id: string;
  supplier: string;
  /** Free-text vendor name; used when supplier === 'Sundry Supplier' to
   * identify the actual vendor. Optional for all other suppliers. */
  vendorName?: string;
  category: string;
  branchDocNum: string;
  inclusive: number;
  vat: number;
  autoImported?: boolean;
}

export interface ManagerDailyEntry {
  id: string;
  date: string;
  cashupId: string;
  enteredBy: string;
  explanations: string;
  // Payout invoices
  payoutInvoices: InvoiceLine[];
  // EFT invoices
  eftInvoices: InvoiceLine[];
  // Cash reconciliation
  coinsOpeningBalance: number;
  easypayOpeningBalance: number;
  cashConnectOpeningBalance: number;
  dailyCoins: number;
  cashDepositedEasypay: number;
  cashDepositedCashConnect: number;
  ccBagClosureCoins: number;
  ccBagClosureEasypay: number;
  ccBagClosureCashConnect: number;
  transferFromCoins: number;
  // Branch day end
  branchDayEndTotal: number;
  branchDayEndVat: number;
  invoiceNotes: string;
  cashReconcNotes: string;
  bankChargesRate: number; // cents per R100 inclusive
  bankCharges: number;
  banking: number;
  deepFrozenCC: number;
  blueLabelComm: number;
  easypayComm: number;
  lottoComm: number;
  lottoNetSalesComm: number;
  lottoPayoutComm: number;
  locked: boolean;
}

export interface MonthlyBranchFigures {
  id: string;
  month: string;
  enteredBy: string;
  // Branch report figures
  branchNetSales: number;
  branchTotalPayouts: number;
  branchTotalReceipts: number;
  branchTotalInvoicesCapital: number;
  branchTotalInvoicesVat: number;
  // Month End Report (Other)
  salesCStore: number;
  salesWslDsl: number;
  salesFuel: number;
  salesGas: number;
  salesOil: number;
  adjCStore: number;
  adjWslDsl: number;
  adjFuel: number;
  adjGas: number;
  adjOil: number;
  adjVat: number;
  vatTaxAmount: number;
  // Explanations per metric
  explanationNetSales: string;
  explanationPayouts: string;
  explanationReceipts: string;
  explanationInvoices: string;
  explanationVat: string;
  // Airtime / Lotto month-end balances
  airtimeBldBalance: number;
  airtimeEasypayBalance: number;
  airtimeLottoBalance: number;
  // Misc
  notes: string;
}

export type DashboardStatus = "green" | "red" | "pending";

export interface DailyDashboardMetric {
  label: string;
  spreadsheetValue: number;
  branchValue: number;
  status: DashboardStatus;
}
