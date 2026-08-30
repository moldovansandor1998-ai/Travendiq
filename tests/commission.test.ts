import { describe, expect, it } from "vitest";
import { resolveCommissionRate, splitAmounts, DEFAULT_COMMISSION } from "@/lib/commission";

describe("resolveCommissionRate prioritás", () => {
  it("alapértelmezett 15%", () => {
    expect(resolveCommissionRate({})).toBe(DEFAULT_COMMISSION);
  });
  it("globális szabály", () => {
    expect(resolveCommissionRate({ globalRate: 12 })).toBe(12);
  });
  it("ország felülírja a globálisat", () => {
    expect(resolveCommissionRate({ globalRate: 12, countryRate: 18 })).toBe(18);
  });
  it("szolgáltatói override felülírja az országot", () => {
    expect(resolveCommissionRate({ countryRate: 18, providerOverride: 10 })).toBe(10);
  });
  it("program szintű a legerősebb", () => {
    expect(resolveCommissionRate({ providerOverride: 10, listingRate: 20 })).toBe(20);
  });
});

describe("splitAmounts", () => {
  it("15% jutalék helyes megoszlása", () => {
    const { commission, provider } = splitAmounts(10000, 15);
    expect(commission).toBe(1500);
    expect(provider).toBe(8500);
  });
  it("kerekítés után az összeg megmarad", () => {
    const { commission, provider } = splitAmounts(999, 15);
    expect(commission + provider).toBe(999);
  });
});
