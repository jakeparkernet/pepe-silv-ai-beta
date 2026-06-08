-- Large migration note: this migration keeps the feature flag, account, article
-- funding, and company-pair funding changes together so the gated credits launch
-- can be applied or rolled back as one coherent database capability.
create extension if not exists pgcrypto;

create table if not exists public.site_feature_flags (
    key text primary key,
    enabled boolean not null default false,
    description text not null default '',
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

insert into public.site_feature_flags(key, enabled, description)
values (
    'investigation_credits',
    false,
    'Gate Clerk login, Stripe credit purchases, and investigation credit deductions.'
)
on conflict (key) do nothing;

insert into public.settings(key, value)
values ('investigation_start_flat_cost_usd', '0.05')
on conflict (key) do nothing;

create table if not exists public.user_account_preferences (
    user_id text primary key,
    email_notifications_enabled boolean not null default true,
    deleted_at timestamptz,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.user_notification_outbox (
    id uuid primary key default gen_random_uuid(),
    user_id text not null,
    notification_type text not null,
    status text not null default 'pending' check (status in ('pending', 'sent', 'skipped', 'failed')),
    subject text not null default '',
    body text not null default '',
    metadata jsonb not null default '{}'::jsonb,
    error text,
    created_at timestamptz not null default now(),
    sent_at timestamptz
);

create index if not exists user_notification_outbox_status_idx
    on public.user_notification_outbox(status, created_at);

alter table public.article_queue
    add column if not exists started_by_user_id text,
    add column if not exists credit_feature_enabled boolean not null default false,
    add column if not exists flat_start_cost_usd numeric(12, 6) not null default 0,
    add column if not exists credit_cost_debited_usd numeric(12, 6) not null default 0,
    add column if not exists funding_status text not null default 'not_required',
    add column if not exists needs_funding_at timestamptz,
    add column if not exists funding_notice_sent_at timestamptz;

alter table public.company_pair_requests
    drop constraint if exists company_pair_requests_status_check;

alter table public.company_pair_requests
    add constraint company_pair_requests_status_check
    check (status in ('queued', 'in-progress', 'complete', 'failed', 'cancelled', 'paused'));

alter table public.company_pair_requests
    add column if not exists credit_feature_enabled boolean not null default false,
    add column if not exists flat_start_cost_usd numeric(12, 6) not null default 0,
    add column if not exists credit_cost_debited_usd numeric(12, 6) not null default 0,
    add column if not exists funding_status text not null default 'not_required',
    add column if not exists needs_funding_at timestamptz,
    add column if not exists funding_notice_sent_at timestamptz;

create table if not exists public.article_investigation_funders (
    id uuid primary key default gen_random_uuid(),
    queue_id uuid not null references public.article_queue(id) on delete cascade,
    user_id text not null,
    status text not null default 'funding' check (status in ('funding', 'opted_out')),
    is_starter boolean not null default false,
    contributed_usd numeric(12, 6) not null default 0,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique(queue_id, user_id)
);

create index if not exists article_investigation_funders_queue_status_idx
    on public.article_investigation_funders(queue_id, status);

create table if not exists public.company_pair_investigation_funders (
    id uuid primary key default gen_random_uuid(),
    request_id uuid not null references public.company_pair_requests(id) on delete cascade,
    user_id text not null,
    status text not null default 'funding' check (status in ('funding', 'opted_out')),
    is_starter boolean not null default false,
    contributed_usd numeric(12, 6) not null default 0,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique(request_id, user_id)
);

create index if not exists company_pair_investigation_funders_request_status_idx
    on public.company_pair_investigation_funders(request_id, status);

create or replace function public.is_site_feature_enabled(p_key text, p_default boolean default false)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select coalesce((select enabled from public.site_feature_flags where key = p_key), p_default);
$$;

create or replace function public.get_money_setting(p_key text, p_default numeric)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_value text;
    v_money numeric;
begin
    select value into v_value from public.settings where key = p_key;
    begin
        v_money := v_value::numeric;
    exception when others then
        v_money := p_default;
    end;
    if v_money is null or v_money < 0 then
        return p_default;
    end if;
    return v_money;
end;
$$;

create or replace function public.ensure_user_account_preferences(p_user_id text)
returns public.user_account_preferences
language plpgsql
security definer
set search_path = public
as $$
declare
    v_claim_sub text;
    v_claim_role text;
    v_row public.user_account_preferences%rowtype;
begin
    v_claim_sub := auth.jwt()->>'sub';
    v_claim_role := coalesce(current_setting('request.jwt.claim.role', true), auth.jwt()->>'role', '');
    if v_claim_role <> 'service_role' and coalesce(v_claim_sub, '') <> p_user_id then
        raise exception 'not allowed';
    end if;

    insert into public.user_account_preferences(user_id)
    values (p_user_id)
    on conflict (user_id) do update set updated_at = now()
    returning * into v_row;

    return v_row;
end;
$$;

create or replace function public.update_user_account_preferences(
    p_user_id text,
    p_email_notifications_enabled boolean default null,
    p_delete_account boolean default false
)
returns public.user_account_preferences
language plpgsql
security definer
set search_path = public
as $$
declare
    v_claim_sub text;
    v_claim_role text;
    v_row public.user_account_preferences%rowtype;
begin
    v_claim_sub := auth.jwt()->>'sub';
    v_claim_role := coalesce(current_setting('request.jwt.claim.role', true), auth.jwt()->>'role', '');
    if v_claim_role <> 'service_role' and coalesce(v_claim_sub, '') <> p_user_id then
        raise exception 'not allowed';
    end if;

    perform public.ensure_user_account_preferences(p_user_id);

    update public.user_account_preferences
    set email_notifications_enabled = coalesce(p_email_notifications_enabled, email_notifications_enabled),
        deleted_at = case when p_delete_account then now() else deleted_at end,
        updated_at = now()
    where user_id = p_user_id
    returning * into v_row;

    return v_row;
end;
$$;

create or replace function public.fund_article_investigation(
    p_queue_id uuid,
    p_user_id text,
    p_is_starter boolean default false
)
returns public.article_investigation_funders
language plpgsql
security definer
set search_path = public
as $$
declare
    v_claim_sub text;
    v_claim_role text;
    v_row public.article_investigation_funders%rowtype;
begin
    v_claim_sub := auth.jwt()->>'sub';
    v_claim_role := coalesce(current_setting('request.jwt.claim.role', true), auth.jwt()->>'role', '');
    if v_claim_role <> 'service_role' and coalesce(v_claim_sub, '') <> p_user_id then
        raise exception 'not allowed';
    end if;

    if not public.is_site_feature_enabled('investigation_credits', false) then
        raise exception 'investigation credits feature is disabled';
    end if;

    insert into public.credit_accounts(user_id)
    values (p_user_id)
    on conflict (user_id) do update set updated_at = now();

    insert into public.article_investigation_funders(queue_id, user_id, status, is_starter)
    values (p_queue_id, p_user_id, 'funding', p_is_starter)
    on conflict (queue_id, user_id) do update
    set status = 'funding',
        is_starter = article_investigation_funders.is_starter or excluded.is_starter,
        updated_at = now()
    returning * into v_row;

    update public.article_queue
    set started_by_user_id = case when p_is_starter then p_user_id else started_by_user_id end,
        credit_feature_enabled = true,
        funding_status = 'funded',
        needs_funding_at = null,
        status = case when status = 'paused' then 'queued' else status end,
        remote_requested_at = case when status = 'paused' then null else remote_requested_at end
    where id = p_queue_id;

    return v_row;
end;
$$;

create or replace function public.opt_out_article_funding(p_queue_id uuid, p_user_id text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
    v_claim_sub text;
    v_claim_role text;
begin
    v_claim_sub := auth.jwt()->>'sub';
    v_claim_role := coalesce(current_setting('request.jwt.claim.role', true), auth.jwt()->>'role', '');
    if v_claim_role <> 'service_role' and coalesce(v_claim_sub, '') <> p_user_id then
        raise exception 'not allowed';
    end if;

    update public.article_investigation_funders
    set status = 'opted_out',
        updated_at = now()
    where queue_id = p_queue_id and user_id = p_user_id and is_starter = false;

    return found;
end;
$$;

create or replace function public.enqueue_funding_needed_notice(p_queue_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    v_queue public.article_queue%rowtype;
    v_preferences public.user_account_preferences%rowtype;
    v_notice_id uuid;
begin
    if coalesce(current_setting('request.jwt.claim.role', true), auth.jwt()->>'role', '') <> 'service_role' then
        raise exception 'not allowed';
    end if;

    select * into v_queue from public.article_queue where id = p_queue_id for update;
    if not found or coalesce(v_queue.started_by_user_id, '') = '' then
        return null;
    end if;

    insert into public.user_account_preferences(user_id)
    values (v_queue.started_by_user_id)
    on conflict (user_id) do update set updated_at = public.user_account_preferences.updated_at
    returning * into v_preferences;

    if v_preferences.email_notifications_enabled is false or v_preferences.deleted_at is not null then
        update public.article_queue
        set funding_notice_sent_at = coalesce(funding_notice_sent_at, now())
        where id = p_queue_id;

        insert into public.user_notification_outbox(user_id, notification_type, status, subject, body, metadata)
        values (
            v_queue.started_by_user_id,
            'funding_needed',
            'skipped',
            'Investigation needs funding',
            'Email notifications are disabled for this account.',
            jsonb_build_object('queue_id', p_queue_id, 'reason', 'notifications_disabled')
        )
        returning id into v_notice_id;
        return v_notice_id;
    end if;

    if v_queue.funding_notice_sent_at is not null then
        return null;
    end if;

    insert into public.user_notification_outbox(user_id, notification_type, subject, body, metadata)
    values (
        v_queue.started_by_user_id,
        'funding_needed',
        'Investigation needs funding',
        'An investigation you started is paused because it needs more credits before it can continue.',
        jsonb_build_object('queue_id', p_queue_id, 'queue_url', v_queue.url)
    )
    returning id into v_notice_id;

    update public.article_queue
    set funding_notice_sent_at = now()
    where id = p_queue_id;

    return v_notice_id;
end;
$$;

create or replace function public.enqueue_company_pair_funding_needed_notice(p_request_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    v_request public.company_pair_requests%rowtype;
    v_preferences public.user_account_preferences%rowtype;
    v_notice_id uuid;
begin
    if coalesce(current_setting('request.jwt.claim.role', true), auth.jwt()->>'role', '') <> 'service_role' then
        raise exception 'not allowed';
    end if;

    select * into v_request from public.company_pair_requests where id = p_request_id for update;
    if not found or coalesce(v_request.user_id, '') = '' then
        return null;
    end if;

    insert into public.user_account_preferences(user_id)
    values (v_request.user_id)
    on conflict (user_id) do update set updated_at = public.user_account_preferences.updated_at
    returning * into v_preferences;

    if v_preferences.email_notifications_enabled is false or v_preferences.deleted_at is not null then
        update public.company_pair_requests
        set funding_notice_sent_at = coalesce(funding_notice_sent_at, now())
        where id = p_request_id;

        insert into public.user_notification_outbox(user_id, notification_type, status, subject, body, metadata)
        values (
            v_request.user_id,
            'funding_needed',
            'skipped',
            'Company research needs funding',
            'Email notifications are disabled for this account.',
            jsonb_build_object('company_pair_request_id', p_request_id, 'reason', 'notifications_disabled')
        )
        returning id into v_notice_id;
        return v_notice_id;
    end if;

    if v_request.funding_notice_sent_at is not null then
        return null;
    end if;

    insert into public.user_notification_outbox(user_id, notification_type, subject, body, metadata)
    values (
        v_request.user_id,
        'funding_needed',
        'Company research needs funding',
        'A company-pair investigation you started is paused because it needs more credits before it can continue.',
        jsonb_build_object(
            'company_pair_request_id', p_request_id,
            'company_a_name', v_request.company_a_name,
            'company_b_name', v_request.company_b_name
        )
    )
    returning id into v_notice_id;

    update public.company_pair_requests
    set funding_notice_sent_at = now()
    where id = p_request_id;

    return v_notice_id;
end;
$$;

create or replace function public.fund_company_pair_investigation(
    p_request_id uuid,
    p_user_id text,
    p_is_starter boolean default false
)
returns public.company_pair_investigation_funders
language plpgsql
security definer
set search_path = public
as $$
declare
    v_claim_sub text;
    v_claim_role text;
    v_row public.company_pair_investigation_funders%rowtype;
begin
    v_claim_sub := auth.jwt()->>'sub';
    v_claim_role := coalesce(current_setting('request.jwt.claim.role', true), auth.jwt()->>'role', '');
    if v_claim_role <> 'service_role' and coalesce(v_claim_sub, '') <> p_user_id then
        raise exception 'not allowed';
    end if;

    if not public.is_site_feature_enabled('investigation_credits', false) then
        raise exception 'investigation credits feature is disabled';
    end if;

    insert into public.credit_accounts(user_id)
    values (p_user_id)
    on conflict (user_id) do update set updated_at = now();

    insert into public.company_pair_investigation_funders(request_id, user_id, status, is_starter)
    values (p_request_id, p_user_id, 'funding', p_is_starter)
    on conflict (request_id, user_id) do update
    set status = 'funding',
        is_starter = company_pair_investigation_funders.is_starter or excluded.is_starter,
        updated_at = now()
    returning * into v_row;

    update public.company_pair_requests
    set user_id = case when p_is_starter then p_user_id else user_id end,
        credit_feature_enabled = true,
        funding_status = 'funded',
        needs_funding_at = null,
        status = case when status = 'paused' then 'queued' else status end,
        remote_requested_at = case when status = 'paused' then null else remote_requested_at end
    where id = p_request_id;

    return v_row;
end;
$$;

create or replace function public.opt_out_company_pair_funding(p_request_id uuid, p_user_id text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
    v_claim_sub text;
    v_claim_role text;
begin
    v_claim_sub := auth.jwt()->>'sub';
    v_claim_role := coalesce(current_setting('request.jwt.claim.role', true), auth.jwt()->>'role', '');
    if v_claim_role <> 'service_role' and coalesce(v_claim_sub, '') <> p_user_id then
        raise exception 'not allowed';
    end if;

    update public.company_pair_investigation_funders
    set status = 'opted_out',
        updated_at = now()
    where request_id = p_request_id and user_id = p_user_id and is_starter = false;

    return found;
end;
$$;

create or replace function public.debit_article_flat_start_cost(p_queue_id uuid)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
    v_queue public.article_queue%rowtype;
    v_cost numeric(12, 6);
    v_balance numeric(12, 6);
begin
    if coalesce(current_setting('request.jwt.claim.role', true), auth.jwt()->>'role', '') <> 'service_role' then
        raise exception 'not allowed';
    end if;

    if not public.is_site_feature_enabled('investigation_credits', false) then
        return 0;
    end if;

    select * into v_queue from public.article_queue where id = p_queue_id for update;
    if not found or coalesce(v_queue.flat_start_cost_usd, 0) > 0 then
        return coalesce(v_queue.flat_start_cost_usd, 0);
    end if;

    if coalesce(v_queue.started_by_user_id, '') = '' then
        raise exception 'starter user is required';
    end if;

    v_cost := public.get_money_setting('investigation_start_flat_cost_usd', 0.05);
    if v_cost <= 0 then
        return 0;
    end if;

    select available_balance_usd into v_balance
    from public.get_credit_balance(v_queue.started_by_user_id);

    if coalesce(v_balance, 0) < v_cost then
        update public.article_queue
        set status = 'paused',
            funding_status = 'needs_funding',
            needs_funding_at = coalesce(needs_funding_at, now())
        where id = p_queue_id;
        perform public.enqueue_funding_needed_notice(p_queue_id);
        raise exception 'insufficient credits';
    end if;

    insert into public.credit_ledger(user_id, amount_usd, entry_type, metadata)
    values (
        v_queue.started_by_user_id,
        -v_cost,
        'debit',
        jsonb_build_object('queue_id', p_queue_id, 'reason', 'investigation_start_flat_cost')
    );

    update public.article_investigation_funders
    set contributed_usd = contributed_usd + v_cost,
        updated_at = now()
    where queue_id = p_queue_id and user_id = v_queue.started_by_user_id;

    update public.article_queue
    set flat_start_cost_usd = v_cost,
        funding_status = 'funded',
        needs_funding_at = null
    where id = p_queue_id;

    return v_cost;
end;
$$;

create or replace function public.debit_company_pair_flat_start_cost(p_request_id uuid)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
    v_request public.company_pair_requests%rowtype;
    v_cost numeric(12, 6);
    v_balance numeric(12, 6);
begin
    if coalesce(current_setting('request.jwt.claim.role', true), auth.jwt()->>'role', '') <> 'service_role' then
        raise exception 'not allowed';
    end if;

    if not public.is_site_feature_enabled('investigation_credits', false) then
        return 0;
    end if;

    select * into v_request from public.company_pair_requests where id = p_request_id for update;
    if not found or coalesce(v_request.flat_start_cost_usd, 0) > 0 then
        return coalesce(v_request.flat_start_cost_usd, 0);
    end if;

    if coalesce(v_request.user_id, '') = '' then
        raise exception 'starter user is required';
    end if;

    v_cost := public.get_money_setting('investigation_start_flat_cost_usd', 0.05);
    if v_cost <= 0 then
        return 0;
    end if;

    select available_balance_usd into v_balance
    from public.get_credit_balance(v_request.user_id);

    if coalesce(v_balance, 0) < v_cost then
        update public.company_pair_requests
        set status = 'paused',
            funding_status = 'needs_funding',
            needs_funding_at = coalesce(needs_funding_at, now())
        where id = p_request_id;
        perform public.enqueue_company_pair_funding_needed_notice(p_request_id);
        raise exception 'insufficient credits';
    end if;

    insert into public.credit_ledger(user_id, amount_usd, entry_type, metadata)
    values (
        v_request.user_id,
        -v_cost,
        'debit',
        jsonb_build_object('company_pair_request_id', p_request_id, 'reason', 'investigation_start_flat_cost')
    );

    update public.company_pair_investigation_funders
    set contributed_usd = contributed_usd + v_cost,
        updated_at = now()
    where request_id = p_request_id and user_id = v_request.user_id;

    update public.company_pair_requests
    set flat_start_cost_usd = v_cost,
        funding_status = 'funded',
        needs_funding_at = null
    where id = p_request_id;

    return v_cost;
end;
$$;

create or replace function public.apply_article_credit_usage(p_queue_id uuid)
returns table(ok boolean, paused boolean, debited_usd numeric, required_usd numeric, active_funders integer)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_queue public.article_queue%rowtype;
    v_total_cost numeric(12, 6);
    v_delta numeric(12, 6);
    v_share numeric(12, 6);
    v_funder record;
    v_balance numeric(12, 6);
    v_count integer;
begin
    if coalesce(current_setting('request.jwt.claim.role', true), auth.jwt()->>'role', '') <> 'service_role' then
        raise exception 'not allowed';
    end if;

    if not public.is_site_feature_enabled('investigation_credits', false) then
        ok := true; paused := false; debited_usd := 0; required_usd := 0; active_funders := 0;
        return next;
        return;
    end if;

    select * into v_queue from public.article_queue where id = p_queue_id for update;
    if not found or not coalesce(v_queue.credit_feature_enabled, false) then
        ok := true; paused := false; debited_usd := 0; required_usd := 0; active_funders := 0;
        return next;
        return;
    end if;

    select count(*) into v_count
    from public.article_investigation_funders
    where queue_id = p_queue_id and status = 'funding';

    v_total_cost := coalesce(v_queue.openrouter_cost, 0) + coalesce(v_queue.fly_io_investigation_cost, 0);
    v_delta := greatest(0, v_total_cost - coalesce(v_queue.credit_cost_debited_usd, 0));

    if v_delta <= 0 then
        ok := true; paused := false; debited_usd := 0; required_usd := 0; active_funders := v_count;
        return next;
        return;
    end if;

    if v_count <= 0 then
        update public.article_queue
        set status = 'paused',
            funding_status = 'needs_funding',
            needs_funding_at = coalesce(needs_funding_at, now())
        where id = p_queue_id;
        perform public.enqueue_funding_needed_notice(p_queue_id);
        ok := false; paused := true; debited_usd := 0; required_usd := v_delta; active_funders := 0;
        return next;
        return;
    end if;

    v_share := v_delta / v_count;

    for v_funder in
        select user_id
        from public.article_investigation_funders
        where queue_id = p_queue_id and status = 'funding'
        order by created_at asc
    loop
        select available_balance_usd into v_balance
        from public.get_credit_balance(v_funder.user_id);
        if coalesce(v_balance, 0) < v_share then
            update public.article_queue
            set status = 'paused',
                funding_status = 'needs_funding',
                needs_funding_at = coalesce(needs_funding_at, now())
            where id = p_queue_id;
            perform public.enqueue_funding_needed_notice(p_queue_id);
            ok := false; paused := true; debited_usd := 0; required_usd := v_delta; active_funders := v_count;
            return next;
            return;
        end if;
    end loop;

    for v_funder in
        select user_id
        from public.article_investigation_funders
        where queue_id = p_queue_id and status = 'funding'
        order by created_at asc
    loop
        insert into public.credit_ledger(user_id, amount_usd, entry_type, metadata)
        values (
            v_funder.user_id,
            -v_share,
            'debit',
            jsonb_build_object('queue_id', p_queue_id, 'reason', 'investigation_running_cost')
        );

        update public.article_investigation_funders
        set contributed_usd = contributed_usd + v_share,
            updated_at = now()
        where queue_id = p_queue_id and user_id = v_funder.user_id;
    end loop;

    update public.article_queue
    set credit_cost_debited_usd = coalesce(credit_cost_debited_usd, 0) + v_delta,
        funding_status = 'funded',
        needs_funding_at = null
    where id = p_queue_id;

    ok := true; paused := false; debited_usd := v_delta; required_usd := v_delta; active_funders := v_count;
    return next;
end;
$$;

create or replace function public.apply_company_pair_credit_usage(p_request_id uuid)
returns table(ok boolean, paused boolean, debited_usd numeric, required_usd numeric, active_funders integer)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_request public.company_pair_requests%rowtype;
    v_total_cost numeric(12, 6);
    v_delta numeric(12, 6);
    v_share numeric(12, 6);
    v_funder record;
    v_balance numeric(12, 6);
    v_count integer;
begin
    if coalesce(current_setting('request.jwt.claim.role', true), auth.jwt()->>'role', '') <> 'service_role' then
        raise exception 'not allowed';
    end if;

    if not public.is_site_feature_enabled('investigation_credits', false) then
        ok := true; paused := false; debited_usd := 0; required_usd := 0; active_funders := 0;
        return next;
        return;
    end if;

    select * into v_request from public.company_pair_requests where id = p_request_id for update;
    if not found or not coalesce(v_request.credit_feature_enabled, false) then
        ok := true; paused := false; debited_usd := 0; required_usd := 0; active_funders := 0;
        return next;
        return;
    end if;

    select count(*) into v_count
    from public.company_pair_investigation_funders
    where request_id = p_request_id and status = 'funding';

    v_total_cost := coalesce(v_request.openrouter_cost, 0) + coalesce(v_request.fly_io_investigation_cost, 0);
    v_delta := greatest(0, v_total_cost - coalesce(v_request.credit_cost_debited_usd, 0));

    if v_delta <= 0 then
        ok := true; paused := false; debited_usd := 0; required_usd := 0; active_funders := v_count;
        return next;
        return;
    end if;

    if v_count <= 0 then
        update public.company_pair_requests
        set status = 'paused',
            funding_status = 'needs_funding',
            needs_funding_at = coalesce(needs_funding_at, now())
        where id = p_request_id;
        perform public.enqueue_company_pair_funding_needed_notice(p_request_id);
        ok := false; paused := true; debited_usd := 0; required_usd := v_delta; active_funders := 0;
        return next;
        return;
    end if;

    v_share := v_delta / v_count;

    for v_funder in
        select user_id
        from public.company_pair_investigation_funders
        where request_id = p_request_id and status = 'funding'
        order by created_at asc
    loop
        select available_balance_usd into v_balance
        from public.get_credit_balance(v_funder.user_id);
        if coalesce(v_balance, 0) < v_share then
            update public.company_pair_requests
            set status = 'paused',
                funding_status = 'needs_funding',
                needs_funding_at = coalesce(needs_funding_at, now())
            where id = p_request_id;
            perform public.enqueue_company_pair_funding_needed_notice(p_request_id);
            ok := false; paused := true; debited_usd := 0; required_usd := v_delta; active_funders := v_count;
            return next;
            return;
        end if;
    end loop;

    for v_funder in
        select user_id
        from public.company_pair_investigation_funders
        where request_id = p_request_id and status = 'funding'
        order by created_at asc
    loop
        insert into public.credit_ledger(user_id, amount_usd, entry_type, metadata)
        values (
            v_funder.user_id,
            -v_share,
            'debit',
            jsonb_build_object('company_pair_request_id', p_request_id, 'reason', 'investigation_running_cost')
        );

        update public.company_pair_investigation_funders
        set contributed_usd = contributed_usd + v_share,
            updated_at = now()
        where request_id = p_request_id and user_id = v_funder.user_id;
    end loop;

    update public.company_pair_requests
    set credit_cost_debited_usd = coalesce(credit_cost_debited_usd, 0) + v_delta,
        funding_status = 'funded',
        needs_funding_at = null
    where id = p_request_id;

    ok := true; paused := false; debited_usd := v_delta; required_usd := v_delta; active_funders := v_count;
    return next;
end;
$$;

create or replace function public.apply_article_credit_usage_on_cost_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if public.is_site_feature_enabled('investigation_credits', false)
       and coalesce(new.credit_feature_enabled, false)
       and (
           coalesce(new.openrouter_cost, 0) <> coalesce(old.openrouter_cost, 0)
           or coalesce(new.fly_io_investigation_cost, 0) <> coalesce(old.fly_io_investigation_cost, 0)
       ) then
        perform public.apply_article_credit_usage(new.id);
    end if;
    return new;
end;
$$;

drop trigger if exists article_credit_usage_cost_update on public.article_queue;
create trigger article_credit_usage_cost_update
after update of openrouter_cost, fly_io_investigation_cost on public.article_queue
for each row
execute function public.apply_article_credit_usage_on_cost_update();

alter table public.site_feature_flags enable row level security;
alter table public.user_account_preferences enable row level security;
alter table public.article_investigation_funders enable row level security;
alter table public.company_pair_investigation_funders enable row level security;
alter table public.user_notification_outbox enable row level security;

drop policy if exists "feature flags public read" on public.site_feature_flags;
create policy "feature flags public read"
on public.site_feature_flags for select
using (true);

drop policy if exists "account preferences own read" on public.user_account_preferences;
create policy "account preferences own read"
on public.user_account_preferences for select
using ((auth.jwt()->>'sub') = user_id);

drop policy if exists "funders own read" on public.article_investigation_funders;
create policy "funders own read"
on public.article_investigation_funders for select
using ((auth.jwt()->>'sub') = user_id);

drop policy if exists "company pair funders own read" on public.company_pair_investigation_funders;
create policy "company pair funders own read"
on public.company_pair_investigation_funders for select
using ((auth.jwt()->>'sub') = user_id);

drop policy if exists "notification outbox own read" on public.user_notification_outbox;
create policy "notification outbox own read"
on public.user_notification_outbox for select
using ((auth.jwt()->>'sub') = user_id);

revoke execute on function public.is_site_feature_enabled(text, boolean) from public;
grant execute on function public.is_site_feature_enabled(text, boolean) to anon, authenticated, service_role;
revoke execute on function public.get_money_setting(text, numeric) from public;
grant execute on function public.get_money_setting(text, numeric) to service_role;
revoke execute on function public.ensure_user_account_preferences(text) from public;
grant execute on function public.ensure_user_account_preferences(text) to authenticated, service_role;
revoke execute on function public.update_user_account_preferences(text, boolean, boolean) from public;
grant execute on function public.update_user_account_preferences(text, boolean, boolean) to authenticated, service_role;
revoke execute on function public.fund_article_investigation(uuid, text, boolean) from public;
grant execute on function public.fund_article_investigation(uuid, text, boolean) to authenticated, service_role;
revoke execute on function public.opt_out_article_funding(uuid, text) from public;
grant execute on function public.opt_out_article_funding(uuid, text) to authenticated, service_role;
revoke execute on function public.enqueue_funding_needed_notice(uuid) from public;
grant execute on function public.enqueue_funding_needed_notice(uuid) to service_role;
revoke execute on function public.enqueue_company_pair_funding_needed_notice(uuid) from public;
grant execute on function public.enqueue_company_pair_funding_needed_notice(uuid) to service_role;
revoke execute on function public.fund_company_pair_investigation(uuid, text, boolean) from public;
grant execute on function public.fund_company_pair_investigation(uuid, text, boolean) to authenticated, service_role;
revoke execute on function public.opt_out_company_pair_funding(uuid, text) from public;
grant execute on function public.opt_out_company_pair_funding(uuid, text) to authenticated, service_role;
revoke execute on function public.debit_article_flat_start_cost(uuid) from public;
grant execute on function public.debit_article_flat_start_cost(uuid) to service_role;
revoke execute on function public.debit_company_pair_flat_start_cost(uuid) from public;
grant execute on function public.debit_company_pair_flat_start_cost(uuid) to service_role;
revoke execute on function public.apply_article_credit_usage(uuid) from public;
grant execute on function public.apply_article_credit_usage(uuid) to service_role;
revoke execute on function public.apply_company_pair_credit_usage(uuid) from public;
grant execute on function public.apply_company_pair_credit_usage(uuid) to service_role;
