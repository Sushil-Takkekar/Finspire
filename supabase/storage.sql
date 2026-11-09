-- Run once in the Supabase SQL Editor to enable private insurance policy PDFs.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'insurance-policies',
  'insurance-policies',
  false,
  10485760,
  array['application/pdf']::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- The app accesses this private bucket only through its authenticated Node server
-- using the Supabase service role key. Do not add public read access policies.
