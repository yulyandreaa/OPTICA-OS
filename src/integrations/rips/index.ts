import "server-only";
import { serverEnv } from "@/lib/env";

/** RIPS schema versions are explicit; mapping/validation rules live here, never in React components. */
export type RipsSchemaVersion = string;

export interface RipsValidationResult { valid: boolean; errors: { path: string; message: string }[]; warnings: { path: string; message: string }[] }

export interface RipsProvider {
  readonly name: string;
  validate(payload: unknown, version: RipsSchemaVersion): Promise<RipsValidationResult>;
  submit(input: { tenantId: string; payload: unknown; version: RipsSchemaVersion; idempotencyKey: string }): Promise<{ submissionRef: string; status: "submitted" | "rejected"; response: unknown }>;
}

class MockRipsProvider implements RipsProvider {
  readonly name = "mock";
  async validate() { return { valid: true, errors: [], warnings: [] }; }
  async submit(input: { idempotencyKey: string }) { return { submissionRef: `mock_rips_${input.idempotencyKey}`, status: "submitted" as const, response: { sandbox: true } }; }
}

export function getRipsProvider(): RipsProvider {
  const { RIPS_PROVIDER } = serverEnv();
  if (RIPS_PROVIDER === "mock") return new MockRipsProvider();
  // MinsaludRipsProvider: base URL must come from RIPS_MINSALUD_BASE_URL — endpoints are never hardcoded.
  throw new Error(`RipsProvider "${RIPS_PROVIDER}" requiere credenciales y RIPS_MINSALUD_BASE_URL`);
}
