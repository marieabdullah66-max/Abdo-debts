-- Abdo Debts v1 - fresh Supabase project schema
create extension if not exists pgcrypto;

create table if not exists public.branches (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  full_name text not null,
  role text not null default 'finance' check (role in ('admin','finance','viewer')),
  active boolean not null default true,
  permissions jsonb not null default '{}'::jsonb,
  all_branches boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.profile_branches (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  primary key (profile_id, branch_id)
);

create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  notes text,
  active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists suppliers_name_idx on public.suppliers using btree (lower(name));

create table if not exists public.supplier_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);
create index if not exists supplier_categories_name_idx on public.supplier_categories using btree (lower(name));

create table if not exists public.supplier_category_links (
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  category_id uuid not null references public.supplier_categories(id) on delete restrict,
  primary key (supplier_id, category_id)
);
create index if not exists supplier_category_links_category_idx on public.supplier_category_links(category_id);


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


-- V18 — Monthly item movement analysis.
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
create index if not exists item_movement_reports_branch_period_idx on public.item_movement_reports(branch_id, period_end desc);

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

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  event_type text not null check (event_type in ('invoice_created','payment_created')),
  branch_id uuid not null references public.branches(id) on delete cascade,
  supplier_id uuid references public.suppliers(id) on delete set null,
  entity_id uuid not null,
  amount numeric(14,2) not null check (amount >= 0),
  invoice_number text,
  supplier_name text not null,
  branch_name text not null,
  actor_id uuid references public.profiles(id) on delete set null,
  actor_name text not null,
  created_at timestamptz not null default now()
);
create index if not exists notifications_created_idx on public.notifications(created_at desc);
create index if not exists notifications_branch_idx on public.notifications(branch_id, created_at desc);
create index if not exists notifications_event_idx on public.notifications(event_type, created_at desc);

create table if not exists public.notification_reads (
  notification_id uuid not null references public.notifications(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (notification_id, profile_id)
);
create index if not exists notification_reads_profile_idx on public.notification_reads(profile_id, read_at desc);

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  branch_id uuid not null references public.branches(id) on delete restrict,
  invoice_number text not null,
  amount numeric(14,2) not null check (amount > 0),
  invoice_date date not null,
  due_date date,
  notes text,
  pdf_path text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists invoices_supplier_idx on public.invoices(supplier_id);
create index if not exists invoices_branch_idx on public.invoices(branch_id);
create index if not exists invoices_date_idx on public.invoices(invoice_date desc);
create index if not exists invoices_number_idx on public.invoices(invoice_number);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  branch_id uuid not null references public.branches(id) on delete restrict,
  amount numeric(14,2) not null check (amount > 0),
  payment_date date not null,
  method text not null check (method in ('cash','bank')),
  bank_name text,
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_bank_name_check check ((method = 'cash' and bank_name is null) or (method = 'bank' and nullif(trim(bank_name),'') is not null))
);
create index if not exists payments_supplier_idx on public.payments(supplier_id);
create index if not exists payments_branch_idx on public.payments(branch_id);
create index if not exists payments_date_idx on public.payments(payment_date desc);

create table if not exists public.payment_allocations (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  amount numeric(14,2) not null check (amount > 0),
  unique(payment_id, invoice_id)
);
create index if not exists payment_allocations_invoice_idx on public.payment_allocations(invoice_id);
create index if not exists payment_allocations_payment_idx on public.payment_allocations(payment_id);

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

create or replace view public.invoice_balances as
select
  i.id, i.supplier_id, i.branch_id, s.name as supplier_name, b.name as branch_name,
  i.invoice_number, i.amount, i.invoice_date, i.due_date,
  i.notes, i.pdf_path, i.created_by, i.created_at, i.updated_at,
  coalesce(sum(pa.amount), 0)::numeric(14,2) as paid_amount,
  (i.amount - coalesce(sum(pa.amount), 0))::numeric(14,2) as balance,
  case
    when coalesce(sum(pa.amount),0) = 0 then 'unpaid'
    when coalesce(sum(pa.amount),0) < i.amount then 'partial'
    else 'paid'
  end as status
from public.invoices i
join public.suppliers s on s.id = i.supplier_id
join public.branches b on b.id = i.branch_id
left join public.payment_allocations pa on pa.invoice_id = i.id
group by i.id, s.name, b.name;

