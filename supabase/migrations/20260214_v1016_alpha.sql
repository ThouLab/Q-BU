-- Q-BU v1.0.16 (alpha)
-- - Shipping (dynamic) configs + admin editable rates
-- - Ticket apply_scope (subtotal / total)
-- - Admin print-request notification recipients
-- - MyQ-BUModels (cloud gallery) storage in DB (.qbu as base64)
-- - Print order snapshot: shipping + totals

-- =========================
-- 0) Admin roles: print-request notification recipients
-- =========================

alter table if exists public.admin_roles
  add column if not exists notify_print_request boolean not null default false;

-- =========================
-- 1) Tickets: apply_scope + shipping_free flag
-- =========================

alter table if exists public.tickets
  add column if not exists apply_scope text not null default 'subtotal';

alter table if exists public.tickets
  add column if not exists shipping_free boolean not null default false;

-- Normalize existing rows (safe to rerun)
do $$
begin
  update public.tickets
    set apply_scope = 'subtotal'
    where apply_scope is null or apply_scope not in ('subtotal','total');

  -- Backward compatibility: if legacy type is 'shipping_free', mark shipping_free=true
  update public.tickets
    set shipping_free = true
    where type = 'shipping_free';
exception when undefined_table then
  -- ignore (migration order)
end $$;

-- Extend v_tickets_with_usage WITHOUT shifting existing columns.
-- Postgres only allows CREATE OR REPLACE VIEW to ADD columns at the end.
-- The v1.0.15 view ended with "used_total"; so we keep that column at the same position
-- and append new columns after it.
do $$
begin
  execute $v$
    create or replace view public.v_tickets_with_usage as
    select
      -- Keep the same column order as v1.0.15 (tickets.* as-of v1.0.15)
      t.id,
      t.created_at,
      t.created_by,
      t.type,
      t.code_hash,
      t.code_prefix,
      t.value,
      t.currency,
      t.is_active,
      t.expires_at,
      t.max_total_uses,
      t.max_uses_per_user,
      t.constraints,
      t.note,

      -- Existing last column in v1.0.15
      coalesce(
        (select count(*) from public.ticket_redemptions r where r.ticket_id = t.id),
        0
      ) as used_total,

      -- New columns (must be appended)
      t.apply_scope,
      t.shipping_free
    from public.tickets t
    order by t.created_at desc
  $v$;

  grant select on public.v_tickets_with_usage to authenticated;
exception when undefined_table then
  -- ignore
end $$;

-- =========================
-- 2) Shipping configs + rates
-- =========================

create table if not exists public.shipping_configs (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  created_by uuid null,
  is_active boolean not null default false,
  effective_from timestamptz not null default now(),
  currency text not null default 'JPY',
  note text null
);

create unique index if not exists shipping_configs_only_one_active
  on public.shipping_configs ((is_active)) where is_active;

create table if not exists public.shipping_rates (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  config_id bigint not null references public.shipping_configs(id) on delete cascade,
  zone text not null,
  size_tier text not null,
  price_yen integer not null
);

create unique index if not exists shipping_rates_unique
  on public.shipping_rates (config_id, zone, size_tier);

-- Active views
create or replace view public.v_shipping_active as
  select * from public.shipping_configs where is_active = true;

create or replace view public.v_shipping_rates_active as
  select r.*
  from public.shipping_rates r
  join public.shipping_configs c on c.id = r.config_id
  where c.is_active = true;

-- RLS
alter table public.shipping_configs enable row level security;
alter table public.shipping_rates enable row level security;

-- Admins can read

drop policy if exists shipping_configs_select_admin on public.shipping_configs;
create policy shipping_configs_select_admin
  on public.shipping_configs
  for select to authenticated
  using (
    exists (
      select 1 from public.admin_roles ar
      where ar.user_id = auth.uid() and ar.is_active = true
    )
  );


drop policy if exists shipping_rates_select_admin on public.shipping_rates;
create policy shipping_rates_select_admin
  on public.shipping_rates
  for select to authenticated
  using (
    exists (
      select 1 from public.admin_roles ar
      where ar.user_id = auth.uid() and ar.is_active = true
    )
  );

-- Only owner can create/update

drop policy if exists shipping_configs_write_owner on public.shipping_configs;
create policy shipping_configs_write_owner
  on public.shipping_configs
  for insert to authenticated
  with check (
    exists (
      select 1 from public.admin_roles ar
      where ar.user_id = auth.uid() and ar.role = 'owner' and ar.is_active = true
    )
  );


