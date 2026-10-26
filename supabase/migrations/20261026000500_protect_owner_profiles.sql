-- Phase 1 follow-up (additive): non-owners with users:manage could demote or
-- deactivate an owner, because the guard only checked *assigning* Owner.
-- Replaces app.profiles_guard() with one extra rule; the trigger is unchanged.

create or replace function app.profiles_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin boolean;
  v_new_grants_all boolean;
begin
  if tg_op = 'UPDATE' then
    if new.id <> old.id or new.org_id <> old.org_id then
      raise exception 'A user cannot be moved to another organization.' using errcode = '42501';
    end if;

    if not app.is_trusted() then
      v_admin := app.can_write('users:manage');
      if not v_admin then
        if old.id <> auth.uid() then
          raise exception 'You can only edit your own profile.' using errcode = '42501';
        end if;
        if new.email is distinct from old.email
           or new.role_template_id is distinct from old.role_template_id
           or new.is_active is distinct from old.is_active
           or new.department is distinct from old.department
           or new.default_territory_id is distinct from old.default_territory_id
           or new.invited_at is distinct from old.invited_at
           or new.invited_by is distinct from old.invited_by
           or new.deactivated_at is distinct from old.deactivated_at
           or new.deactivated_by is distinct from old.deactivated_by then
          raise exception 'Only an admin can change role, status, email, department or territory.' using errcode = '42501';
        end if;
      else
        if new.id = auth.uid() and new.is_active is distinct from old.is_active then
          raise exception 'You cannot deactivate yourself.' using errcode = '42501';
        end if;
      end if;

      -- Only owners can change an owner's role, status or sign-in email.
      if not app.is_grants_all_user(auth.uid())
         and exists (select 1 from public.role_templates t where t.id = old.role_template_id and t.grants_all)
         and (new.role_template_id is distinct from old.role_template_id
              or new.is_active is distinct from old.is_active
              or new.email is distinct from old.email) then
        raise exception 'Only an owner can change another owner''s role, status or email.' using errcode = '42501';
      end if;

      -- Assigning an owner-level template requires an owner.
      if new.role_template_id is distinct from old.role_template_id then
        select t.grants_all into v_new_grants_all from public.role_templates t where t.id = new.role_template_id;
        if v_new_grants_all and not app.is_grants_all_user(auth.uid()) then
          raise exception 'Only an owner can assign the Owner role.' using errcode = '42501';
        end if;
      end if;
    end if;

    -- Keep deactivation bookkeeping consistent.
    if new.is_active and not old.is_active then
      new.deactivated_at := null;
      new.deactivated_by := null;
    elsif not new.is_active and old.is_active then
      new.deactivated_at := coalesce(new.deactivated_at, now());
      new.deactivated_by := coalesce(new.deactivated_by, app.actor_id());
    end if;
  end if;

  -- The template must belong to the same org.
  if not exists (
    select 1 from public.role_templates t
    where t.id = new.role_template_id and t.org_id = new.org_id and t.deleted_at is null
  ) then
    raise exception 'Role template does not exist in this organization.' using errcode = '23503';
  end if;
  return new;
end;
$$;
