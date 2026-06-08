create or replace function public.settle_credit_purchase(
    p_stripe_session_id text,
    p_user_id text,
    p_credits_usd numeric,
    p_metadata jsonb default '{}'::jsonb
)
returns table(
    settled_stripe_session_id text,
    settlement_status text,
    total_balance_usd numeric,
    reserved_usd numeric,
    available_balance_usd numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_existing public.stripe_checkout_sessions%rowtype;
    v_balance record;
    v_claim_role text;
begin
    v_claim_role := coalesce(current_setting('request.jwt.claim.role', true), auth.jwt()->>'role', '');
    if v_claim_role <> 'service_role' then
        raise exception 'not allowed';
    end if;

    if coalesce(trim(p_stripe_session_id), '') = '' then
        raise exception 'stripe session id is required';
    end if;

    if coalesce(trim(p_user_id), '') = '' then
        raise exception 'user id is required';
    end if;

    if p_credits_usd <= 0 then
        raise exception 'credit amount must be positive';
    end if;

    perform pg_advisory_xact_lock(hashtext(p_stripe_session_id));

    select *
    into v_existing
    from public.stripe_checkout_sessions
    where stripe_checkout_sessions.stripe_session_id = p_stripe_session_id
    for update;

    if found and v_existing.user_id <> p_user_id then
        raise exception 'stripe session belongs to a different user';
    end if;

    insert into public.credit_accounts(user_id)
    values (p_user_id)
    on conflict (user_id) do update set updated_at = now();

    insert into public.stripe_checkout_sessions(
        user_id,
        stripe_session_id,
        amount_usd,
        credits_usd,
        status,
        metadata,
        updated_at
    )
    values (
        p_user_id,
        p_stripe_session_id,
        p_credits_usd,
        p_credits_usd,
        'paid',
        coalesce(p_metadata, '{}'::jsonb),
        now()
    )
    on conflict (stripe_session_id) do update
    set status = 'paid',
        credits_usd = excluded.credits_usd,
        metadata = coalesce(stripe_checkout_sessions.metadata, '{}'::jsonb) || excluded.metadata,
        updated_at = now();

    insert into public.credit_ledger(user_id, amount_usd, entry_type, stripe_session_id, metadata)
    values (p_user_id, p_credits_usd, 'purchase', p_stripe_session_id, coalesce(p_metadata, '{}'::jsonb))
    on conflict do nothing;

    select *
    into v_balance
    from public.get_credit_balance(p_user_id);

    settled_stripe_session_id := p_stripe_session_id;
    settlement_status := 'paid';
    total_balance_usd := v_balance.total_balance_usd;
    reserved_usd := v_balance.reserved_usd;
    available_balance_usd := v_balance.available_balance_usd;
    return next;
end;
$$;

revoke execute on function public.settle_credit_purchase(text, text, numeric, jsonb) from public;
grant execute on function public.settle_credit_purchase(text, text, numeric, jsonb) to service_role;
