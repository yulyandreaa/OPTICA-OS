import { z } from "zod";

/** Public env (safe in the browser). Validated lazily so builds don't fail without secrets. */
const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),
  NEXT_PUBLIC_APP_URL: z.url().default("http://localhost:3000"),
});

export function publicEnv() {
  return publicSchema.parse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  });
}

const providerEnv = z.object({
  APP_ENV: z.enum(["development", "staging", "production"]).default("development"),
  PAYMENT_PROVIDER: z.enum(["mock", "wompi", "stripe"]).default("mock"),
  NOTIFICATION_PROVIDER: z.enum(["mock", "whatsapp_cloud"]).default("mock"),
  EINVOICE_PROVIDER: z.enum(["mock"]).default("mock"),
  RIPS_PROVIDER: z.enum(["mock", "minsalud"]).default("mock"),
  AI_PROVIDER: z.enum(["none", "openai", "anthropic"]).default("none"),
});

export function serverEnv() {
  return providerEnv.parse(process.env);
}
