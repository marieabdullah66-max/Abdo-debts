-- V78 - Daily employee/title notes inside Abdo Tasks
-- Run once in Supabase SQL Editor after V76_user_tasks.sql.

create table if not exists public.daily_note_books (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(trim(title)) >= 2 and char_length(title) <= 160),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.daily_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  book_id uuid not null references public.daily_note_books(id) on delete cascade,
  note_text text not null check (char_length(trim(note_text)) >= 2 and char_length(note_text) <= 2500),
  note_date date default current_date,
  priority text not null default 'normal' check (priority in ('urgent','important','normal')),
  followed_up boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_daily_note_books_user_updated on public.daily_note_books(user_id, updated_at desc);
create index if not exists idx_daily_notes_user_book_date on public.daily_notes(user_id, book_id, note_date desc);
create index if not exists idx_daily_notes_followed_up on public.daily_notes(user_id, followed_up);

create or replace function public.touch_daily_note_books_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_daily_note_books_updated_at on public.daily_note_books;
create trigger trg_daily_note_books_updated_at
before update on public.daily_note_books
for each row execute function public.touch_daily_note_books_updated_at();

create or replace function public.touch_daily_notes_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_daily_notes_updated_at on public.daily_notes;
create trigger trg_daily_notes_updated_at
before update on public.daily_notes
for each row execute function public.touch_daily_notes_updated_at();

alter table public.daily_note_books enable row level security;
alter table public.daily_notes enable row level security;

drop policy if exists daily_note_books_select_own on public.daily_note_books;
create policy daily_note_books_select_own on public.daily_note_books for select using (auth.uid() = user_id);

drop policy if exists daily_note_books_insert_own on public.daily_note_books;
create policy daily_note_books_insert_own on public.daily_note_books for insert with check (auth.uid() = user_id);

drop policy if exists daily_note_books_update_own on public.daily_note_books;
create policy daily_note_books_update_own on public.daily_note_books for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists daily_note_books_delete_own on public.daily_note_books;
create policy daily_note_books_delete_own on public.daily_note_books for delete using (auth.uid() = user_id);

drop policy if exists daily_notes_select_own on public.daily_notes;
create policy daily_notes_select_own on public.daily_notes for select using (auth.uid() = user_id);

drop policy if exists daily_notes_insert_own on public.daily_notes;
create policy daily_notes_insert_own on public.daily_notes for insert with check (auth.uid() = user_id);

drop policy if exists daily_notes_update_own on public.daily_notes;
create policy daily_notes_update_own on public.daily_notes for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists daily_notes_delete_own on public.daily_notes;
create policy daily_notes_delete_own on public.daily_notes for delete using (auth.uid() = user_id);
