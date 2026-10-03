-- OIS School Bell - 1-migratsiya: musiqa/ovozlar kutubxonasi
-- Nima yaratiladi:
--   1) "sounds" Storage bucket (yopiq, faqat login qilganlar kira oladi)
--   2) public.sounds jadvali (fayl haqida ma'lumot: nomi, turi, hajmi, ...)
--   3) RLS qoidalari: faqat app_metadata.role = 'admin' bo'lgan foydalanuvchi o'qiy/yoza oladi.
--      Bu rolni foydalanuvchining o'zi o'zgartira olmaydi (faqat server / dashboard beradi),
--      shuning uchun ro'yxatdan o'tish ochiq qolsa ham begona odam kutubxonaga kira olmaydi.
--      Maktab kompyuteridagi dastur service_role kalit bilan ishlaydi (RLS ni chetlab o'tadi).
--
-- Admin rolini berish (foydalanuvchi Authentication -> Users da yaratilgach):
--   update auth.users
--      set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}'::jsonb
--    where email = 'SIZNING@EMAILINGIZ';
-- (rol tokenga keyingi kirishda tushadi - chiqib qayta kiring)
-- Bu skriptni qayta ishga tushirish xavfsiz (idempotent).

-- ---------- Admin tekshiruvi ----------
create or replace function public.is_admin()
returns boolean
language sql
stable
as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false)
$$;

-- ---------- Storage bucket ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'sounds', 'sounds', false,
  52428800,  -- 50 MB
  array['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/wave']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "sounds_bucket_authenticated_all" on storage.objects;
drop policy if exists "sounds_bucket_admin_all" on storage.objects;
create policy "sounds_bucket_admin_all"
  on storage.objects
  for all
  to authenticated
  using (bucket_id = 'sounds' and public.is_admin())
  with check (bucket_id = 'sounds' and public.is_admin());

-- ---------- Jadval ----------
create table if not exists public.sounds (
  id               uuid primary key default gen_random_uuid(),
  name             text not null check (length(btrim(name)) between 1 and 200),
  kind             text not null default 'music'
                     check (kind in ('bell', 'music', 'announcement')),
  storage_path     text not null unique,          -- bucket ichidagi yo'l, masalan "2026/09/<uuid>.mp3"
  mime_type        text,
  size_bytes       bigint not null check (size_bytes > 0),
  duration_seconds numeric check (duration_seconds is null or duration_seconds >= 0),
  created_by       uuid references auth.users (id) on delete set null default auth.uid(),
  created_at       timestamptz not null default now()
);

create index if not exists sounds_kind_idx       on public.sounds (kind);
create index if not exists sounds_created_at_idx on public.sounds (created_at desc);

-- ---------- RLS ----------
alter table public.sounds enable row level security;

drop policy if exists "sounds_authenticated_all" on public.sounds;
drop policy if exists "sounds_admin_all" on public.sounds;
create policy "sounds_admin_all"
  on public.sounds
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Maktab kompyuteridagi dastur yangi fayllarni darrov bilib olishi uchun (Realtime)
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'sounds'
  ) then
    alter publication supabase_realtime add table public.sounds;
  end if;
end $$;
