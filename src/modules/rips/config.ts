import type { RipsConfig } from "@/integrations/rips/mapper";

export function ripsConfigFrom(settings: unknown, taxId: string | null): RipsConfig {
  const r = ((settings ?? {}) as { rips?: Partial<RipsConfig> }).rips ?? {};
  return {
    providerTaxId: taxId ?? "", providerCode: r.providerCode ?? null, municipalityCode: r.municipalityCode ?? "11001",
    consultationCode: r.consultationCode ?? "890207", purposeCode: r.purposeCode ?? "15", causeCode: r.causeCode ?? "38",
    defaultConsultationValue: r.defaultConsultationValue ?? 60000,
  };
}
