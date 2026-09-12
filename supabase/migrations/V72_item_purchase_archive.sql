-- V72 — Persistent purchase archive for advanced item movement analysis.
-- Stores the full purchase report once, then monthly sales reports can use the
-- matching purchase rows by date without uploading purchases every month.

create table if not exists public.item_purchase_imports (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete cascade,
  source_name text,
  source_filename text,
  period_start date not null,
  period_end date not null,
  row_count integer not null default 0 check (row_count >= 0),
  unique_item_count integer not null default 0 check (unique_item_count >= 0),
  unresolved_count integer not null default 0 check (unresolved_count >= 0),
  total_purchase_value numeric(18,6) not null default 0,
  total_equivalent_boxes numeric(18,6) not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists item_purchase_imports_branch_created_idx
  on public.item_purchase_imports(branch_id, created_at desc);

create table if not exists public.item_purchase_rows (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.item_purchase_imports(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  purchase_date date not null,
  supplier_name text,
  invoice_number text,
  report_name text not null,
  report_name_norm text not null,
  item_id uuid references public.item_catalog(id) on delete set null,
  unit text not null check (unit in ('علبة','فرط')),
  quantity numeric(16,6) not null default 0,
  boxes_purchased numeric(16,6) not null default 0,
  loose_purchased numeric(16,6) not null default 0,
  units_per_box integer check (units_per_box > 0),
  equivalent_boxes numeric(18,6),
  purchase_value numeric(18,6) not null default 0,
  matched_by text not null default 'unmatched' check (matched_by in ('exact','alias','manual','unmatched')),
  created_at timestamptz not null default now()
);
create index if not exists item_purchase_rows_import_idx on public.item_purchase_rows(import_id);
create index if not exists item_purchase_rows_branch_date_idx on public.item_purchase_rows(branch_id, purchase_date);
create index if not exists item_purchase_rows_item_idx on public.item_purchase_rows(item_id);
create index if not exists item_purchase_rows_unmatched_idx on public.item_purchase_rows(import_id, matched_by);

alter table public.item_purchase_imports enable row level security;
alter table public.item_purchase_rows enable row level security;

revoke all on table public.item_purchase_imports, public.item_purchase_rows
  from anon, authenticated;
