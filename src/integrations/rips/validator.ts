import type { RipsPayload } from "./mapper";

export interface RipsIssue { path: string; message: string; recordId?: string }

const CIE10 = /^[A-Z]\d{2}[0-9A-Z]{0,2}$/;
const DOC_TYPES = new Set(["CC", "TI", "CE", "PA", "RC", "PEP", "PPT", "NIT", "MS", "AS", "CD", "SC"]);

/** RipsValidator — structural checks before sending. It does not replace the official validator. */
export function validateRips(payload: RipsPayload) {
  const errors: RipsIssue[] = [];
  const warnings: RipsIssue[] = [];
  if (!/^\d{5,15}$/.test(payload.numDocumentoIdObligado ?? "")) errors.push({ path: "numDocumentoIdObligado", message: "Configura el NIT de la empresa." });
  if (payload.usuarios.length === 0) warnings.push({ path: "usuarios", message: "No hay consultas firmadas en el periodo." });

  payload.usuarios.forEach((u, ui) => {
    const base = `usuarios[${ui}]`;
    if (!DOC_TYPES.has(u.tipoDocumentoIdentificacion)) errors.push({ path: `${base}.tipoDocumentoIdentificacion`, message: `Tipo de documento inválido (${u.tipoDocumentoIdentificacion}).` });
    if (!u.numDocumentoIdentificacion) errors.push({ path: `${base}.numDocumentoIdentificacion`, message: "Falta el documento del paciente." });
    if (!u.fechaNacimiento) errors.push({ path: `${base}.fechaNacimiento`, message: `Falta la fecha de nacimiento (${u.numDocumentoIdentificacion}).` });
    if (!u.codSexo || !["M", "F", "I"].includes(u.codSexo)) errors.push({ path: `${base}.codSexo`, message: `Falta el sexo biológico (${u.numDocumentoIdentificacion}).` });
    if (!/^\d{5}$/.test(u.codMunicipioResidencia)) errors.push({ path: `${base}.codMunicipioResidencia`, message: "Código DIVIPOLA inválido." });
    u.servicios.consultas.forEach((c, ci) => {
      const p = `${base}.servicios.consultas[${ci}]`;
      if (!c.codDiagnosticoPrincipal) errors.push({ path: `${p}.codDiagnosticoPrincipal`, message: "La consulta no tiene diagnóstico principal.", recordId: c._recordId });
      else if (!CIE10.test(c.codDiagnosticoPrincipal)) errors.push({ path: `${p}.codDiagnosticoPrincipal`, message: `Código CIE-10 inválido: ${c.codDiagnosticoPrincipal}`, recordId: c._recordId });
      if (new Date(c.fechaInicioAtencion.replace(" ", "T") + "Z") > new Date(Date.now() + 86_400_000)) errors.push({ path: `${p}.fechaInicioAtencion`, message: "Fecha de atención futura.", recordId: c._recordId });
      if (!c.codPrestador) warnings.push({ path: `${p}.codPrestador`, message: "Configura el código de habilitación REPS.", recordId: c._recordId });
      if (!c.numDocumentoIdentificacion) warnings.push({ path: `${p}.numDocumentoIdentificacion`, message: "Falta el documento del profesional.", recordId: c._recordId });
    });
  });
  // Deduplicate repeated configuration warnings.
  const seen = new Set<string>();
  const uniqueWarnings = warnings.filter((w) => { const k = w.message; if (seen.has(k) && w.message.startsWith("Configura")) return false; seen.add(k); return true; });
  return { valid: errors.length === 0, errors, warnings: uniqueWarnings };
}
