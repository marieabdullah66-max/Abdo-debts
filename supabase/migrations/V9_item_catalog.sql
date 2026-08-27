-- V9 — independent item catalog for item movement analysis.
-- This module is intentionally separate from suppliers, invoices and payments.

create table if not exists public.item_catalog (
  id uuid primary key default gen_random_uuid(),
  item_code text not null unique,
  item_name text not null,
  package_form text,
  units_per_box integer not null check (units_per_box > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists item_catalog_name_idx on public.item_catalog using btree (lower(item_name));
create index if not exists item_catalog_code_idx on public.item_catalog(item_code);

alter table public.item_catalog enable row level security;
revoke all on table public.item_catalog from anon, authenticated;
