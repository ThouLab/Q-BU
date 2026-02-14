-- v1.0.15-δ2: store model data (blocks/support) for admin preview & re-export

alter table if exists public.print_orders
  add column if not exists model_data jsonb;

-- Optional index for querying by fingerprint in the future
create index if not exists print_orders_model_fingerprint_idx on public.print_orders (model_fingerprint);
