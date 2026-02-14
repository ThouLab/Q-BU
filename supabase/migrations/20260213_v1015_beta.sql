-- Q-BU v1.0.15-β
-- Print order management (A plan) + secure shipping (B plan) + audit logs
--
-- Apply AFTER v1.0.15-α SQL.
--
-- NOTE:
-- - Orders are created server-side via service role (/api/print/submit).
-- - Shipping data is stored encrypted in print_order_shipping_secure.
-- - Admin can read orders via RLS (admin_roles) and decrypt shipping via API route.

begin;

create extension if not exists pgcrypto;

-- Reuse helper (idempotent)
create or replace function public.set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ---
-- Audit logs (admin-only read)
-- ---
create table if not exists public.audit_logs (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  actor_user_id uuid null,
  actor_role text null,
  action text not null,
  target_table text null,
  target_id text null,
  before jsonb null,
  after jsonb null,
  note text null
);

create index if not exists idx_audit_logs_created_at on public.audit_logs(created_at desc);
create index if not exists idx_audit_logs_action_created_at on public.audit_logs(action, created_at desc);

alter table public.audit_logs enable row level security;

grant select on public.audit_logs to authenticated;

drop policy if exists audit_logs_admin_read on public.audit_logs;
create policy audit_logs_admin_read
on public.audit_logs
for select
to authenticated
using (
  exists (
    select 1
    from public.admin_roles ar
    where ar.user_id = auth.uid()
      and ar.is_active = true
  )
);

-- ---
-- Print orders
-- ---
create table if not exists public.print_orders (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- who
  user_id uuid null references auth.users(id) on delete set null,
  anon_id text null,
  session_id text null,
  app_version text null,

  -- lifecycle
  status text not null default 'submitted'
    check (status in ('submitted','confirmed','printing','shipped','done','cancelled')),
  payment_status text not null default 'unpaid'
    check (payment_status in ('unpaid','pending','paid','refunded','failed')),
  payment_provider text null,
  payment_session_id text null,

  currency text not null default 'JPY',

  -- pricing snapshot
  quote_total_yen integer null,
  quote_volume_cm3 numeric null,
  quote_breakdown jsonb null,
  amount_total_yen integer null,

  -- model snapshot
  model_name text null,
  model_fingerprint text null,
  block_count integer null,
  support_block_count integer null,
  max_dim_mm numeric null,
  warn_exceeds_max boolean not null default false,

  scale_mode text null,
  block_edge_mm numeric null,
  target_max_side_mm numeric null,
  mm_per_unit numeric null,

  -- notes
  customer_note text null,
  admin_note text null
);

create index if not exists idx_print_orders_created_at on public.print_orders(created_at desc);
create index if not exists idx_print_orders_status_created_at on public.print_orders(status, created_at desc);
create index if not exists idx_print_orders_user_created_at on public.print_orders(user_id, created_at desc);

-- updated_at trigger (idempotent)
drop trigger if exists trg_print_orders_updated_at on public.print_orders;
create trigger trg_print_orders_updated_at
before update on public.print_orders
for each row execute function public.set_updated_at();

alter table public.print_orders enable row level security;

grant select, update on public.print_orders to authenticated;

-- Admin read (owner/admin/ops/analyst)
drop policy if exists print_orders_admin_read on public.print_orders;
create policy print_orders_admin_read
on public.print_orders
for select
to authenticated
using (
  exists (
    select 1
    from public.admin_roles ar
    where ar.user_id = auth.uid()
      and ar.is_active = true
      and ar.role in ('owner','admin','ops','analyst')
  )
);

-- Admin update (owner/admin/ops)
drop policy if exists print_orders_admin_update on public.print_orders;
create policy print_orders_admin_update
on public.print_orders
for update
to authenticated
using (
  exists (
    select 1
    from public.admin_roles ar
    where ar.user_id = auth.uid()
      and ar.is_active = true
      and ar.role in ('owner','admin','ops')
  )
)
with check (
  exists (
    select 1
    from public.admin_roles ar
    where ar.user_id = auth.uid()
      and ar.is_active = true
      and ar.role in ('owner','admin','ops')
  )
);

-- ---
-- Secure shipping data (encrypted)
-- ---
create table if not exists public.print_order_shipping_secure (
  order_id uuid primary key references public.print_orders(id) on delete cascade,
  created_at timestamptz not null default now(),
  -- encrypted payload (AES-GCM token string)
  shipping_enc text not null,
  -- for light-weight filtering without decryption (optional)
  email_hash text null,
  postal_code_prefix text null
);

create index if not exists idx_pos_email_hash on public.print_order_shipping_secure(email_hash);
create index if not exists idx_pos_postal_prefix on public.print_order_shipping_secure(postal_code_prefix);

alter table public.print_order_shipping_secure enable row level security;

-- No RLS policies on purpose (service role only). Admin access is via server API that decrypts.

-- ---
-- Daily view for orders (admin dashboard)
-- ---
create or replace view public.v_orders_submitted_daily as
select
  date_trunc('day', created_at)::date as day,
  count(*) as orders
from public.print_orders
where status <> 'cancelled'
group by 1
order by 1;

grant select on public.v_orders_submitted_daily to authenticated;

commit;
