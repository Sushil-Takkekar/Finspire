-- Run this once in the Supabase SQL Editor before deploying password recovery.
alter table public.users add column if not exists email text;
update public.users
set email = 'sushycom@gmail.com'
where email is null or btrim(email) = '';
