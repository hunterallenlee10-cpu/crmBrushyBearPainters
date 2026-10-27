-- Rolls back the Phase 4 estimating configuration seed. Removes the seeded
-- catalog, settings and templates (owner edits to them are lost), the new
-- attention-rule rows, the field change-order grant and the documents bucket.
-- Run before 20261027000100_estimating.down.sql. Owner approval required.

delete from public.pack_permissions where permission = 'change_orders:draft';
delete from public.attention_rules where rule_key in ('estimate_awaiting_reply', 'estimate_expiring');
delete from public.agreement_templates;
delete from public.production_rates;
delete from public.catalog_items;
delete from public.price_books;
delete from public.paint_products;
delete from public.estimate_settings;
drop function if exists app.seed_estimating_defaults(uuid);

do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    delete from storage.objects where bucket_id = 'documents';
    delete from storage.buckets where id = 'documents';
  end if;
end
$$;
