import "server-only";
import { serverEnv } from "@/lib/env";

export type InvoiceStatus = "draft" | "processing" | "accepted" | "rejected" | "cancelled";

/**
 * DIAN electronic invoicing, independent from sales. A provider failure must never destroy a sale:
 * callers persist the invoice as `processing` and retry through the job queue.
 */
export interface ElectronicInvoiceProvider {
  readonly name: string;
  issueInvoice(input: { tenantId: string; saleId: string; idempotencyKey: string; payload: unknown }): Promise<{ providerRef: string; status: InvoiceStatus; cufe?: string; invoiceNumber?: string }>;
  getInvoiceStatus(providerRef: string): Promise<{ status: InvoiceStatus; cufe?: string; response?: unknown }>;
  issueCreditNote(input: { tenantId: string; invoiceRef: string; idempotencyKey: string; payload: unknown }): Promise<{ providerRef: string; status: InvoiceStatus }>;
  issueDebitNote(input: { tenantId: string; invoiceRef: string; idempotencyKey: string; payload: unknown }): Promise<{ providerRef: string; status: InvoiceStatus }>;
  downloadXML(providerRef: string): Promise<Uint8Array>;
  downloadPDF(providerRef: string): Promise<Uint8Array>;
}

class MockElectronicInvoiceProvider implements ElectronicInvoiceProvider {
  readonly name = "mock";
  async issueInvoice(input: { idempotencyKey: string }) {
    return { providerRef: `mock_inv_${input.idempotencyKey}`, status: "accepted" as const, cufe: `MOCK-CUFE-${input.idempotencyKey}`, invoiceNumber: "SETP-990000001" };
  }
  async getInvoiceStatus() { return { status: "accepted" as const }; }
  async issueCreditNote(input: { idempotencyKey: string }) { return { providerRef: `mock_nc_${input.idempotencyKey}`, status: "accepted" as const }; }
  async issueDebitNote(input: { idempotencyKey: string }) { return { providerRef: `mock_nd_${input.idempotencyKey}`, status: "accepted" as const }; }
  async downloadXML() { return new TextEncoder().encode("<Invoice mock=\"true\"/>"); }
  async downloadPDF() { return new Uint8Array(); }
}

export function getElectronicInvoiceProvider(): ElectronicInvoiceProvider {
  const { EINVOICE_PROVIDER } = serverEnv();
  if (EINVOICE_PROVIDER === "mock") return new MockElectronicInvoiceProvider();
  throw new Error(`ElectronicInvoiceProvider "${EINVOICE_PROVIDER}" aún no implementado`);
}
