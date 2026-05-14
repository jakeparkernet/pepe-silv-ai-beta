create extension if not exists pgcrypto;

create table if not exists public.credit_accounts (
    user_id uuid primary key references auth.users(id) on delete cascade,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.credit_ledger (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    amount_usd numeric(12, 6) not null,
    entry_type text not null check (entry_type in ('purchase', 'debit', 'refund', 'adjustment')),
    reservation_id uuid,
    stripe_session_id text,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

create unique index if not exists credit_ledger_stripe_session_id_key
    on public.credit_ledger(stripe_session_id)
    where stripe_session_id is not null;

create table if not exists public.company_pair_requests (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    company_a_name text not null,
    company_a_context text not null default '',
    company_b_name text not null,
    company_b_context text not null default '',
    company_a_entity_id text,
    company_b_entity_id text,
    ownership_tree_id uuid,
    status text not null default 'queued' check (status in ('queued', 'in-progress', 'complete', 'failed', 'cancelled')),
    credit_reservation_id uuid,
    remote_requested_at timestamptz,
    started_at timestamptz,
    ended_at timestamptz,
    machine_id text,
    openrouter_cost numeric(12, 6),
    fly_io_investigation_cost numeric(12, 6),
    markup_cost numeric(12, 6),
    total_cost numeric(12, 6),
    error text,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.credit_reservations (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    request_id uuid references public.company_pair_requests(id) on delete set null,
    amount_usd numeric(12, 6) not null check (amount_usd > 0),
    settled_amount_usd numeric(12, 6),
    status text not null default 'reserved' check (status in ('reserved', 'settled', 'released')),
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    settled_at timestamptz
);

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'company_pair_requests_credit_reservation_id_fkey'
    ) then
        alter table public.company_pair_requests
            add constraint company_pair_requests_credit_reservation_id_fkey
            foreign key (credit_reservation_id) references public.credit_reservations(id) on delete set null;
    end if;
end $$;

create table if not exists public.stripe_checkout_sessions (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    stripe_session_id text not null unique,
    amount_usd numeric(12, 6) not null,
    credits_usd numeric(12, 6) not null,
    status text not null default 'created' check (status in ('created', 'paid', 'expired', 'failed')),
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create or replace function public.get_credit_balance(p_user_id uuid)
returns table(total_balance_usd numeric, reserved_usd numeric, available_balance_usd numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_total numeric(12, 6);
    v_reserved numeric(12, 6);
begin
    if auth.uid() is not null and auth.uid() <> p_user_id and current_setting('request.jwt.claim.role', true) <> 'service_role' then
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
    p_user_id uuid,
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
begin
    if current_setting('request.jwt.claim.role', true) <> 'service_role' then
        raise exception 'not allowed';
    end if;

    if p_amount_usd <= 0 then
        raise exception 'reservation amount must be positive';
    end if;

    perform pg_advisory_xact_lock(hashtext(p_user_id::text));

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
begin
    if current_setting('request.jwt.claim.role', true) <> 'service_role' then
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
begin
    if current_setting('request.jwt.claim.role', true) <> 'service_role' then
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

alter table public.credit_accounts enable row level security;
alter table public.credit_ledger enable row level security;
alter table public.credit_reservations enable row level security;
alter table public.company_pair_requests enable row level security;
alter table public.stripe_checkout_sessions enable row level security;

drop policy if exists "credit accounts own read" on public.credit_accounts;
create policy "credit accounts own read"
on public.credit_accounts for select
using (auth.uid() = user_id);

drop policy if exists "credit ledger own read" on public.credit_ledger;
create policy "credit ledger own read"
on public.credit_ledger for select
using (auth.uid() = user_id);

drop policy if exists "credit reservations own read" on public.credit_reservations;
create policy "credit reservations own read"
on public.credit_reservations for select
using (auth.uid() = user_id);

drop policy if exists "company pair requests own read" on public.company_pair_requests;
create policy "company pair requests own read"
on public.company_pair_requests for select
using (auth.uid() = user_id);

drop policy if exists "stripe checkout sessions own read" on public.stripe_checkout_sessions;
create policy "stripe checkout sessions own read"
on public.stripe_checkout_sessions for select
using (auth.uid() = user_id);

insert into public.settings(key, value)
values
    ('company_pair_search_requires_paid_lookup', 'false'),
    ('company_pair_lookup_cost_usd', '0'),
    ('company_pair_research_min_reserve_usd', '10'),
    ('company_pair_markup_usd', '2'),
    ('fly_io_cost_per_second', '0.00001196')
on conflict (key) do nothing;

revoke execute on function public.get_credit_balance(uuid) from public;
grant execute on function public.get_credit_balance(uuid) to authenticated, service_role;
revoke execute on function public.reserve_user_credits(uuid, numeric, uuid, jsonb) from public;
grant execute on function public.reserve_user_credits(uuid, numeric, uuid, jsonb) to service_role;
revoke execute on function public.settle_credit_reservation(uuid, numeric, jsonb) from public;
grant execute on function public.settle_credit_reservation(uuid, numeric, jsonb) to service_role;
revoke execute on function public.release_credit_reservation(uuid, jsonb) from public;
grant execute on function public.release_credit_reservation(uuid, jsonb) to service_role;
