drop policy if exists "credit accounts own read" on public.credit_accounts;
drop policy if exists "credit ledger own read" on public.credit_ledger;
drop policy if exists "credit reservations own read" on public.credit_reservations;
drop policy if exists "company pair requests own read" on public.company_pair_requests;
drop policy if exists "stripe checkout sessions own read" on public.stripe_checkout_sessions;

drop function if exists public.get_credit_balance(uuid);
drop function if exists public.reserve_user_credits(uuid, numeric, uuid, jsonb);
drop function if exists public.settle_credit_reservation(uuid, numeric, jsonb);
drop function if exists public.release_credit_reservation(uuid, jsonb);

alter table public.credit_accounts
    drop constraint if exists credit_accounts_user_id_fkey;
alter table public.credit_ledger
    drop constraint if exists credit_ledger_user_id_fkey;
alter table public.company_pair_requests
    drop constraint if exists company_pair_requests_user_id_fkey;
alter table public.credit_reservations
    drop constraint if exists credit_reservations_user_id_fkey;
alter table public.stripe_checkout_sessions
    drop constraint if exists stripe_checkout_sessions_user_id_fkey;

alter table public.credit_accounts
    alter column user_id type text using user_id::text;
alter table public.credit_ledger
    alter column user_id type text using user_id::text;
alter table public.company_pair_requests
    alter column user_id type text using user_id::text;
alter table public.credit_reservations
    alter column user_id type text using user_id::text;
alter table public.stripe_checkout_sessions
    alter column user_id type text using user_id::text;

create or replace function public.get_credit_balance(p_user_id text)
returns table(total_balance_usd numeric, reserved_usd numeric, available_balance_usd numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_total numeric(12, 6);
    v_reserved numeric(12, 6);
    v_claim_sub text;
    v_claim_role text;
begin
    v_claim_sub := auth.jwt()->>'sub';
    v_claim_role := coalesce(current_setting('request.jwt.claim.role', true), auth.jwt()->>'role', '');

    if v_claim_role <> 'service_role' and coalesce(v_claim_sub, '') <> p_user_id then
        raise exception 'not allowed';
    end if;

    select coalesce(sum(amount_usd), 0)
    into v_total
    from public.credit_ledger
    where user_id = p_user_id;

    select coalesce(sum(amount_usd), 0)
    into v_reserved
    from public.credit_reservations
    where user_id = p_user_id and status = 'reserved';

    total_balance_usd := v_total;
    reserved_usd := v_reserved;
    available_balance_usd := v_total - v_reserved;
    return next;
end;
$$;

create or replace function public.reserve_user_credits(
    p_user_id text,
    p_amount_usd numeric,
    p_request_id uuid,
    p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    v_available numeric(12, 6);
    v_reservation_id uuid;
    v_claim_role text;
begin
    v_claim_role := coalesce(current_setting('request.jwt.claim.role', true), auth.jwt()->>'role', '');
    if v_claim_role <> 'service_role' then
        raise exception 'not allowed';
    end if;

    if p_amount_usd <= 0 then
        raise exception 'reservation amount must be positive';
    end if;

    perform pg_advisory_xact_lock(hashtext(p_user_id));

    insert into public.credit_accounts(user_id)
    values (p_user_id)
    on conflict (user_id) do update set updated_at = now();

    select available_balance_usd
    into v_available
    from public.get_credit_balance(p_user_id);

    if v_available < p_amount_usd then
        raise exception 'insufficient credits';
    end if;

    insert into public.credit_reservations(user_id, request_id, amount_usd, metadata)
    values (p_user_id, p_request_id, p_amount_usd, coalesce(p_metadata, '{}'::jsonb))
    returning id into v_reservation_id;

    return v_reservation_id;
end;
$$;

create or replace function public.settle_credit_reservation(
    p_reservation_id uuid,
    p_actual_amount_usd numeric,
    p_metadata jsonb default '{}'::jsonb
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
    v_reservation public.credit_reservations%rowtype;
    v_debit numeric(12, 6);
    v_claim_role text;
begin
    v_claim_role := coalesce(current_setting('request.jwt.claim.role', true), auth.jwt()->>'role', '');
    if v_claim_role <> 'service_role' then
        raise exception 'not allowed';
    end if;

    if p_actual_amount_usd < 0 then
        raise exception 'settlement amount cannot be negative';
    end if;

    select *
    into v_reservation
    from public.credit_reservations
    where id = p_reservation_id
    for update;

    if not found then
        raise exception 'reservation not found';
    end if;

    if v_reservation.status <> 'reserved' then
        return coalesce(v_reservation.settled_amount_usd, 0);
    end if;

    v_debit := least(p_actual_amount_usd, v_reservation.amount_usd);

    update public.credit_reservations
    set status = 'settled',
        settled_amount_usd = v_debit,
        settled_at = now(),
        metadata = coalesce(metadata, '{}'::jsonb) || coalesce(p_metadata, '{}'::jsonb)
    where id = p_reservation_id;

    if v_debit > 0 then
        insert into public.credit_ledger(user_id, amount_usd, entry_type, reservation_id, metadata)
        values (v_reservation.user_id, -v_debit, 'debit', p_reservation_id, coalesce(p_metadata, '{}'::jsonb));
    end if;

    return v_debit;
end;
$$;

create or replace function public.release_credit_reservation(
    p_reservation_id uuid,
    p_metadata jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
    v_claim_role text;
begin
    v_claim_role := coalesce(current_setting('request.jwt.claim.role', true), auth.jwt()->>'role', '');
    if v_claim_role <> 'service_role' then
        raise exception 'not allowed';
    end if;

    update public.credit_reservations
    set status = 'released',
        settled_at = now(),
        metadata = coalesce(metadata, '{}'::jsonb) || coalesce(p_metadata, '{}'::jsonb)
    where id = p_reservation_id and status = 'reserved';

    return found;
end;
$$;

create policy "credit accounts own read"
on public.credit_accounts for select
using ((auth.jwt()->>'sub') = user_id);

create policy "credit ledger own read"
on public.credit_ledger for select
using ((auth.jwt()->>'sub') = user_id);

create policy "credit reservations own read"
on public.credit_reservations for select
using ((auth.jwt()->>'sub') = user_id);

create policy "company pair requests own read"
on public.company_pair_requests for select
using ((auth.jwt()->>'sub') = user_id);

create policy "stripe checkout sessions own read"
on public.stripe_checkout_sessions for select
using ((auth.jwt()->>'sub') = user_id);

revoke execute on function public.get_credit_balance(text) from public;
grant execute on function public.get_credit_balance(text) to authenticated, service_role;
revoke execute on function public.reserve_user_credits(text, numeric, uuid, jsonb) from public;
grant execute on function public.reserve_user_credits(text, numeric, uuid, jsonb) to service_role;
revoke execute on function public.settle_credit_reservation(uuid, numeric, jsonb) from public;
grant execute on function public.settle_credit_reservation(uuid, numeric, jsonb) to service_role;
revoke execute on function public.release_credit_reservation(uuid, jsonb) from public;
grant execute on function public.release_credit_reservation(uuid, jsonb) to service_role;
