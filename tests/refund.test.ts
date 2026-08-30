import { describe, expect, it } from "vitest";
import { computeRefundAmount } from "@/lib/booking/refund";

const base = {
  grandTotalCents: 10000,
  policy: "full_until_hours" as const,
  cancelFullHours: 24,
  cancelPercent: 0,
  hoursUntilStart: 48,
  currentStatus: "confirmed",
};

describe("computeRefundAmount", () => {
  it("teljes visszatérítés a határidőn belül kívül", () => {
    expect(computeRefundAmount(base)).toBe(10000);
  });

  it("nulla a határidőn belül", () => {
    expect(computeRefundAmount({ ...base, hoursUntilStart: 12 })).toBe(0);
  });

  it("határeset: pontosan a határidőnél teljes", () => {
    expect(computeRefundAmount({ ...base, hoursUntilStart: 24 })).toBe(10000);
  });

  it("százalékos visszatérítés", () => {
    expect(computeRefundAmount({ ...base, policy: "percent_refund", cancelPercent: 50 })).toBe(5000);
  });

  it("nem visszatéríthető jegy", () => {
    expect(computeRefundAmount({ ...base, policy: "non_refundable" })).toBe(0);
  });

  it("szolgáltatói lemondás mindig 100%", () => {
    expect(computeRefundAmount({ ...base, policy: "non_refundable", cancelReason: "provider_cancelled", hoursUntilStart: 1 })).toBe(10000);
  });

  it("időjárási lemondás mindig 100%", () => {
    expect(computeRefundAmount({ ...base, cancelReason: "weather", hoursUntilStart: 0 })).toBe(10000);
  });

  it("már lemondott foglalásnál 0", () => {
    expect(computeRefundAmount({ ...base, currentStatus: "cancelled" })).toBe(0);
  });
});
