-- V18 — Monthly item movement analysis.
-- Stores parsed report summaries/results and persistent name mappings between
-- the sales-system report names and the central item catalog.

create table if not exists public.item_name_aliases (
  id uuid primary key default gen_random_uuid(),
  report_name text not null,
  report_name_norm text not null unique,
  item_id uuid not null references public.item_catalog(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists item_name_aliases_item_idx on public.item_name_aliases(item_id);

create table if not exists public.item_movement_reports (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete cascade,
  source_name text,
  source_filename text,
  period_start date not null,
  period_end date not null,
  days_count integer not null check (days_count > 0),
  transaction_count integer not null default 0 check (transaction_count >= 0),
  unique_item_count integer not null default 0 check (unique_item_count >= 0),
  unresolved_count integer not null default 0 check (unresolved_count >= 0),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(branch_id, period_start, period_end)
);
create index if not exists item_movement_reports_branch_period_idx
  on public.item_movement_reports(branch_id, period_end desc);

create table if not exists public.item_movement_rows (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.item_movement_reports(id) on delete cascade,
  report_name text not null,
  report_name_norm text not null,
  item_id uuid references public.item_catalog(id) on delete set null,
  boxes_sold numeric(16,6) not null default 0 check (boxes_sold >= 0),
  loose_sold numeric(16,6) not null default 0 check (loose_sold >= 0),
  units_per_box integer check (units_per_box > 0),
  equivalent_boxes numeric(18,6),
  daily_rate numeric(18,6),
  matched_by text not null default 'unmatched' check (matched_by in ('exact','alias','manual','unmatched')),
  created_at timestamptz not null default now(),
  unique(report_id, report_name_norm)
);
create index if not exists item_movement_rows_report_idx on public.item_movement_rows(report_id);
create index if not exists item_movement_rows_item_idx on public.item_movement_rows(item_id);
create index if not exists item_movement_rows_unmatched_idx on public.item_movement_rows(report_id, matched_by);

alter table public.item_name_aliases enable row level security;
alter table public.item_movement_reports enable row level security;
alter table public.item_movement_rows enable row level security;

revoke all on table public.item_name_aliases, public.item_movement_reports, public.item_movement_rows
  from anon, authenticated;
