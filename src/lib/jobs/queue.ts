/**
 * Background job abstraction. Today: in-process, fire-and-forget with retries (good for dev / low volume).
 * The interface is shaped so Inngest, Trigger.dev or BullMQ can replace it without touching callers.
 * Jobs: WhatsApp/email, e-invoicing, RIPS, large reports, PDFs, syncs — anything that must not block the UI.
 */
export interface Job<T = unknown> { name: string; payload: T; idempotencyKey: string; maxAttempts?: number }
export interface JobQueue { enqueue<T>(job: Job<T>): Promise<void> }

type JobHandler = (payload: unknown) => Promise<void>;
const registry = new Map<string, JobHandler>();
const seen = new Set<string>();

export function defineJob<T>(name: string, handler: (payload: T) => Promise<void>) {
  registry.set(name, handler as JobHandler);
}

class InProcessQueue implements JobQueue {
  async enqueue<T>(job: Job<T>) {
    if (seen.has(job.idempotencyKey)) return; // idempotent enqueue
    seen.add(job.idempotencyKey);
    const handler = registry.get(job.name);
    if (!handler) throw new Error(`Job "${job.name}" no registrado`);
    const attempts = job.maxAttempts ?? 3;
    void (async () => {
      for (let i = 1; i <= attempts; i++) {
        try { await handler(job.payload); return; } catch (err) {
          console.error(JSON.stringify({ level: "warn", scope: "jobs", job: job.name, attempt: i, message: String(err) }));
          await new Promise((r) => setTimeout(r, 2 ** i * 250));
        }
      }
    })();
  }
}

export const queue: JobQueue = new InProcessQueue();
