import type { DailyCashup } from "@/types/cashup";
import { extractCashierDailyAutofill, extractDayEndPayouts } from "@/lib/dayEndPayouts";
import { extractDayEndDebtors } from "@/lib/dayEndDebtors";
import { extractNetAccDebtors, extractNetAccSalesTotal, isNetAccContent } from "@/lib/dayEndNetAcc";

export interface DayEndReportMetrics {
  payoutTotal: number | null;
  shopIncome: number | null;
  optIncome: number | null;
  shopAccountsTotal: number | null;
}

export function parseDayEndReportMetrics(content: string | null | undefined): DayEndReportMetrics | null {
  if (!content) return null;

  if (isNetAccContent(content)) {
    const debtors = extractNetAccDebtors(content);
    return {
      payoutTotal: extractDayEndPayouts(content),
      shopIncome: extractNetAccSalesTotal(content),
      optIncome: null,
      shopAccountsTotal: debtors.length ? debtors.reduce((s, d) => s + d.amount, 0) : null,
    };
  }

  const autofill = extractCashierDailyAutofill(content);
  const debtors = extractDayEndDebtors(content);
  return {
    payoutTotal: extractDayEndPayouts(content),
    shopIncome: autofill?.shopIncome ?? null,
    optIncome: autofill?.optIncome ?? null,
    shopAccountsTotal: debtors.length ? debtors.reduce((s, d) => s + d.amount, 0) : null,
  };
}

export function getCashierBalanceMetrics(
  cashup: DailyCashup,
  dateStr: string,
  report?: DayEndReportMetrics | null,
  previousCashup?: DailyCashup,
) {
  // Always recalculate from the saved Cashier Daily inputs so Dashboard/Manager match
  // the live Short/(Over) shown on the Cashier Daily form after uploaded data is applied.
  // The persisted shortOver field is only a snapshot from the last save and can become stale
  // when report/autofill parsing or editable MOP data changes.
  const shopIncome = report?.shopIncome ?? cashup.shop.income;
  const shopReturns = cashup.shop.returns;
  const returnsMop = cashup.shop.returns_mop;
  const shopNetSales = shopIncome - shopReturns - (cashup.shop.returns_today ?? 0);
  const optIncome = report?.optIncome ?? cashup.opt.income;
  const optNetSales = optIncome - cashup.opt.returns;

  const savedPayoutsTotal = cashup.shop.payouts.reduce((s, p) => s + p.amount, 0);
  const useDayEndPayouts = dateStr >= "2026-03-01";
  const shopPayoutsTotal = useDayEndPayouts && report?.payoutTotal != null
    ? Math.max(0, report.payoutTotal - (cashup.shop.lottoPayouts ?? 0))
    : (savedPayoutsTotal !== 0
        ? savedPayoutsTotal
        : 0);
  const shopReceipts = cashup.shop.receipts.reduce((s, r) => s + r.amount, 0);
  const shopTakings = useDayEndPayouts
    ? shopNetSales - shopPayoutsTotal + shopReceipts
    : shopNetSales - shopPayoutsTotal - cashup.shop.lottoPayouts + shopReceipts;

  const cashConnectTotal = cashup.shop.cashDepositedBanking + cashup.shop.easyPay + cashup.shop.coins;
  const shopSP = cashup.shop.speedpoints.reduce((s, sp) => s + sp.shopAmount, 0);
  const optSP = cashup.opt.speedpoints.reduce((s, sp) => s + sp.optAmount, 0);
  const savedShopAcc = cashup.shop.accounts.reduce((s, a) => s + a.amount, 0);
  const shopAcc = savedShopAcc !== 0 ? savedShopAcc : (report?.shopAccountsTotal ?? 0);
  const optAcc = cashup.opt.accounts.reduce((s, a) => s + a.amount, 0);
  const shopOther = cashup.shop.otherAdjustments.reduce((s, o) => s + o.amount, 0);
  const extraAttendant = (cashup.shop.extraAttendantShortOvers ?? []).reduce((s, r) => s + (r.amount || 0), 0);
  const extraCustomer = (cashup.shop.extraCustomerToPays ?? []).reduce((s, r) => s + (r.amount || 0), 0);
  const extraCustomerEFT = (cashup.shop.extraCustomerPaidEFTs ?? []).reduce((s, r) => s + (r.amount || 0), 0);
  const customerToPay = cashup.shop.customerToPay ?? 0;
  const customerPaidEFT = cashup.shop.customerPaidEFT ?? 0;

  const shopDiff =
    shopTakings -
    cashConnectTotal -
    shopSP -
    shopAcc -
    shopOther -
    returnsMop -
    (cashup.shop.returnsNotCaptured ?? 0) -
    cashup.shop.attendantShortOver -
    customerToPay -
    customerPaidEFT -
    extraAttendant -
    extraCustomer -
    extraCustomerEFT;
  const optDiff = optNetSales - optSP - optAcc;

  return {
    shopNetSales,
    optNetSales,
    totalNetSales: shopNetSales + optNetSales,
    shopPayoutsTotal,
    shopReceipts,
    shopTakings,
    cashConnectTotal,
    shopSP,
    optSP,
    shopAcc,
    optAcc,
    shopOther,
    shopDiff,
    optDiff,
  };
}