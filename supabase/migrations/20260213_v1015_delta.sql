-- Q-BU v1.0.15-δ
-- C. アプリケーション諸設定
--  C1) 管理者権限等の設定（UI + API）
--  C2) 優待チケット（割引/無料）
--
-- Apply AFTER v1.0.15-γ SQL.
--
-- What this migration adds:
-- - tickets / ticket_redemptions
-- - print_orders: ticket_id / discount_yen / quote_subtotal_yen
-- - admin-only read policies for the above

begin;

-- ---
-- Tickets
-- ---
create table if not exists public.tickets (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid null references auth.users(id) on delete set null,

  -- 'percent' | 'fixed' | 'free' | 'shipping_free'
  type text not null check (type in ('percent','fixed','free','shipping_free')),

  -- Do not store the raw code in DB. Store a hash.
  code_hash text not null unique,
  code_prefix text null,

  -- percent: 0..100, fixed: yen, others: null
  value numeric null,
  currency text not null default 'JPY',

  is_active boolean not null default true,
  expires_at timestamptz null,
  max_total_uses integer null,
  max_uses_per_user integer null,

  constraints jsonb null,
  note text null
);

create index if not exists idx_tickets_active_expires on public.tickets(is_active, expires_at);
create index if not exists idx_tickets_code_prefix on public.tickets(code_prefix);
create index if not exists idx_tickets_created_at on public.tickets(created_at desc);

alter table public.tickets enable row level security;

grant select on public.tickets to authenticated;

-- Admin read (owner/admin/ops/analyst)
drop policy if exists tickets_admin_read on public.tickets;
create policy tickets_admin_read
on public.tickets
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

-- ---
-- Ticket redemptions (usage log)
-- ---
create table if not exists public.ticket_redemptions (
  id bigserial primary key,
  redeemed_at timestamptz not null default now(),

  ticket_id uuid not null references public.tickets(id) on delete cascade,
  order_id uuid not null references public.print_orders(id) on delete cascade,

  user_id uuid null references auth.users(id) on delete set null,
  anon_id text null,

  discount_yen integer null,
  snapshot jsonb null
);

create index if not exists idx_ticket_redemptions_ticket_time on public.ticket_redemptions(ticket_id, redeemed_at desc);
create index if not exists idx_ticket_redemptions_user_time on public.ticket_redemptions(user_id, redeemed_at desc);
create index if not exists idx_ticket_redemptions_anon_time on public.ticket_redemptions(anon_id, redeemed_at desc);

alter table public.ticket_redemptions enable row level security;

grant select on public.ticket_redemptions to authenticated;

-- Admin read
drop policy if exists ticket_redemptions_admin_read on public.ticket_redemptions;
create policy ticket_redemptions_admin_read
on public.ticket_redemptions
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

-- ---
-- print_orders: store applied ticket/discount snapshot
-- ---
alter table public.print_orders
  add column if not exists ticket_id uuid null references public.tickets(id) on delete set null;

alter table public.print_orders
  add column if not exists discount_yen integer null;

-- subtotal before discount (for analytics)
alter table public.print_orders
  add column if not exists quote_subtotal_yen integer null;

create index if not exists idx_print_orders_ticket on public.print_orders(ticket_id);

-- ---
-- Convenience view for admin UI
-- ---
create or replace view public.v_tickets_with_usage as
select
  t.*, 
  coalesce((select count(*) from public.ticket_redemptions r where r.ticket_id = t.id), 0) as used_total
from public.tickets t
order by t.created_at desc;

grant select on public.v_tickets_with_usage to authenticated;

commit;
