-- V11: prevent duplicate invoice numbers for the same supplier.
-- Existing duplicates are preserved; this trigger blocks new duplicates and
-- blocks changing an invoice into a duplicate. Invoice numbers are compared
-- case-insensitively after trimming/collapsing whitespace.

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

  -- Serialise inserts/renames for the same supplier + normalized invoice number
  -- so two simultaneous requests cannot both pass the existence check.
  perform pg_advisory_xact_lock(
    hashtextextended(new.supplier_id::text || '|' || v_new_number, 0)
  );

  if exists (
    select 1
    from public.invoices i
    where i.supplier_id = new.supplier_id
      and lower(regexp_replace(btrim(i.invoice_number), '\s+', ' ', 'g')) = v_new_number
      and i.id is distinct from new.id
  ) then
    raise exception using
      errcode = '23505',
      message = 'رقم الفاتورة موجود مسبقًا لهذا المورد ولا يمكن تكراره';
  end if;

  return new;
end;
$$;

drop trigger if exists invoices_prevent_duplicate_number on public.invoices;
create trigger invoices_prevent_duplicate_number
before insert or update of supplier_id, invoice_number on public.invoices
for each row execute function public.prevent_duplicate_supplier_invoice();
