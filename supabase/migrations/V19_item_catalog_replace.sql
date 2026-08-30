-- V19 — Safely reset the item catalog so a fresh catalog can be imported at any time.
-- Historical movement reports are preserved. Their old catalog links are invalidated.

create or replace function public.reset_item_catalog()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_items integer := 0;
  v_aliases integer := 0;
  v_reports integer := 0;
begin
  select count(*) into v_items from public.item_catalog;
  select count(*) into v_aliases from public.item_name_aliases;
  select count(*) into v_reports from public.item_movement_reports;

  -- Aliases are specific to the old catalog and must not survive a replacement.
  delete from public.item_name_aliases;

  -- item_movement_rows.item_id uses ON DELETE SET NULL, so reports remain intact.
  delete from public.item_catalog;

  -- Clear catalog-dependent calculations. Box-only movement is still valid without a catalog;
  -- loose sales require a new pack size and therefore become unresolved until remapped/reimported.
  update public.item_movement_rows mr
     set item_id = null,
         units_per_box = null,
         equivalent_boxes = case when coalesce(mr.loose_sold, 0) = 0 then mr.boxes_sold else null end,
         daily_rate = case
           when coalesce(mr.loose_sold, 0) = 0 and r.days_count > 0
             then round((mr.boxes_sold / r.days_count)::numeric, 6)
           else null
         end,
         matched_by = 'unmatched'
    from public.item_movement_reports r
   where mr.report_id = r.id;

  update public.item_movement_reports
     set unresolved_count = unique_item_count;

  return jsonb_build_object(
    'ok', true,
    'deleted_items', v_items,
    'deleted_aliases', v_aliases,
    'preserved_reports', v_reports
  );
end;
$$;

revoke all on function public.reset_item_catalog() from public, anon, authenticated;
grant execute on function public.reset_item_catalog() to service_role;
