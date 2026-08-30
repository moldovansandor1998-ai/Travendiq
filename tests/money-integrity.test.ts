import { describe, it, expect } from "vitest";
import { splitRefund } from "@/lib/booking/refund";
import { payoutActionSchema } from "@/lib/validation";

describe("splitRefund – főkönyvi felosztás (settle_refund TS tükör)", () => {
  it("teljes refund: a provider és platform rész összege = teljes összeg", () => {
    const r = splitRefund(10000, 10000, 1500);
    expect(r.providerShare + r.platformShare).toBe(10000);
    expect(r.platformShare).toBe(1500);
    expect(r.providerShare).toBe(8500);
  });

  it("részleges refund arányosan oszlik", () => {
    const r = splitRefund(5000, 10000, 1500);
    expect(r.platformShare).toBe(750);
    expect(r.providerShare).toBe(4250);
  });

  it("kerekítés sosem veszít pénzt (részek összege = amount)", () => {
    for (const [amt, total, fee] of [[3333, 9999, 1499], [1, 3, 1], [999, 1000, 151]] as const) {
      const r = splitRefund(amt, total, fee);
      expect(r.providerShare + r.platformShare).toBe(amt);
    }
  });

  it("0 jutalék esetén minden a szolgáltatóé", () => {
    const r = splitRefund(5000, 10000, 0);
    expect(r.platformShare).toBe(0);
    expect(r.providerShare).toBe(5000);
  });
});

describe("payoutActionSchema – 'paid' csak bizonyítékkal", () => {
  const pid = "123e4567-e89b-12d3-a456-426614174000";

  it("stripe release: nincs szükség extra mezőkre (a transfer ID a bizonyíték)", () => {
    expect(payoutActionSchema.safeParse({ action: "release", payoutId: pid, method: "stripe" }).success).toBe(true);
  });

  it("manuális release referencia + dátum + megjegyzés nélkül ELKÉSZTVE", () => {
    expect(payoutActionSchema.safeParse({ action: "release_manual", payoutId: pid, method: "manual" }).success).toBe(false);
    expect(payoutActionSchema.safeParse({ action: "release_manual", payoutId: pid, method: "manual", reference: "BANK-123456" }).success).toBe(false);
    expect(payoutActionSchema.safeParse({
      action: "release_manual", payoutId: pid, method: "manual",
      reference: "BANK-123456", paidDate: "2026-08-30", note: "Wise utalás",
    }).success).toBe(true);
  });

  it("rövid referencia nem elfogadott", () => {
    expect(payoutActionSchema.safeParse({
      action: "release_manual", payoutId: pid, method: "manual",
      reference: "abc", paidDate: "2026-08-30", note: "utalás",
    }).success).toBe(false);
  });

  it("hold művelet jegyzettel", () => {
    expect(payoutActionSchema.safeParse({ action: "hold", payoutId: pid, note: "vita" }).success).toBe(true);
  });
});
