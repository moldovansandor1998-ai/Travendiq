import { describe, expect, it } from "vitest";
import { canTransition, canActorTransition } from "@/lib/booking/status";

describe("státuszgép átmenetek", () => {
  it("pending_payment → confirmed tiltott (fizetés nélkül nincs confirm)", () => {
    expect(canTransition("pending_payment", "confirmed")).toBe(false);
  });
  it("pending_payment → pending_confirmation engedélyezett", () => {
    expect(canTransition("pending_payment", "pending_confirmation")).toBe(true);
  });
  it("confirmed → attended → completed lánc", () => {
    expect(canTransition("confirmed", "attended")).toBe(true);
    expect(canTransition("attended", "completed")).toBe(true);
  });
  it("completed végállapot", () => {
    expect(canTransition("completed", "refunded")).toBe(false);
    expect(canTransition("completed", "disputed")).toBe(false);
  });
  it("disputed feloldható több irányba", () => {
    expect(canTransition("disputed", "refunded")).toBe(true);
    expect(canTransition("disputed", "completed")).toBe(true);
  });
});

describe("szerepkör-jogosultság", () => {
  it("vásárló lemondhat", () => {
    expect(canActorTransition("customer", "confirmed", "cancelled")).toBe(true);
  });
  it("vásárló nem állíthat completed-re", () => {
    expect(canActorTransition("customer", "attended", "completed")).toBe(false);
  });
  it("szolgáltató beléptethet és teljesíthet", () => {
    expect(canActorTransition("provider", "confirmed", "attended")).toBe(true);
    expect(canActorTransition("provider", "attended", "completed")).toBe(true);
  });
  it("szolgáltató nem módosíthat refunded-re közvetlenül confirmed-ből", () => {
    expect(canActorTransition("provider", "confirmed", "refunded")).toBe(false);
  });
  it("staff minden szabályos átmenetet végrehajthat", () => {
    expect(canActorTransition("staff", "cancelled", "refunded")).toBe(true);
  });
});