drop policy if exists shipping_configs_update_owner on public.shipping_configs;
create policy shipping_configs_update_owner
  on public.shipping_configs
  for update to authenticated
  using (
    exists (
      select 1 from public.admin_roles ar
      where ar.user_id = auth.uid() and ar.role = 'owner' and ar.is_active = true
    )
  )
  with check (
    exists (
      select 1 from public.admin_roles ar
      where ar.user_id = auth.uid() and ar.role = 'owner' and ar.is_active = true
    )
  );


drop policy if exists shipping_rates_write_owner on public.shipping_rates;
create policy shipping_rates_write_owner
  on public.shipping_rates
  for insert to authenticated
  with check (
    exists (
      select 1 from public.admin_roles ar
      where ar.user_id = auth.uid() and ar.role = 'owner' and ar.is_active = true
    )
  );


drop policy if exists shipping_rates_delete_owner on public.shipping_rates;
create policy shipping_rates_delete_owner
  on public.shipping_rates
  for delete to authenticated
  using (
    exists (
      select 1 from public.admin_roles ar
      where ar.user_id = auth.uid() and ar.role = 'owner' and ar.is_active = true
    )
  );

-- Seed default shipping config (temporary values)
do $$
declare cfg_id bigint;
begin
  if not exists (select 1 from public.shipping_configs where is_active = true) then
    insert into public.shipping_configs (is_active, effective_from, currency, note)
      values (true, now(), 'JPY', 'default (temporary)')
      returning id into cfg_id;

    -- Zones: hokkaido, tohoku, kanto, chubu, kinki, chugoku, shikoku, kyushu, okinawa
    -- Size tiers: 60 / 80 / 100 / 120 (temporary)
    insert into public.shipping_rates (config_id, zone, size_tier, price_yen) values
      (cfg_id,'kanto','60',700), (cfg_id,'kanto','80',900), (cfg_id,'kanto','100',1100), (cfg_id,'kanto','120',1300),
      (cfg_id,'chubu','60',750), (cfg_id,'chubu','80',950), (cfg_id,'chubu','100',1150), (cfg_id,'chubu','120',1350),
      (cfg_id,'kinki','60',750), (cfg_id,'kinki','80',950), (cfg_id,'kinki','100',1150), (cfg_id,'kinki','120',1350),
      (cfg_id,'tohoku','60',850), (cfg_id,'tohoku','80',1050), (cfg_id,'tohoku','100',1250), (cfg_id,'tohoku','120',1450),
      (cfg_id,'chugoku','60',950), (cfg_id,'chugoku','80',1150), (cfg_id,'chugoku','100',1350), (cfg_id,'chugoku','120',1550),
      (cfg_id,'shikoku','60',950), (cfg_id,'shikoku','80',1150), (cfg_id,'shikoku','100',1350), (cfg_id,'shikoku','120',1550),
      (cfg_id,'kyushu','60',1050), (cfg_id,'kyushu','80',1250), (cfg_id,'kyushu','100',1450), (cfg_id,'kyushu','120',1650),
      (cfg_id,'hokkaido','60',1200), (cfg_id,'hokkaido','80',1400), (cfg_id,'hokkaido','100',1600), (cfg_id,'hokkaido','120',1800),
      (cfg_id,'okinawa','60',1400), (cfg_id,'okinawa','80',1600), (cfg_id,'okinawa','100',1800), (cfg_id,'okinawa','120',2000);
  end if;
exception when undefined_table then
  -- ignore
end $$;

-- =========================
-- 3) Print orders: shipping snapshot
-- =========================

alter table if exists public.print_orders
  add column if not exists shipping_config_id bigint null,
  add column if not exists shipping_zone text null,
  add column if not exists shipping_size_tier text null,
  add column if not exists shipping_yen integer null,
  add column if not exists ticket_apply_scope text null;

-- =========================
-- 4) MyQ-BUModels: user_models
-- =========================

create table if not exists public.user_models (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  qbu_base64 text not null,
  thumb_data_url text null,
  model_fingerprint text null,
  block_count integer not null default 0,
  support_block_count integer not null default 0
);

create index if not exists user_models_user_updated_idx
  on public.user_models (user_id, updated_at desc);

alter table public.user_models enable row level security;

drop policy if exists user_models_select_own on public.user_models;
create policy user_models_select_own
  on public.user_models
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists user_models_insert_own on public.user_models;
create policy user_models_insert_own
  on public.user_models
  for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists user_models_update_own on public.user_models;
create policy user_models_update_own
  on public.user_models
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists user_models_delete_own on public.user_models;
create policy user_models_delete_own
  on public.user_models
  for delete to authenticated
  using (auth.uid() = user_id);
