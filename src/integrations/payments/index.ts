import "server-only";
import { serverEnv } from "@/lib/env";

/** SaaS + POS payment gateway abstraction. Business logic never imports a concrete gateway. */
export interface PaymentProvider {
  readonly name: "mock" | "wompi" | "stripe";
  createCheckout(input: { tenantId: string; amount: string; currency: "COP"; reference: string; idempotencyKey: string; customerEmail?: string }): Promise<{ checkoutUrl: string; providerRef: string }>;
  getPaymentStatus(providerRef: string): Promise<"pending" | "approved" | "declined" | "voided" | "error">;
  /** Verifies the webhook signature and returns a normalized event, or null if invalid. */
  parseWebhook(rawBody: string, headers: Headers): Promise<{ eventId: string; providerRef: string; status: "approved" | "declined" | "voided" } | null>;
}

class MockPaymentProvider implements PaymentProvider {
  readonly name = "mock" as const;
  async createCheckout(input: { reference: string }) {
    return { checkoutUrl: `/mock-checkout?ref=${encodeURIComponent(input.reference)}`, providerRef: `mock_${input.reference}` };
  }
  async getPaymentStatus() { return "approved" as const; }
  async parseWebhook(rawBody: string) {
    const body = JSON.parse(rawBody) as { id: string; ref: string; status: "approved" | "declined" | "voided" };
    return { eventId: body.id, providerRef: body.ref, status: body.status };
  }
}

export function getPaymentProvider(): PaymentProvider {
  const { PAYMENT_PROVIDER } = serverEnv();
  switch (PAYMENT_PROVIDER) {
    case "mock": return new MockPaymentProvider();
    // Real adapters are added when credentials exist; never fake an endpoint.
    default: throw new Error(`PaymentProvider "${PAYMENT_PROVIDER}" aún no implementado`);
  }
}
