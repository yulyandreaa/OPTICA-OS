/**
 * RipsMapper — builds the FEV-RIPS JSON (base structure of Resolución 2275 de 2023) from signed consultations.
 * Codes that depend on the provider's habilitación (REPS), municipality and service catalog come from
 * tenant configuration (`RipsConfig`) — never hardcoded assumptions. Verify with your technology provider.
 */
export const RIPS_SCHEMA_VERSION = "FEV-RIPS-2275-2023";

export interface RipsConfig {
  providerTaxId: string;         // NIT del obligado
  providerCode: string | null;   // código de habilitación REPS
  municipalityCode: string;      // DIVIPOLA, ej. 11001 Bogotá
  consultationCode: string;      // CUPS de la consulta
  purposeCode: string;           // finalidadTecnologiaSalud
  causeCode: string;             // causaMotivoAtencion
  defaultConsultationValue: number;
}

export interface RipsConsultationInput {
  recordId: string;
  date: string; // ISO
  patient: { documentType: string; documentNumber: string; birthDate: string | null; sex: string | null; healthRegime: string | null };
  professional: { documentType: string; documentNumber: string | null };
  diagnoses: { code: string }[];
  value: number | null;
}

const REGIME_TO_USER_TYPE: Record<string, string> = { contributivo: "01", subsidiado: "04", especial: "05", particular: "12", no_asegurado: "11" };

const cie10 = (code: string) => code.replace(".", "").toUpperCase();
const ripsDate = (iso: string) => new Date(iso).toISOString().slice(0, 16).replace("T", " ");

export function mapRips(config: RipsConfig, consultations: RipsConsultationInput[], invoiceNumber: string | null = null) {
  const byPatient = new Map<string, RipsConsultationInput[]>();
  for (const c of consultations) {
    const key = `${c.patient.documentType}:${c.patient.documentNumber}`;
    byPatient.set(key, [...(byPatient.get(key) ?? []), c]);
  }
  let userSeq = 0;
  return {
    numDocumentoIdObligado: config.providerTaxId,
    numFactura: invoiceNumber,
    tipoNota: null,
    numNota: null,
    usuarios: [...byPatient.values()].map((list) => {
      const p = list[0]!.patient;
      userSeq++;
      return {
        tipoDocumentoIdentificacion: p.documentType,
        numDocumentoIdentificacion: p.documentNumber,
        tipoUsuario: REGIME_TO_USER_TYPE[p.healthRegime ?? ""] ?? "12",
        fechaNacimiento: p.birthDate,
        codSexo: p.sex,
        codPaisResidencia: "170",
        codMunicipioResidencia: config.municipalityCode,
        codZonaTerritorialResidencia: "02",
        incapacidad: "NO",
        consecutivo: userSeq,
        codPaisOrigen: "170",
        servicios: {
          consultas: list.map((c, i) => ({
            codPrestador: config.providerCode,
            fechaInicioAtencion: ripsDate(c.date),
            numAutorizacion: null,
            codConsulta: config.consultationCode,
            modalidadGrupoServicioTecSal: "01",
            grupoServicios: "01",
            codServicio: null,
            finalidadTecnologiaSalud: config.purposeCode,
            causaMotivoAtencion: config.causeCode,
            codDiagnosticoPrincipal: c.diagnoses[0] ? cie10(c.diagnoses[0].code) : null,
            codDiagnosticoRelacionado1: c.diagnoses[1] ? cie10(c.diagnoses[1].code) : null,
            codDiagnosticoRelacionado2: c.diagnoses[2] ? cie10(c.diagnoses[2].code) : null,
            codDiagnosticoRelacionado3: c.diagnoses[3] ? cie10(c.diagnoses[3].code) : null,
            tipoDiagnosticoPrincipal: "01",
            tipoDocumentoIdentificacion: c.professional.documentType,
            numDocumentoIdentificacion: c.professional.documentNumber,
            vrServicio: c.value ?? config.defaultConsultationValue,
            conceptoRecaudo: "05",
            valorPagoModerador: 0,
            numFEVPagoModerador: null,
            consecutivo: i + 1,
            _recordId: c.recordId,
          })),
        },
      };
    }),
  };
}
export type RipsPayload = ReturnType<typeof mapRips>;
