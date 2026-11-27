create table public.wb_supply_daily_numbers (
  client_id text not null,
  supply_date date not null,
  last_number integer not null check (last_number > 0),
  primary key (client_id, supply_date)
);

alter table public.wb_supply_daily_numbers enable row level security;
revoke all on table public.wb_supply_daily_numbers from public, anon, authenticated;
grant select, insert, update on public.wb_supply_daily_numbers to service_role;

create function public.next_wb_supply_name(p_client_id text)
returns text
language sql volatile
set search_path = ''
as $$
  with next_number as (
    insert into public.wb_supply_daily_numbers as daily (client_id, supply_date, last_number)
    values (p_client_id, (statement_timestamp() at time zone 'Europe/Moscow')::date, 1)
    on conflict (client_id, supply_date) do update
      set last_number = daily.last_number + 1
    returning supply_date, last_number
  )
  select 'Телепак - ' || to_char(supply_date, 'DD.MM.YYYY') || ' - ' || last_number
  from next_number;
$$;

revoke all on function public.next_wb_supply_name(text) from public, anon, authenticated;
grant execute on function public.next_wb_supply_name(text) to service_role;
