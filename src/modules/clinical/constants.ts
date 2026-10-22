/** Frequent ICD-10 (CIE-10) codes in optometry practice. Free text codes are also allowed. */
export const COMMON_DIAGNOSES = [
  { code: "H52.1", label: "Miopía" },
  { code: "H52.0", label: "Hipermetropía" },
  { code: "H52.2", label: "Astigmatismo" },
  { code: "H52.4", label: "Presbicia" },
  { code: "H53.0", label: "Ambliopía" },
  { code: "H50.9", label: "Estrabismo, no especificado" },
  { code: "H04.1", label: "Otros trastornos de la glándula lagrimal (ojo seco)" },
  { code: "H10.9", label: "Conjuntivitis, no especificada" },
  { code: "H25.9", label: "Catarata senil, no especificada" },
  { code: "H40.9", label: "Glaucoma, no especificado" },
  { code: "Z01.0", label: "Examen de ojos y de la visión" },
] as const;

export const LENS_TYPES = { monofocal: "Monofocal", bifocal: "Bifocal", progresivo: "Progresivo", ocupacional: "Ocupacional", descanso: "Descanso", contacto: "Contacto" } as const;
export const LENS_MATERIALS = { "CR-39": "CR-39", policarbonato: "Policarbonato", Trivex: "Trivex", alto_indice: "Alto índice" } as const;
export const TREATMENTS = { antirreflejo: "Antirreflejo", filtro_uv: "Filtro UV", fotocromatico: "Fotocromático", filtro_azul: "Filtro azul", polarizado: "Polarizado" } as const;
export const RECORD_TYPES = { optometry: "Optometría", ophthalmology: "Oftalmología", contact_lens: "Lentes de contacto", control: "Control" } as const;
export const RECORD_STATUS = {
  draft: { label: "Borrador", tone: "warning" },
  signed: { label: "Firmada", tone: "success" },
  amended: { label: "Enmendada", tone: "brand" },
} as const;

export interface EyeRefraction { sphere?: string; cylinder?: string; axis?: string; add?: string; prism?: string; base?: string; va?: string }
export interface Exam {
  va?: { od?: { sc_far?: string; cc_far?: string; sc_near?: string; cc_near?: string }; oi?: { sc_far?: string; cc_far?: string; sc_near?: string; cc_near?: string } };
  refraction?: { od?: EyeRefraction; oi?: EyeRefraction };
  lensometry?: { od?: EyeRefraction; oi?: EyeRefraction };
  dp?: { binocular?: string; od?: string; oi?: string };
  heights?: { od?: string; oi?: string };
  keratometry?: { od?: { k1?: string; k2?: string; axis?: string }; oi?: { k1?: string; k2?: string; axis?: string } };
  iop?: { od?: string; oi?: string };
}

/** Formats a diopter value the way it's written on a prescription: +1.25 / −0.50 / Neutro. */
export function formatDiopter(v: string | number | null | undefined) {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  if (Number.isNaN(n)) return String(v);
  if (n === 0) return "Neutro";
  return `${n > 0 ? "+" : "−"}${Math.abs(n).toFixed(2)}`;
}
