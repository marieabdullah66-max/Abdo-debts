-- V13 — Payment plan / supplier payment schedule.
create table if not exists public.payment_plans (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  branch_id uuid not null references public.branches(id) on delete restrict,
  planned_amount numeric(14,2) not null check (planned_amount > 0),
  planned_date date not null,
  notes text,
  status text not null default 'planned' check (status in ('planned','postponed','completed','cancelled')),
  postpone_count integer not null default 0 check (postpone_count >= 0),
  last_postpone_reason text,
  completed_payment_id uuid references public.payments(id) on delete set null,
  completed_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists payment_plans_date_idx on public.payment_plans(planned_date, status);
create index if not exists payment_plans_supplier_idx on public.payment_plans(supplier_id, planned_date);
create index if not exists payment_plans_branch_idx on public.payment_plans(branch_id, planned_date);
create index if not exists payment_plans_status_idx on public.payment_plans(status, planned_date);

alter table public.payment_plans enable row level security;
revoke all on table public.payment_plans from anon, authenticated;
