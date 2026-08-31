import { getDictionary, type Locale } from "@/lib/i18n";
import { LoginForm } from "./LoginForm";

export default async function LoginPage(
  props: { params: Promise<{ locale: Locale }>; searchParams: Promise<{ next?: string }> }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  const { locale } = params;
  const t = getDictionary(locale);
  return (
    <LoginForm
      locale={locale}
      next={typeof searchParams.next === "string" && searchParams.next.startsWith("/") && !searchParams.next.startsWith("//") ? searchParams.next : undefined}
      labels={{
        title: t.auth.signIn,
        email: t.auth.email,
        password: t.auth.password,
        submit: t.auth.signIn,
        rateLimited: t.auth.rateLimited,
        invalidCredentials: locale === "hu" ? "Hibás email-cím vagy jelszó." : "Incorrect email or password.",
      }}
    />
  );
}
