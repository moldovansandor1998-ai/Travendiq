import { describe, it, expect, beforeAll } from "vitest";
import { escapeHtml } from "@/lib/escape";
import { maskContactInfo, containsContactInfo } from "@/lib/masking";
import { signVoucher, verifyVoucher } from "@/lib/qr";

describe("escapeHtml – voucher XSS-védelem", () => {
  it("HTML-meta karaktereket escape-el", () => {
    expect(escapeHtml(`<script>alert("x")</script>`)).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
  });
  it("apostrofot és & jelet is kezel", () => {
    expect(escapeHtml("O'Brien & társa")).toBe("O&#39;Brien &amp; társa");
  });
  it("undefined/null biztonságos", () => {
    expect(escapeHtml(undefined)).toBe("");
    expect(escapeHtml(null)).toBe("");
  });
});

describe("maskContactInfo – kapcsolattartási adatok maszkolása", () => {
  it("e-mailt maszkol", () => {
    expect(maskContactInfo("Írj a teszt@example.com címre!")).not.toContain("teszt@example.com");
  });
  it("telefonszámot maszkol", () => {
    expect(maskContactInfo("Hívj: +36 30 123 4567")).toContain("[phone]");
  });
  it("URL-t maszkol", () => {
    expect(maskContactInfo("Látogasd meg a https://example.com oldalt")).toContain("[link]");
  });
  it("tiszta szöveg érintetlen", () => {
    expect(maskContactInfo("Holnap 9-kor a recepciónál találkozunk.")).toBe("Holnap 9-kor a recepciónál találkozunk.");
  });
  it("containsContactInfo detektál", () => {
    expect(containsContactInfo("06301234567")).toBe(true);
    expect(containsContactInfo("teszt@example.com")).toBe(true);
    expect(containsContactInfo("sima szöveg")).toBe(false);
  });
});

describe("QR voucher aláírás (HMAC)", () => {
  beforeAll(() => {
    process.env.VOUCHER_SIGNING_SECRET = "test-secret-0123456789";
  });

  it("aláírt payload visszaellenőrizhető", () => {
    const token = signVoucher({ code: "TRV-26-ABC123", exp: "2026-09-01" });
    const v = verifyVoucher(token);
    expect(v?.code).toBe("TRV-26-ABC123");
    expect(v?.exp).toBe("2026-09-01");
  });
  it("megváltoztatott payload érvénytelen", () => {
    const token = signVoucher({ code: "TRV-26-ABC123", exp: "2026-09-01" });
    const [, sig] = token.split(".");
    // a body tényleges módosítása (újrakódolva), az eredeti aláírás megtartásával
    const tampered = Buffer.from(
      JSON.stringify({ code: "TRV-26-XYZ999", exp: "2026-09-01" }),
    ).toString("base64url");
    expect(verifyVoucher(`${tampered}.${sig}`)).toBeNull();
  });
  it("hamisított aláírás érvénytelen", () => {
    const token = signVoucher({ code: "TRV-26-ABC123", exp: "2026-09-01" });
    const [body] = token.split(".");
    expect(verifyVoucher(`${body}.forgedsignature`)).toBeNull();
  });
});
