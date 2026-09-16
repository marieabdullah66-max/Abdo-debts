-- V81 - Employee payroll/activity cards inside Abdo Tasks
-- Run once in Supabase SQL Editor after V78_daily_note_books.sql.

create table if not exists public.employee_cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(trim(name)) >= 2 and char_length(name) <= 160),
  base_salary numeric(14,2) not null default 0 check (base_salary >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);

create table if not exists public.employee_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  employee_id uuid not null,
  record_type text not null check (record_type in ('absence','withdrawal','credit','overtime')),
  record_date date not null default current_date,
  quantity numeric(12,2) not null default 0 check (quantity >= 0),
  amount numeric(14,2) not null default 0 check (amount >= 0),
  note text check (note is null or char_length(note) <= 1500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint employee_records_employee_owner_fk foreign key (employee_id, user_id) references public.employee_cards(id, user_id) on delete cascade
);

create index if not exists idx_employee_cards_user_name on public.employee_cards(user_id, name);
create index if not exists idx_employee_records_user_employee_date on public.employee_records(user_id, employee_id, record_date desc);
create index if not exists idx_employee_records_user_type_date on public.employee_records(user_id, record_type, record_date desc);

create or replace function public.touch_employee_cards_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_employee_cards_updated_at on public.employee_cards;
create trigger trg_employee_cards_updated_at
before update on public.employee_cards
for each row execute function public.touch_employee_cards_updated_at();

create or replace function public.touch_employee_records_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_employee_records_updated_at on public.employee_records;
create trigger trg_employee_records_updated_at
before update on public.employee_records
for each row execute function public.touch_employee_records_updated_at();

create or replace function public.touch_employee_card_from_record()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    update public.employee_cards set updated_at = now() where id = old.employee_id;
  else
    update public.employee_cards set updated_at = now() where id = new.employee_id;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_employee_record_touch_parent on public.employee_records;
create trigger trg_employee_record_touch_parent
after insert or update or delete on public.employee_records
for each row execute function public.touch_employee_card_from_record();

alter table public.employee_cards enable row level security;
alter table public.employee_records enable row level security;

drop policy if exists employee_cards_select_own on public.employee_cards;
create policy employee_cards_select_own on public.employee_cards for select using (auth.uid() = user_id);

drop policy if exists employee_cards_insert_own on public.employee_cards;
create policy employee_cards_insert_own on public.employee_cards for insert with check (auth.uid() = user_id);

drop policy if exists employee_cards_update_own on public.employee_cards;
create policy employee_cards_update_own on public.employee_cards for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists employee_cards_delete_own on public.employee_cards;
create policy employee_cards_delete_own on public.employee_cards for delete using (auth.uid() = user_id);

drop policy if exists employee_records_select_own on public.employee_records;
create policy employee_records_select_own on public.employee_records for select using (auth.uid() = user_id);

drop policy if exists employee_records_insert_own on public.employee_records;
create policy employee_records_insert_own on public.employee_records for insert with check (auth.uid() = user_id);

drop policy if exists employee_records_update_own on public.employee_records;
create policy employee_records_update_own on public.employee_records for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists employee_records_delete_own on public.employee_records;
create policy employee_records_delete_own on public.employee_records for delete using (auth.uid() = user_id);
