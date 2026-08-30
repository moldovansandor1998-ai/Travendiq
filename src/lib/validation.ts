import { z } from "zod";

export const uuid = z.string().uuid();

export const bookingInputSchema = z.object({
  listingId: uuid,
  optionId: uuid.nullable().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  adults: z.coerce.number().int().min(0).max(50),
  children: z.coerce.number().int().min(0).max(50),
  infants: z.coerce.number().int().min(0).max(20),
  leadName: z.string().trim().min(2).max(120),
  leadEmail: z.string().trim().email().max(160),
  leadPhone: z.string().trim().max(40).optional().default(""),
  hotel: z.string().trim().max(160).optional().default(""),
  pickup: z.string().trim().max(200).optional().default(""),
  requests: z.string().trim().max(1000).optional().default(""),
  coupon: z.string().trim().max(40).optional().default(""),
  zoneId: uuid.nullable().optional(),
  extras: z.array(z.object({ extraId: uuid, quantity: z.number().int().min(1).max(50) })).max(20).optional().default([]),
  idempotencyKey: z.string().min(8).max(80),
  // NINCS affiliateLink mező: affiliate-hozzárendelés KIZÁRÓLAG a szerver
  // által beállított, httpOnly 'travendiq_ref' cookie-ból történhet –
  // a kliens által beküldött UUID csalást tenne lehetővé.
}).refine((v) => v.adults + v.children + v.infants >= 1, { message: "PARTICIPANT_LIMIT" })
  .refine((v) => v.adults + v.children + v.infants <= 50, { message: "PARTICIPANT_LIMIT" })
  .refine((v) => v.adults >= 1 || v.children === 0, { message: "ADULT_REQUIRED" })
  .refine((v) => v.date >= new Date().toISOString().slice(0, 10), { message: "DATE_IN_PAST" });

export type BookingInput = z.infer<typeof bookingInputSchema>;

export const cancelSchema = z.object({
  bookingId: uuid,
  reason: z.enum(["customer", "provider_cancelled", "weather", "payment_expired", "admin"]),
  overrideAmount: z.coerce.number().int().min(0).optional(),
});

export const rescheduleSchema = z.object({
  bookingId: uuid,
  newDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  newTime: z.string().regex(/^\d{2}:\d{2}$/),
});

export const providerRegisterSchema = z.object({
  legalName: z.string().trim().min(2).max(160),
  displayName: z.string().trim().min(2).max(120),
  isCompany: z.boolean(),
  country: z.string().length(2),
  city: z.string().trim().max(120).optional().default(""),
  address: z.string().trim().max(200).optional().default(""),
  taxId: z.string().trim().max(60).optional().default(""),
  contactName: z.string().trim().min(2).max(120),
  contactEmail: z.string().trim().email().max(160),
  contactPhone: z.string().trim().max(40).optional().default(""),
});

export const listingSchema = z.object({
  title: z.string().trim().min(3).max(160),
  description: z.string().trim().max(8000).optional().default(""),
  categoryId: uuid,
  cityId: uuid,
  priceAdult: z.coerce.number().min(0).max(100000),
  priceChild: z.coerce.number().min(0).max(100000).nullable().optional(),
  currency: z.string().length(3),
  duration: z.coerce.number().int().min(0).max(10080).nullable().optional(),
  maxParticipants: z.coerce.number().int().min(1).max(1000),
  minParticipants: z.coerce.number().int().min(1).max(1000).optional().default(1),
  confirmation: z.enum(["instant", "manual"]),
  meetingPoint: z.string().trim().max(240).optional().default(""),
  hasTransfer: z.boolean().optional().default(false),
  family: z.boolean().optional().default(false),
  wheelchair: z.boolean().optional().default(false),
  freeCancellation: z.boolean().optional().default(true),
  cancelFullHours: z.coerce.number().int().min(0).max(720).optional().default(24),
  languages: z.array(z.string().length(2)).max(12).optional().default(["en"]),
});

export const reviewSchema = z.object({
  bookingId: uuid,
  rating: z.coerce.number().int().min(1).max(5),
  ratingOrganization: z.coerce.number().int().min(1).max(5).optional(),
  ratingValue: z.coerce.number().int().min(1).max(5).optional(),
  ratingGuide: z.coerce.number().int().min(1).max(5).optional(),
  comment: z.string().trim().max(2000).optional().default(""),
});

export const couponSchema = z.object({
  code: z.string().trim().min(3).max(40).regex(/^[A-Z0-9_-]+$/i),
  kind: z.enum(["percent", "fixed"]),
  value: z.coerce.number().min(0.01).max(100000),
  validFrom: z.string().optional().default(""),
  validTo: z.string().optional().default(""),
  maxRedemptions: z.coerce.number().int().min(1).nullable().optional(),
  minOrderTotal: z.coerce.number().min(0).nullable().optional(),
});

export const messageSchema = z.object({
  conversationId: uuid,
  body: z.string().trim().min(1).max(2000),
});

export const commissionRuleSchema = z.object({
  scope: z.enum(["global", "country", "provider", "listing"]),
  countryCode: z.string().length(2).nullable().optional(),
  providerId: uuid.nullable().optional(),
  listingId: uuid.nullable().optional(),
  rate: z.coerce.number().min(0).max(50),
  priority: z.coerce.number().int().min(0).max(100).optional().default(0),
});

/** Manuális kifizetés bizonyítékmezői (banki referencia + dátum + megjegyzés). */
const manualProof = {
  reference: z.string().trim().min(6).max(120),
  paidDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().trim().min(3).max(500),
};

/** Admin kifizetés-felszabadítás – kötelező bizonyíték (transfer ID vagy manuális ref+dátum+megjegyzés). */
export const payoutActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("hold"),
    payoutId: uuid,
    note: z.string().max(300).optional(),
  }),
  z.object({
    action: z.literal("release"),
    payoutId: uuid,
    method: z.literal("stripe"),
  }),
  z.object({
    action: z.literal("release_manual"),
    payoutId: uuid,
    method: z.literal("manual"),
    ...manualProof,
  }),
  z.object({
    /** Manuális payout reversal-rendezés – banki referencia + dátum + összeg + megjegyzés kötelező. */
    action: z.literal("resolve_reversal"),
    reversalId: uuid,
    reference: z.string().trim().min(3).max(120),
    resolvedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    amount: z.number().int().positive(),
    note: z.string().trim().min(3).max(500),
  }),
]);

export type PayoutAction = z.infer<typeof payoutActionSchema>;
