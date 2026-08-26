-- Abdo Debts V5 - supplier multi-category classification
-- Run once in Supabase SQL Editor for an existing V1-V4 database.

create table if not exists public.supplier_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);
create index if not exists supplier_categories_name_idx
  on public.supplier_categories using btree (lower(name));

create table if not exists public.supplier_category_links (
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  category_id uuid not null references public.supplier_categories(id) on delete restrict,
  primary key (supplier_id, category_id)
);
create index if not exists supplier_category_links_category_idx
  on public.supplier_category_links(category_id);

alter table public.supplier_categories enable row level security;
alter table public.supplier_category_links enable row level security;

revoke all on table public.supplier_categories, public.supplier_category_links from anon, authenticated;