-- Atomic create: one payment can be distributed manually over several invoices,
-- but every selected invoice must belong to the same supplier and branch.
create or replace function public.create_payment_with_allocations(
  p_supplier_id uuid,
  p_branch_id uuid,
  p_amount numeric,
  p_payment_date date,
  p_method text,
  p_bank_name text,
  p_notes text,
  p_created_by uuid,
  p_allocations jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment_id uuid;
  v_item jsonb;
  v_invoice_id uuid;
  v_alloc numeric;
  v_invoice public.invoices%rowtype;
  v_paid numeric;
  v_sum numeric := 0;
begin
  if p_method not in ('cash','bank') then raise exception 'Invalid payment method'; end if;
  if p_method = 'bank' and nullif(trim(coalesce(p_bank_name,'')),'') is null then raise exception 'Bank name required'; end if;
  if jsonb_array_length(p_allocations) = 0 then raise exception 'Allocations required'; end if;

  for v_item in select * from jsonb_array_elements(p_allocations) loop
    v_invoice_id := (v_item->>'invoice_id')::uuid;
    v_alloc := (v_item->>'amount')::numeric;
    if v_alloc <= 0 then raise exception 'Invalid allocation'; end if;
    select * into v_invoice from public.invoices where id = v_invoice_id for update;
    if not found then raise exception 'Invoice not found'; end if;
    if v_invoice.supplier_id <> p_supplier_id or v_invoice.branch_id <> p_branch_id then
      raise exception 'Invoices must match supplier and branch';
    end if;
    select coalesce(sum(amount),0) into v_paid from public.payment_allocations where invoice_id = v_invoice_id;
    if v_alloc > (v_invoice.amount - v_paid) then raise exception 'Allocation exceeds invoice balance'; end if;
    v_sum := v_sum + v_alloc;
  end loop;
  if round(v_sum,2) <> round(p_amount,2) then raise exception 'Allocations must equal payment amount'; end if;

  insert into public.payments(supplier_id,branch_id,amount,payment_date,method,bank_name,notes,created_by)
  values(p_supplier_id,p_branch_id,p_amount,p_payment_date,p_method,case when p_method='bank' then nullif(trim(p_bank_name),'') else null end,p_notes,p_created_by)
  returning id into v_payment_id;

  for v_item in select * from jsonb_array_elements(p_allocations) loop
    insert into public.payment_allocations(payment_id,invoice_id,amount)
    values(v_payment_id,(v_item->>'invoice_id')::uuid,(v_item->>'amount')::numeric);
  end loop;
  return v_payment_id;
end;
$$;

create or replace function public.update_payment_with_allocations(
  p_payment_id uuid,
  p_supplier_id uuid,
  p_branch_id uuid,
  p_amount numeric,
  p_payment_date date,
  p_method text,
  p_bank_name text,
  p_notes text,
  p_allocations jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_invoice_id uuid;
  v_alloc numeric;
  v_invoice public.invoices%rowtype;
  v_paid_other numeric;
  v_sum numeric := 0;
begin
  perform 1 from public.payments where id = p_payment_id for update;
  if not found then raise exception 'Payment not found'; end if;
  if p_method not in ('cash','bank') then raise exception 'Invalid payment method'; end if;
  if p_method = 'bank' and nullif(trim(coalesce(p_bank_name,'')),'') is null then raise exception 'Bank name required'; end if;
  if jsonb_array_length(p_allocations) = 0 then raise exception 'Allocations required'; end if;

  for v_item in select * from jsonb_array_elements(p_allocations) loop
    v_invoice_id := (v_item->>'invoice_id')::uuid;
    v_alloc := (v_item->>'amount')::numeric;
    if v_alloc <= 0 then raise exception 'Invalid allocation'; end if;
    select * into v_invoice from public.invoices where id = v_invoice_id for update;
    if not found then raise exception 'Invoice not found'; end if;
    if v_invoice.supplier_id <> p_supplier_id or v_invoice.branch_id <> p_branch_id then raise exception 'Invoices must match supplier and branch'; end if;
    select coalesce(sum(amount),0) into v_paid_other from public.payment_allocations where invoice_id = v_invoice_id and payment_id <> p_payment_id;
    if v_alloc > (v_invoice.amount - v_paid_other) then raise exception 'Allocation exceeds invoice balance'; end if;
    v_sum := v_sum + v_alloc;
  end loop;
  if round(v_sum,2) <> round(p_amount,2) then raise exception 'Allocations must equal payment amount'; end if;

  update public.payments set supplier_id=p_supplier_id, branch_id=p_branch_id, amount=p_amount,
    payment_date=p_payment_date, method=p_method,
    bank_name=case when p_method='bank' then nullif(trim(p_bank_name),'') else null end,
    notes=p_notes, updated_at=now()
  where id=p_payment_id;

  delete from public.payment_allocations where payment_id=p_payment_id;
  for v_item in select * from jsonb_array_elements(p_allocations) loop
    insert into public.payment_allocations(payment_id,invoice_id,amount)
    values(p_payment_id,(v_item->>'invoice_id')::uuid,(v_item->>'amount')::numeric);
  end loop;
end;
$$;

-- Frontend talks only to FastAPI. Keep direct browser database access locked down.
alter table public.branches enable row level security;
alter table public.profiles enable row level security;
alter table public.profile_branches enable row level security;
alter table public.suppliers enable row level security;
alter table public.supplier_categories enable row level security;
alter table public.supplier_category_links enable row level security;
alter table public.invoices enable row level security;
alter table public.payments enable row level security;
alter table public.payment_allocations enable row level security;
alter table public.payment_plans enable row level security;
alter table public.item_catalog enable row level security;
alter table public.item_name_aliases enable row level security;
alter table public.item_movement_reports enable row level security;
alter table public.item_movement_rows enable row level security;
alter table public.notifications enable row level security;
alter table public.notification_reads enable row level security;

-- Private bucket for the original invoice PDF attachment (max enforced again in API).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('invoice-pdfs', 'invoice-pdfs', false, 10485760, array['application/pdf'])
on conflict (id) do update set public=false, file_size_limit=10485760, allowed_mime_types=array['application/pdf'];

-- Do not expose financial data directly through the public Supabase API roles.
revoke all on table public.branches, public.profiles, public.profile_branches, public.suppliers,
  public.supplier_categories, public.supplier_category_links, public.invoices, public.payments,
  public.payment_allocations, public.payment_plans, public.item_catalog, public.item_name_aliases, public.item_movement_reports, public.item_movement_rows, public.notifications, public.notification_reads from anon, authenticated;
revoke all on table public.invoice_balances from anon, authenticated;
revoke execute on function public.create_payment_with_allocations(uuid,uuid,numeric,date,text,text,text,uuid,jsonb) from public, anon, authenticated;
revoke execute on function public.update_payment_with_allocations(uuid,uuid,uuid,numeric,date,text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.create_payment_with_allocations(uuid,uuid,numeric,date,text,text,text,uuid,jsonb) to service_role;
grant execute on function public.update_payment_with_allocations(uuid,uuid,uuid,numeric,date,text,text,text,jsonb) to service_role;

-- V11 — Prevent duplicate invoice numbers for the same supplier.
create or replace function public.prevent_duplicate_supplier_invoice()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_new_number text;
  v_old_number text;
begin
  v_new_number := lower(regexp_replace(btrim(new.invoice_number), '\s+', ' ', 'g'));
  if tg_op = 'UPDATE' then
    v_old_number := lower(regexp_replace(btrim(old.invoice_number), '\s+', ' ', 'g'));
    if new.supplier_id = old.supplier_id and v_new_number = v_old_number then
      return new;
    end if;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(new.supplier_id::text || '|' || v_new_number, 0));
  if exists (
    select 1 from public.invoices i
    where i.supplier_id = new.supplier_id
      and lower(regexp_replace(btrim(i.invoice_number), '\s+', ' ', 'g')) = v_new_number
      and i.id is distinct from new.id
  ) then
    raise exception using errcode = '23505', message = 'رقم الفاتورة موجود مسبقًا لهذا المورد ولا يمكن تكراره';
  end if;
  return new;
end;
$$;

drop trigger if exists invoices_prevent_duplicate_number on public.invoices;
create trigger invoices_prevent_duplicate_number
before insert or update of supplier_id, invoice_number on public.invoices
for each row execute function public.prevent_duplicate_supplier_invoice();
