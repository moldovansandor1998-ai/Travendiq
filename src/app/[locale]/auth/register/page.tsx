import { getDictionary, type Locale } from "@/lib/i18n";
import { RegisterForm } from "./RegisterForm";

export default function RegisterPage({ params }: { params: { locale: Locale } }) {
  const t = getDictionary(params.locale);
  return <RegisterForm locale={params.locale} labels={{
    title: t.auth.signUp, name: t.auth.name, email: t.auth.email,
    password: t.auth.password, submit: t.auth.signUp,
    sent: t.auth.checkEmail, error: t.auth.sendFailed,
    rateLimited: t.auth.rateLimited, signIn: t.auth.signIn,
  }} />;
}
