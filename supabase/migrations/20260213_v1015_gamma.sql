-- Q-BU v1.0.15-γ
-- B2. 印刷依頼価格等の設定（pricing_configs）
--
-- Apply AFTER v1.0.15-β SQL.
--
-- What this migration adds:
-- 1) pricing_configs table (history + single active config)
-- 2) print_orders.pricing_config_id
-- 3) view v_pricing_active (admin convenience)
--

begin;

-- ---
-- Pricing configs
-- ---
create table if not exists public.pricing_configs (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  created_by uuid null references auth.users(id) on delete set null,

  -- exactly one active config is expected
  is_active boolean not null default false,
  effective_from timestamptz not null default now(),

  currency text not null default 'JPY',

  -- pricing params (shipping excluded)
  base_fee_yen integer not null default 800,
  per_cm3_yen integer not null default 60,
  min_fee_yen integer not null default 1200,
  rounding_step_yen integer not null default 10,

  note text null
);

-- Ensure at most one active row
create unique index if not exists ux_pricing_single_active
  on public.pricing_configs ((1))
  where is_active = true;

create index if not exists idx_pricing_created_at on public.pricing_configs(created_at desc);
create index if not exists idx_pricing_active_effective on public.pricing_configs(is_active, effective_from desc);

alter table public.pricing_configs enable row level security;

grant select on public.pricing_configs to authenticated;

-- Admin read (owner/admin/ops/analyst)
drop policy if exists pricing_configs_admin_read on public.pricing_configs;
create policy pricing_configs_admin_read
on public.pricing_configs
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

-- Owner update/insert (optional; actual writes are done via service role API)
drop policy if exists pricing_configs_owner_write on public.pricing_configs;
create policy pricing_configs_owner_write
on public.pricing_configs
for all
to authenticated
using (
  exists (
    select 1
    from public.admin_roles ar
    where ar.user_id = auth.uid()
      and ar.is_active = true
      and ar.role = 'owner'
  )
)
with check (
  exists (
    select 1
    from public.admin_roles ar
    where ar.user_id = auth.uid()
      and ar.is_active = true
      and ar.role = 'owner'
  )
);

-- Seed default pricing if empty
insert into public.pricing_configs (is_active, effective_from, currency, base_fee_yen, per_cm3_yen, min_fee_yen, rounding_step_yen, note)
select true, now(), 'JPY', 800, 60, 1200, 10, 'default'
where not exists (select 1 from public.pricing_configs);

-- ---
-- print_orders: reference which pricing config was used
-- ---
alter table public.print_orders
  add column if not exists pricing_config_id bigint null references public.pricing_configs(id) on delete set null;

create index if not exists idx_print_orders_pricing_config on public.print_orders(pricing_config_id);

-- ---
-- Convenience view (admin)
-- ---
create or replace view public.v_pricing_active as
select *
from public.pricing_configs
where is_active = true
order by effective_from desc
limit 1;

grant select on public.v_pricing_active to authenticated;

commit;
