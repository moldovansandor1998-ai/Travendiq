import { describe, it, expect } from "vitest";
import { bookingInputSchema, couponSchema, reviewSchema, messageSchema } from "@/lib/validation";

const validBooking = {
  listingId: "123e4567-e89b-12d3-a456-426614174000",
  optionId: null,
  date: "2026-09-01",
  startTime: "09:00",
  adults: 2, children: 1, infants: 0,
  leadName: "Teszt Elek",
  leadEmail: "teszt@example.com",
  leadPhone: "+36301234567",
  hotel: "Hotel X", pickup: "", requests: "",
  coupon: "",
  idempotencyKey: "123e4567-e89b-12d3-a456-426614174001",
  affiliateLink: null,
  extras: [{ extraId: "123e4567-e89b-12d3-a456-426614174002", quantity: 2 }],
  zoneId: null,
};

describe("bookingInputSchema", () => {
  it("elfogad érvényes foglalást", () => {
    const r = bookingInputSchema.safeParse(validBooking);
    expect(r.success).toBe(true);
  });

  it("visszautasít múltbeli dátumot", () => {
    const r = bookingInputSchema.safeParse({ ...validBooking, date: "2020-01-01" });
    expect(r.success).toBe(false);
  });

  it("visszautasít résztvevő-limite túllépést", () => {
    const r = bookingInputSchema.safeParse({ ...validBooking, adults: 99 });
    expect(r.success).toBe(false);
  });

  it("kötelező legalább 1 felnőtt", () => {
    const r = bookingInputSchema.safeParse({ ...validBooking, adults: 0, children: 2 });
    expect(r.success).toBe(false);
  });

  it("visszautasít érvénytelen e-mailt", () => {
    const r = bookingInputSchema.safeParse({ ...validBooking, leadEmail: "nem-email" });
    expect(r.success).toBe(false);
  });

  it("visszautasít rossz idempotency kulcsot", () => {
    const r = bookingInputSchema.safeParse({ ...validBooking, idempotencyKey: "abc" });
    expect(r.success).toBe(false);
  });

  it("visszautasít érvénytelen mennyiségű extrát", () => {
    const r = bookingInputSchema.safeParse({
      ...validBooking, extras: [{ extraId: validBooking.extras[0].extraId, quantity: 0 }],
    });
    expect(r.success).toBe(false);
  });
});

describe("couponSchema", () => {
  it("elfogad százalékos kupont", () => {
    expect(couponSchema.safeParse({ code: "SUMMER10", kind: "percent", value: 10 }).success).toBe(true);
  });
  it("visszautasít rövid kódot", () => {
    expect(couponSchema.safeParse({ code: "AB", kind: "percent", value: 10 }).success).toBe(false);
  });
  it("visszautasít rossz típust", () => {
    expect(couponSchema.safeParse({ code: "ABCD", kind: "weird", value: 10 }).success).toBe(false);
  });
});

describe("reviewSchema", () => {
  it("1-5 közötti értékelést fogad el", () => {
    expect(reviewSchema.safeParse({ bookingId: validBooking.listingId, rating: 5, comment: "Szuper!" }).success).toBe(true);
    expect(reviewSchema.safeParse({ bookingId: validBooking.listingId, rating: 0 }).success).toBe(false);
    expect(reviewSchema.safeParse({ bookingId: validBooking.listingId, rating: 6 }).success).toBe(false);
  });
});

describe("messageSchema", () => {
  it("elfogad normál üzenetet", () => {
    expect(messageSchema.safeParse({ conversationId: validBooking.listingId, body: "Szia!" }).success).toBe(true);
  });
  it("visszautasít üres üzenetet", () => {
    expect(messageSchema.safeParse({ conversationId: validBooking.listingId, body: "  " }).success).toBe(false);
  });
  it("visszautasít túl hosszú üzenetet", () => {
    expect(messageSchema.safeParse({ conversationId: validBooking.listingId, body: "x".repeat(2001) }).success).toBe(false);
  });
});
