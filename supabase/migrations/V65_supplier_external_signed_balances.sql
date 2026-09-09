-- V65 — Signed supplier external balances
-- Positive value from supplier report = debt for us.
-- Negative value from supplier report = debt on us.
-- Zero = no debt.

create table if not exists public.supplier_external_balances (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  signed_balance numeric(14,2) not null default 0,
  reference_no text,
  last_payment_date date,
  last_invoice_date date,
  source text not null default 'supplier_import',
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (supplier_id, branch_id)
);

create index if not exists supplier_external_balances_supplier_idx on public.supplier_external_balances(supplier_id);
create index if not exists supplier_external_balances_branch_idx on public.supplier_external_balances(branch_id);
create index if not exists supplier_external_balances_signed_idx on public.supplier_external_balances(signed_balance);

revoke all on table public.supplier_external_balances from anon, authenticated;
grant all on table public.supplier_external_balances to service_role;
