import "server-only";
import { serverEnv } from "@/lib/env";

export type Channel = "whatsapp" | "email" | "sms";

/** Template-based messaging. Texts live in templates (per tenant), never hardcoded in business logic. */
export interface NotificationProvider {
  readonly name: string;
  send(input: {
    tenantId: string; channel: Channel; to: string; template: string; variables: Record<string, string>; idempotencyKey: string;
  }): Promise<{ providerMessageId: string; status: "queued" | "sent" | "failed" }>;
}

class MockNotificationProvider implements NotificationProvider {
  readonly name = "mock";
  async send(input: { channel: Channel; to: string; template: string; idempotencyKey: string }) {
    // Never log message bodies or patient data — only routing metadata.
    console.info(JSON.stringify({ level: "info", scope: "notifications.mock", channel: input.channel, template: input.template, key: input.idempotencyKey }));
    return { providerMessageId: `mock_${input.idempotencyKey}`, status: "sent" as const };
  }
}

export function getNotificationProvider(): NotificationProvider {
  const { NOTIFICATION_PROVIDER } = serverEnv();
  if (NOTIFICATION_PROVIDER === "mock") return new MockNotificationProvider();
  throw new Error(`NotificationProvider "${NOTIFICATION_PROVIDER}" aún no implementado`);
}
