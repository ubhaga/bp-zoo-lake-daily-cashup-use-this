import type { DailyCashup } from "@/types/cashup";

/** Sum of additional Attendant Short/(Over) rows added via the "+ Add Attendant Short/(Over)" button. */
export function sumExtraAttendantShortOver(shop: DailyCashup["shop"]): number {
  return (shop.extraAttendantShortOvers ?? []).reduce((s, r) => s + (r.amount || 0), 0);
}

/** Sum of additional Customer to Pay/(Paid) rows added via the "+ Add Customer to Pay/(Paid)" button. */
export function sumExtraCustomerToPay(shop: DailyCashup["shop"]): number {
  return (shop.extraCustomerToPays ?? []).reduce((s, r) => s + (r.amount || 0), 0);
}

/** Combined sum of all extra Section 8 named rows. */
export function sumExtraSection8(shop: DailyCashup["shop"]): number {
  return sumExtraAttendantShortOver(shop) + sumExtraCustomerToPay(shop);
}