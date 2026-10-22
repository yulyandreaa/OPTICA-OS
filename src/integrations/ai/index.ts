import "server-only";
import { serverEnv } from "@/lib/env";

/**
 * AI is assistive only: summaries, explanations, natural-language → *validated* filters.
 * It never diagnoses, never writes to clinical records, and never receives full clinical text unless the
 * tenant enabled AI_ASSISTANT and the professional explicitly requested it.
 */
export interface AIProvider {
  readonly name: string;
  summarize(input: { text: string; purpose: "patient_timeline" | "metrics_explanation" }): Promise<string>;
  /** Returns a JSON candidate that MUST be parsed with a Zod schema of allowed filters before use. */
  toFilters(input: { query: string; allowedFields: string[] }): Promise<unknown>;
}

export function getAIProvider(): AIProvider | null {
  const { AI_PROVIDER } = serverEnv();
  if (AI_PROVIDER === "none") return null;
  throw new Error(`AIProvider "${AI_PROVIDER}" aún no implementado`);
}
