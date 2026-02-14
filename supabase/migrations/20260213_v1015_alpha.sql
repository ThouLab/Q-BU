-- Q-BU v1.0.15-α
-- Admin dashboard foundation (roles + analytics views)
--
-- 1) Apply this SQL in Supabase (SQL Editor or supabase migration)
-- 2) Set the first admin user (owner) manually:
--    insert into public.admin_roles(user_id, role)
--    values ('<YOUR_AUTH_USER_UUID>', 'owner')
--    on conflict (user_id) do update set role=excluded.role, is_active=true;

begin;

-- ---
-- Telemetry tables (if you already created them in v1.0.14, this is a no-op)
-- ---
create table if not exists public.telemetry_consents (
  created_at timestamptz not null default now(),
  anon_id text not null,
  consent_version text not null,
  user_id uuid null,
  user_agent text null,
  accept_language text null,
  ip_hash text null
);

create table if not exists public.event_logs (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  event_name text not null,
  path text not null,
  anon_id text not null,
  session_id text not null,
  user_id uuid null,
  payload jsonb null,
  user_agent text null,
  accept_language text null,
  ip_hash text null
);

create index if not exists idx_event_logs_name_created_at on public.event_logs(event_name, created_at);
create index if not exists idx_event_logs_anon_created_at on public.event_logs(anon_id, created_at);

-- ---
-- Admin roles
-- ---
create table if not exists public.admin_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','admin','ops','analyst')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- Ensure trigger exists (idempotent)
drop trigger if exists trg_admin_roles_updated_at on public.admin_roles;
create trigger trg_admin_roles_updated_at
before update on public.admin_roles
for each row execute function public.set_updated_at();

alter table public.admin_roles enable row level security;

-- Grant basic privileges (RLS will still restrict rows)
grant select on public.admin_roles to authenticated;

-- Self read (enables /admin gate check without recursion)
drop policy if exists admin_roles_self_read on public.admin_roles;
create policy admin_roles_self_read
on public.admin_roles
for select
to authenticated
using (user_id = auth.uid());

-- NOTE:
-- - We intentionally do NOT allow direct INSERT/UPDATE/DELETE from clients in α.
-- - Manage roles via SQL (service role / Supabase SQL editor) for now.

-- ---
-- Allow admin users to read telemetry logs (event_logs)
-- ---
alter table public.event_logs enable row level security;

drop policy if exists event_logs_admin_read on public.event_logs;
create policy event_logs_admin_read
on public.event_logs
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
-- Analytics views (used by /admin)
-- ---
create or replace view public.v_dau_daily as
select
  date_trunc('day', created_at)::date as day,
  count(distinct anon_id) as dau
from public.event_logs
where event_name = 'session_start'
group by 1
order by 1;

create or replace view public.v_stl_exports_daily as
select
  date_trunc('day', created_at)::date as day,
  count(*) as stl_exports
from public.event_logs
where event_name in ('stl_export', 'project_export_stl')
group by 1
order by 1;

create or replace view public.v_print_request_open_daily as
select
  date_trunc('day', created_at)::date as day,
  count(*) as print_requests
from public.event_logs
where event_name = 'print_request_open'
group by 1
order by 1;

-- Grant view access (actual row visibility is still controlled by event_logs RLS)
grant select on public.v_dau_daily to authenticated;
grant select on public.v_stl_exports_daily to authenticated;
grant select on public.v_print_request_open_daily to authenticated;

commit;
