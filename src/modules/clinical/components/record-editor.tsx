"use client";
import { CheckCircle2, FileSignature, Loader2, Plus, Save, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { FormField } from "@/components/shared/form-field";
import { NativeSelect } from "@/components/shared/native-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { saveRecordAction, signRecordAction } from "../actions";
import { COMMON_DIAGNOSES, RECORD_TYPES, type Exam } from "../constants";
import type { RecordInput } from "../schemas";

type Eye = "od" | "oi";
const EYES: { key: Eye; label: string }[] = [{ key: "od", label: "OD" }, { key: "oi", label: "OI" }];

function Section({ id, title, description, children }: { id: string; title: string; description?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 rounded-xl border bg-surface p-5 shadow-soft">
      <header className="mb-4">
        <h2 className="text-sm font-semibold">{title}</h2>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </header>
      {children}
    </section>
  );
}

function Cell({ value, onChange, placeholder, label, wide }: { value?: string; onChange: (v: string) => void; placeholder?: string; label: string; wide?: boolean }) {
  return (
    <input
      aria-label={label}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      inputMode="decimal"
      className={cn("h-9 w-full rounded-md border border-input bg-background px-2 text-center text-sm tabular outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40", wide && "min-w-16")}
    />
  );
}

/** OD/OI grid used for refraction and lensometry. */
function RxGrid({ value, onChange, prefix }: {
  value?: Exam["refraction"]; onChange: (eye: Eye, field: string, v: string) => void; prefix: string;
}) {
  const cols = [
    { key: "sphere", label: "Esfera", ph: "±0.00" }, { key: "cylinder", label: "Cilindro", ph: "−0.00" }, { key: "axis", label: "Eje", ph: "0–180" },
    { key: "add", label: "Adición", ph: "+0.00" }, { key: "prism", label: "Prisma", ph: "Δ" }, { key: "base", label: "Base", ph: "BI/BE" }, { key: "va", label: "AV", ph: "20/20" },
  ];
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[620px] border-separate border-spacing-1 text-xs">
        <thead><tr><th className="w-10" />{cols.map((c) => <th key={c.key} className="pb-1 text-left font-medium text-muted-foreground">{c.label}</th>)}</tr></thead>
        <tbody>
          {EYES.map((e) => (
            <tr key={e.key}>
              <th className={cn("rounded-md text-center text-xs font-semibold", e.key === "od" ? "bg-brand-soft text-brand" : "bg-muted text-foreground")}>{e.label}</th>
              {cols.map((c) => (
                <td key={c.key}>
                  <Cell label={`${prefix} ${e.label} ${c.label}`} placeholder={c.ph}
                    value={(value?.[e.key] as Record<string, string> | undefined)?.[c.key]} onChange={(v) => onChange(e.key, c.key, v)} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RecordEditor({ recordId, initial, patientName, canSign }: { recordId: string; initial: RecordInput; patientName: string; canSign: boolean }) {
  const router = useRouter();
  const [data, setData] = useState<RecordInput>(initial);
  const [saving, startSave] = useTransition();
  const [signing, startSign] = useTransition();
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [signError, setSignError] = useState<string | null>(null);
  const [customDx, setCustomDx] = useState({ code: "", label: "" });
  const latest = useRef(data);
  useEffect(() => { latest.current = data; }, [data]);

  const exam = (data.exam ?? {}) as Exam;
  const set = <K extends keyof RecordInput>(k: K, v: RecordInput[K]) => { setData((d) => ({ ...d, [k]: v })); setDirty(true); };
  const setExam = (path: string[], v: string) => {
    setData((d) => {
      const next = structuredClone((d.exam ?? {}) as Record<string, unknown>);
      let node = next;
      for (const key of path.slice(0, -1)) node = (node[key] ??= {}) as Record<string, unknown>;
      node[path.at(-1)!] = v;
      return { ...d, exam: next as RecordInput["exam"] };
    });
    setDirty(true);
  };

  // Autosave drafts every few seconds of inactivity.
  useEffect(() => {
    if (!dirty) return;
    const t = setTimeout(() => {
      startSave(async () => {
        const res = await saveRecordAction(recordId, latest.current);
        if (res.ok) { setDirty(false); setSavedAt(new Date()); }
      });
    }, 2500);
    return () => clearTimeout(t);
  }, [dirty, data, recordId]);

  const save = () => startSave(async () => {
    const res = await saveRecordAction(recordId, data);
    if (!res.ok) { toast.error(res.error); return; }
    setDirty(false); setSavedAt(new Date()); toast.success("Borrador guardado");
  });

  const sign = () => {
    // The database refuses to sign without a chief complaint: say so next to the field, not only in a toast.
    if (!(data.chief_complaint ?? "").trim()) {
      setSignError("Escribe el motivo de consulta para poder firmar.");
      const field = document.getElementById("chief_complaint");
      field?.scrollIntoView({ behavior: "smooth", block: "center" });
      field?.focus({ preventScroll: true });
      toast.error("Falta el motivo de consulta: es obligatorio para firmar.");
      return;
    }
    startSign(async () => {
    const res = await signRecordAction(recordId, data);
    if (!res.ok) { toast.error(res.error); return; }
    toast.success(res.data.prescriptionId ? "Historia firmada y fórmula emitida" : "Historia firmada");
    router.refresh();
    });
  };

  const dx = data.diagnoses ?? [];
  const lens = data.lens_recommendation ?? {};

  return (
    <div className="grid gap-4 lg:grid-cols-[180px_1fr]">
      <nav className="sticky top-20 hidden h-fit gap-1 text-sm lg:grid" aria-label="Secciones">
        {[["anamnesis", "Anamnesis"], ["antecedentes", "Antecedentes"], ["agudeza", "Agudeza visual"], ["refraccion", "Refracción"], ["otros", "Queratometría y PIO"], ["diagnostico", "Diagnóstico y plan"], ["lentes", "Recomendación"]].map(([id, label]) => (
          <a key={id} href={`#${id}`} className="rounded-md px-2.5 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">{label}</a>
        ))}
      </nav>

      <div className="grid gap-4">
        <Section id="anamnesis" title="Anamnesis" description={`Paciente: ${patientName}`}>
          <div className="grid gap-4 sm:grid-cols-[200px_1fr]">
            <FormField id="record_type" label="Tipo de consulta">
              <NativeSelect id="record_type" value={data.record_type} onChange={(e) => set("record_type", e.target.value as RecordInput["record_type"])}>
                {Object.entries(RECORD_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </NativeSelect>
            </FormField>
            <FormField id="chief_complaint" label="Motivo de consulta · obligatorio para firmar" error={signError ?? undefined}>
              <Input id="chief_complaint" aria-invalid={!!signError} value={data.chief_complaint ?? ""}
                onChange={(e) => { set("chief_complaint", e.target.value); if (e.target.value.trim()) setSignError(null); }} placeholder="Ej.: visión borrosa de lejos" />
            </FormField>
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <FormField id="current_illness" label="Enfermedad actual"><Textarea id="current_illness" rows={3} value={data.current_illness ?? ""} onChange={(e) => set("current_illness", e.target.value)} /></FormField>
            <FormField id="symptoms" label="Síntomas"><Textarea id="symptoms" rows={3} value={data.symptoms ?? ""} onChange={(e) => set("symptoms", e.target.value)} placeholder="Cefalea, ardor, fotofobia…" /></FormField>
          </div>
        </Section>

        <Section id="antecedentes" title="Antecedentes" description="Se precargan de la última consulta firmada.">
          <div className="grid gap-4 sm:grid-cols-2">
            {([["personal_history", "Personales"], ["family_history", "Familiares"], ["ocular_history", "Oculares"], ["allergies", "Alergias"], ["medications", "Medicamentos"], ["surgeries", "Cirugías"], ["habits", "Hábitos (pantallas, lectura, deporte)"], ["external_exam", "Examen externo"]] as const).map(([k, label]) => (
              <FormField key={k} id={k} label={label}><Textarea id={k} rows={2} value={(data[k] as string | null | undefined) ?? ""} onChange={(e) => set(k, e.target.value)} /></FormField>
            ))}
          </div>
        </Section>

        <Section id="agudeza" title="Agudeza visual" description="Sin corrección (SC) y con corrección (CC), lejos y cerca.">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] border-separate border-spacing-1 text-xs">
              <thead><tr><th className="w-10" />{["SC lejos", "CC lejos", "SC cerca", "CC cerca"].map((h) => <th key={h} className="pb-1 text-left font-medium text-muted-foreground">{h}</th>)}</tr></thead>
              <tbody>
                {EYES.map((e) => (
                  <tr key={e.key}>
                    <th className={cn("rounded-md text-center font-semibold", e.key === "od" ? "bg-brand-soft text-brand" : "bg-muted")}>{e.label}</th>
                    {(["sc_far", "cc_far", "sc_near", "cc_near"] as const).map((f) => (
                      <td key={f}><Cell label={`AV ${e.label} ${f}`} placeholder={f.includes("near") ? "J1" : "20/20"} value={exam.va?.[e.key]?.[f]} onChange={(v) => setExam(["va", e.key, f], v)} /></td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <Section id="refraccion" title="Refracción final" description="Esta será la fórmula del paciente al firmar.">
          <RxGrid prefix="Refracción" value={exam.refraction} onChange={(eye, f, v) => setExam(["refraction", eye, f], v)} />
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
            <FormField id="dp_bin" label="DP binocular"><Input id="dp_bin" inputMode="decimal" value={exam.dp?.binocular ?? ""} onChange={(e) => setExam(["dp", "binocular"], e.target.value)} placeholder="62" /></FormField>
            <FormField id="dp_od" label="DP OD"><Input id="dp_od" inputMode="decimal" value={exam.dp?.od ?? ""} onChange={(e) => setExam(["dp", "od"], e.target.value)} /></FormField>
            <FormField id="dp_oi" label="DP OI"><Input id="dp_oi" inputMode="decimal" value={exam.dp?.oi ?? ""} onChange={(e) => setExam(["dp", "oi"], e.target.value)} /></FormField>
            <FormField id="h_od" label="Altura OD"><Input id="h_od" inputMode="decimal" value={exam.heights?.od ?? ""} onChange={(e) => setExam(["heights", "od"], e.target.value)} /></FormField>
            <FormField id="h_oi" label="Altura OI"><Input id="h_oi" inputMode="decimal" value={exam.heights?.oi ?? ""} onChange={(e) => setExam(["heights", "oi"], e.target.value)} /></FormField>
          </div>
          <details className="mt-4">
            <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">Lensometría (gafas actuales)</summary>
            <div className="mt-3"><RxGrid prefix="Lensometría" value={exam.lensometry} onChange={(eye, f, v) => setExam(["lensometry", eye, f], v)} /></div>
          </details>
        </Section>

        <Section id="otros" title="Queratometría y presión intraocular">
          <div className="grid gap-4 sm:grid-cols-[1fr_200px]">
            <table className="w-full border-separate border-spacing-1 text-xs">
              <thead><tr><th className="w-10" />{["K1", "K2", "Eje"].map((h) => <th key={h} className="pb-1 text-left font-medium text-muted-foreground">{h}</th>)}</tr></thead>
              <tbody>{EYES.map((e) => (
                <tr key={e.key}>
                  <th className={cn("rounded-md text-center font-semibold", e.key === "od" ? "bg-brand-soft text-brand" : "bg-muted")}>{e.label}</th>
                  {(["k1", "k2", "axis"] as const).map((f) => <td key={f}><Cell label={`K ${e.label} ${f}`} value={exam.keratometry?.[e.key]?.[f]} onChange={(v) => setExam(["keratometry", e.key, f], v)} /></td>)}
                </tr>))}
              </tbody>
            </table>
            <div className="grid grid-cols-2 gap-2">
              <FormField id="iop_od" label="PIO OD (mmHg)"><Input id="iop_od" inputMode="numeric" value={exam.iop?.od ?? ""} onChange={(e) => setExam(["iop", "od"], e.target.value)} /></FormField>
              <FormField id="iop_oi" label="PIO OI (mmHg)"><Input id="iop_oi" inputMode="numeric" value={exam.iop?.oi ?? ""} onChange={(e) => setExam(["iop", "oi"], e.target.value)} /></FormField>
            </div>
          </div>
        </Section>

        <Section id="diagnostico" title="Diagnóstico y plan" description="CIE-10. La IA nunca sugiere diagnósticos: los define el profesional.">
          <div className="flex flex-wrap gap-1.5">
            {COMMON_DIAGNOSES.map((d) => {
              const active = dx.some((x) => x.code === d.code);
              return (
                <button key={d.code} type="button" aria-pressed={active}
                  onClick={() => set("diagnoses", active ? dx.filter((x) => x.code !== d.code) : [...dx, { code: d.code, label: d.label }])}
                  className={cn("rounded-full border px-2.5 py-1 text-xs transition", active ? "border-brand bg-brand-soft text-brand" : "text-muted-foreground hover:text-foreground")}>
                  <span className="font-mono">{d.code}</span> {d.label}
                </button>
              );
            })}
          </div>
          {dx.filter((d) => !COMMON_DIAGNOSES.some((c) => c.code === d.code)).map((d) => (
            <span key={d.code} className="mt-2 mr-1.5 inline-flex items-center gap-1 rounded-full border border-brand bg-brand-soft px-2.5 py-1 text-xs text-brand">
              <span className="font-mono">{d.code}</span> {d.label}
              <button type="button" aria-label="Quitar" onClick={() => set("diagnoses", dx.filter((x) => x.code !== d.code))}><X className="size-3" /></button>
            </span>
          ))}
          <div className="mt-3 flex gap-2">
            <Input aria-label="Código CIE-10" placeholder="Código" className="w-28 font-mono" value={customDx.code} onChange={(e) => setCustomDx({ ...customDx, code: e.target.value.toUpperCase() })} />
            <Input aria-label="Descripción" placeholder="Otro diagnóstico" value={customDx.label} onChange={(e) => setCustomDx({ ...customDx, label: e.target.value })} />
            <Button type="button" variant="outline" size="icon" aria-label="Agregar diagnóstico" disabled={!customDx.code || !customDx.label}
              onClick={() => { set("diagnoses", [...dx, customDx]); setCustomDx({ code: "", label: "" }); }}><Plus /></Button>
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <FormField id="plan" label="Plan"><Textarea id="plan" rows={3} value={data.plan ?? ""} onChange={(e) => set("plan", e.target.value)} placeholder="Control en 12 meses" /></FormField>
            <FormField id="recommendations" label="Recomendaciones"><Textarea id="recommendations" rows={3} value={data.recommendations ?? ""} onChange={(e) => set("recommendations", e.target.value)} placeholder="Pausas activas 20-20-20" /></FormField>
          </div>
          <FormField id="observations" label="Observaciones" className="mt-4"><Textarea id="observations" rows={2} value={data.observations ?? ""} onChange={(e) => set("observations", e.target.value)} /></FormField>
        </Section>

        <Section id="lentes" title="Recomendación de lentes" description="El asesor la verá en la fórmula para cotizar y llegará a la orden de laboratorio.">
          <FormField id="lens_text" label="Recomendación">
            <Textarea id="lens_text" rows={5} maxLength={2000} value={lens.text ?? ""}
              placeholder="Ej.: Lente progresivo en policarbonato con antirreflejo y filtro azul. Uso permanente."
              onChange={(e) => set("lens_recommendation", { ...lens, text: e.target.value })} />
          </FormField>
        </Section>

        <div className="sticky bottom-4 z-20 flex flex-col gap-3 rounded-xl border bg-surface/95 p-3 shadow-lift backdrop-blur sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-center gap-1.5 px-1 text-xs text-muted-foreground">
            {saving ? <><Loader2 className="size-3.5 animate-spin" /> Guardando…</> : dirty ? "Cambios sin guardar" : savedAt ? <><CheckCircle2 className="size-3.5 text-success" /> Guardado automáticamente</> : "Borrador"}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={save} disabled={saving || signing}><Save /> Guardar borrador</Button>
            {canSign && (
              <Button onClick={sign} disabled={signing || saving}>
                {signing ? <Loader2 className="animate-spin" /> : <FileSignature />} Firmar y emitir fórmula
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
