-- v1.0.17 Gallery / PublicProjects

-- 1) Add public flag
alter table if exists public.user_models
  add column if not exists is_public boolean not null default false;

alter table if exists public.user_models
  add column if not exists published_at timestamptz;

-- 2) Index (public listing)
create index if not exists user_models_is_public_published_at_idx
  on public.user_models (is_public, published_at desc);

-- 3) RLS: allow anyone to read public projects
-- (owners can already read their own via existing policy)
drop policy if exists "user_models_select_public" on public.user_models;
create policy "user_models_select_public"
  on public.user_models
  for select
  to anon, authenticated
  using (is_public = true);
