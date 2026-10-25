-- Run this in Supabase SQL Editor before starting Finspire.
create table if not exists public.users (
  id uuid primary key,
  username text not null unique,
  salt text not null,
  hash text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.user_data (
  user_id uuid primary key references public.users(id) on delete cascade,
  portfolios jsonb not null default '[]'::jsonb,
  insurance jsonb not null default '[]'::jsonb,
  loans jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

-- The app accesses these tables only from its Node server with the service role key.
alter table public.users enable row level security;
alter table public.user_data enable row level security;
revoke all on public.users from anon, authenticated;
revoke all on public.user_data from anon, authenticated;
grant all on public.users to service_role;
grant all on public.user_data to service_role;
