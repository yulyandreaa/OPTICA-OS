-- =============================================================================
-- Phase 07–08 — Electronic invoicing (independent from sales), credit notes, RIPS submissions,
-- integration logs and webhook events (idempotent).
-- =============================================================================

create table public.invoices (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete restrict,
  sale_id         uuid not null,
  number          text,
  status          text not null default 'draft' check (status in ('draft','processing','accepted','rejected','cancelled')),
  provider        text not null,
  provider_ref    text,
  cufe            text,
  xml_url         text,
  pdf_url         text,
  customer        jsonb not null default '{}'::jsonb, -- snapshot: {document_type, document_number, name, email}
  subtotal        numeric(14,2) not null,
  tax_total       numeric(14,2) not null,
  total           numeric(14,2) not null,
  issued_at       timestamptz,
  dian_response   jsonb,
  error_message   text,
  attempts        int not null default 0,
  idempotency_key text not null,
  created_by      uuid references public.profiles(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (tenant_id, idempotency_key),
  unique (id, tenant_id),
  foreign key (sale_id, tenant_id) references public.sales(id, tenant_id)
);
create unique index invoices_one_active_per_sale on public.invoices (sale_id) where status in ('processing','accepted');
create index invoices_tenant_idx on public.invoices (tenant_id, created_at desc);

create table public.credit_notes (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete restrict,
  invoice_id   uuid not null,
  reason       text not null,
  amount       numeric(14,2) not null check (amount > 0),
  status       text not null default 'processing' check (status in ('processing','accepted','rejected')),
  provider_ref text,
  created_by   uuid references public.profiles(id),
  created_at   timestamptz not null default now(),
  foreign key (invoice_id, tenant_id) references public.invoices(id, tenant_id)
);

create table public.rips_submissions (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete restrict,
  period_start    date not null,
  period_end      date not null,
  schema_version  text not null,
  status          text not null default 'generated' check (status in ('draft','generated','validating','validated','rejected','submitted')),
  payload         jsonb not null,
  validation      jsonb not null default '{}'::jsonb,
  errors_count    int not null default 0,
  warnings_count  int not null default 0,
  records_count   int not null default 0,
  provider        text,
  provider_ref    text,
  submitted_at    timestamptz,
  idempotency_key text not null,
  created_by      uuid references public.profiles(id),
  created_at      timestamptz not null default now(),
  check (period_end >= period_start),
  unique (tenant_id, idempotency_key)
);
create index rips_submissions_idx on public.rips_submissions (tenant_id, created_at desc);

-- Every critical external call (redacted): provider, operation, status, request_id, duration.
create table public.integration_logs (
  id          bigint generated always as identity primary key,
  tenant_id   uuid references public.tenants(id) on delete set null,
  provider    text not null,
  operation   text not null,
  status      text not null check (status in ('success','error')),
  request_id  text,
  duration_ms int,
  error       text,
  created_at  timestamptz not null default now()
);
create index integration_logs_idx on public.integration_logs (tenant_id, created_at desc);

create table public.webhook_events (
  id           uuid primary key default gen_random_uuid(),
  provider     text not null,
  event_id     text not null,
  payload      jsonb not null,
  status       text not null default 'received' check (status in ('received','processed','failed','ignored')),
  received_at  timestamptz not null default now(),
  processed_at timestamptz,
  unique (provider, event_id)
);

create trigger invoices_updated_at before update on public.invoices for each row execute function private.set_updated_at();
create trigger invoices_audit after insert or update on public.invoices for each row execute function private.audit_row('dian_response');
create trigger credit_notes_audit after insert or update on public.credit_notes for each row execute function private.audit_row();
create trigger rips_audit after insert or update on public.rips_submissions for each row execute function private.audit_row('payload');

alter table public.invoices enable row level security;
alter table public.credit_notes enable row level security;
alter table public.rips_submissions enable row level security;
alter table public.integration_logs enable row level security;
alter table public.webhook_events enable row level security;
revoke all on public.invoices, public.credit_notes, public.rips_submissions, public.integration_logs, public.webhook_events from anon;
revoke all on public.webhook_events from authenticated; -- service role only

create policy inv_select on public.invoices for select to authenticated using (private.has_permission(tenant_id, 'billing.read'));
create policy inv_write on public.invoices for all to authenticated using (private.can_write(tenant_id, 'billing.issue')) with check (private.can_write(tenant_id, 'billing.issue'));
create policy cn_select on public.credit_notes for select to authenticated using (private.has_permission(tenant_id, 'billing.read'));
create policy cn_write on public.credit_notes for all to authenticated using (private.can_write(tenant_id, 'billing.issue')) with check (private.can_write(tenant_id, 'billing.issue'));
create policy rips_select on public.rips_submissions for select to authenticated using (private.has_permission(tenant_id, 'rips.read'));
create policy rips_write on public.rips_submissions for all to authenticated using (private.can_write(tenant_id, 'rips.manage')) with check (private.can_write(tenant_id, 'rips.manage'));
create policy il_select on public.integration_logs for select to authenticated using (tenant_id is not null and private.has_permission(tenant_id, 'integrations.manage'));
create policy il_insert on public.integration_logs for insert to authenticated with check (tenant_id is not null and private.is_member(tenant_id));
