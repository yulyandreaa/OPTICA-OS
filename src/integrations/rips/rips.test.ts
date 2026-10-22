import { describe, expect, it } from "vitest";
import { mapRips, type RipsConfig } from "./mapper";
import { validateRips } from "./validator";

const config: RipsConfig = { providerTaxId: "901458732", providerCode: "110010000001", municipalityCode: "11001", consultationCode: "890207", purposeCode: "15", causeCode: "38", defaultConsultationValue: 60000 };
const consult = (over: Partial<{ birthDate: string | null; sex: string | null; dx: string }> = {}) => ({
  recordId: "r1", date: "2026-10-01T14:00:00Z",
  patient: { documentType: "CC", documentNumber: "52123456", birthDate: over.birthDate === undefined ? "1985-04-12" : over.birthDate, sex: over.sex === undefined ? "F" : over.sex, healthRegime: "contributivo" },
  professional: { documentType: "CC", documentNumber: "1020304050" }, diagnoses: [{ code: over.dx ?? "H52.1" }, { code: "H52.4" }], value: null,
});

describe("RipsMapper", () => {
  it("groups consultations by patient and formats CIE-10 without dot", () => {
    const p = mapRips(config, [consult(), { ...consult(), recordId: "r2" }]);
    expect(p.usuarios).toHaveLength(1);
    expect(p.usuarios[0]!.servicios.consultas).toHaveLength(2);
    expect(p.usuarios[0]!.servicios.consultas[0]!.codDiagnosticoPrincipal).toBe("H521");
    expect(p.usuarios[0]!.servicios.consultas[0]!.codDiagnosticoRelacionado1).toBe("H524");
    expect(p.usuarios[0]!.tipoUsuario).toBe("01");
  });
});

describe("RipsValidator", () => {
  it("accepts a complete payload", () => expect(validateRips(mapRips(config, [consult()])).valid).toBe(true));
  it("flags missing birth date and sex per patient", () => {
    const r = validateRips(mapRips(config, [consult({ birthDate: null, sex: null })]));
    expect(r.valid).toBe(false);
    expect(r.errors.map((e) => e.path)).toEqual(expect.arrayContaining(["usuarios[0].fechaNacimiento", "usuarios[0].codSexo"]));
  });
  it("rejects malformed ICD-10 codes", () => {
    expect(validateRips(mapRips(config, [consult({ dx: "XYZ" })])).errors[0]!.message).toMatch(/CIE-10/);
  });
});
