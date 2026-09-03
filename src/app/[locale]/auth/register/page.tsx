import { getDictionary, type Locale } from "@/lib/i18n";
import { RegisterForm } from "./RegisterForm";

export default async function RegisterPage(props: { params: Promise<{ locale: Locale }> }) {
  const params = await props.params;
  const t = getDictionary(params.locale);
  const hu = params.locale === "hu";
  return <RegisterForm locale={params.locale} labels={{
    title: hu ? "Szolgáltatói partnerfiók létrehozása" : "Create a provider partner account",
    name: t.auth.name, email: t.auth.email, password: t.auth.password,
    submit: hu ? "Partnerfiók létrehozása" : "Create partner account",
    sent: hu ? "A megerősítő emailt sikeresen elküldtük. Ellenőrizd a beérkező leveleket és a spam mappát is. A megerősítés és belépés után add meg céged adatait." : "The confirmation email was sent successfully. Check your inbox and spam folder. After confirming and signing in, complete your company profile.",
    error: hu ? "A regisztráció nem sikerült, ezért megerősítő emailt sem küldtünk. Kérjük, próbáld újra." : "Registration failed, so no confirmation email was sent. Please try again.",
    rateLimited: t.auth.rateLimited,
    signIn: t.auth.signIn,
    weakPassword: hu ? "A hitelesítési rendszer ezt a jelszót nem fogadta el. Kérjük, válassz egy másik, egyedi jelszót." : "The authentication system did not accept this password. Please choose a different, unique password.",
    compromisedPassword: hu ? "A hitelesítési rendszer ezt a jelszót ismert vagy gyakran használt jelszóként érzékelte. Ez akkor is előfordulhat, ha van benne nagybetű, szám és speciális karakter. Kérjük, válassz egy teljesen más, egyedi jelszót." : "The authentication system identified this as a known or commonly used password. This can happen even when it contains uppercase letters, numbers and symbols. Please choose a completely different, unique password.",
    accountExists: hu ? "Ehhez az email-címhez már tartozhat fiók. Próbálj meg bejelentkezni." : "An account may already exist for this email address. Please try signing in.",
    passwordHelp: hu ? "Legalább 8 karakteres, egyedi jelszót használj. Az ismert vagy gyakran használt jelszavakat a biztonsági rendszer elutasíthatja." : "Use a unique password of at least 8 characters. Known or commonly used passwords may be rejected by the security system.",
  }} />;
}
