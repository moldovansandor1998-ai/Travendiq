import type { createServiceClient } from "@/lib/supabase/server";

type Svc = ReturnType<typeof createServiceClient>;

/**
 * Kliens-IP normalizálása. Az x-forwarded-for NEM korlátlanul megbízható:
 * csak az ELSŐ címet vesszük (a legközelebbi megbízható hop adja), trimmeljük,
 * és a kulcshosszt korlátozzuk (IPv6 max 45 karakter).
 */
export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  const first = fwd?.split(",")[0]?.trim();
  const raw = first || req.headers.get("x-real-ip")?.trim() || "unknown";
  return raw.slice(0, 45);
}

/**
 * Megosztott, atomikus rate limiting Supabase-ben (check_rate_limit RPC,
 * 00025). Serverless/Vercel környezetben is pontos, mert a számláló az
 * adatbázisban él, nem instance-memóriában.
 *
 * Hiba esetén FAIL CLOSED (letilt): a limiter kiesése nem nyithatja ki a
 * védett végpontot. A hiba sosem marad csendben (console.error).
 */
export async function rateLimit(
  sb: Svc, key: string, limit: number, windowSeconds = 60,
): Promise<boolean> {
  const { data, error } = await sb.rpc("check_rate_limit", {
    p_key: key.slice(0, 120), p_limit: limit, p_window_seconds: windowSeconds,
  });
  if (error) {
    console.error(`[rateLimit] ${key.slice(0, 40)}…: ${error.message}`);
    return false;
  }
  return data === true;
}

/**
 * Visszavon egy korábban lefoglalt próbálkozást, ha a védett művelet
 * külső szolgáltatási hiba miatt nem tudott befejeződni.
 */
export async function releaseRateLimit(sb: Svc, key: string): Promise<void> {
  const { error } = await sb.rpc("release_rate_limit", {
    p_key: key.slice(0, 120),
  });
  if (error) {
    console.error(`[rateLimit/release] ${key.slice(0, 40)}…: ${error.message}`);
  }
}
