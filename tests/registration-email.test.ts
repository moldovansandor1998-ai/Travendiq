import { describe, expect, it } from "vitest";
import { renderEmail } from "@/lib/email";

describe("registration confirmation email", () => {
  it("always renders the Travendiq confirmation in English", () => {
    const email = renderEmail({
      to: "traveller@example.com",
      template: "email_confirmation",
      locale: "en",
      vars: { name: "Traveller", link: "https://travendiq.com/api/auth/confirm?token_hash=test" },
    });
    expect(email.subject).toBe("Confirm your Travendiq account");
    expect(email.html).toContain("Confirm my email");
    expect(email.html).toContain("token_hash=test");
    expect(email.html).not.toContain("Erősítsd meg");
  });
});
