-- Linceo · setup Supabase. Incolla tutto in: Supabase > SQL Editor > New query > Run.

-- 1) Iscritti: una riga per ogni account (riempita in automatico alla registrazione)
create table if not exists public.subscribers (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  consent boolean not null default false,
  created_at timestamptz not null default now()
);

-- 2) Eventi salvati (cuore) per ogni utente
create table if not exists public.saved (
  user_id uuid not null references auth.users(id) on delete cascade,
  key text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, key)
);

-- 3) Feedback dal footer
create table if not exists public.feedback (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  email text,
  message text not null check (char_length(message) between 1 and 1000),
  created_at timestamptz not null default now()
);

-- 4) Amministratori (vedi punto finale)
create table if not exists public.admins (id uuid primary key references auth.users(id) on delete cascade);

alter table public.subscribers enable row level security;
alter table public.saved enable row level security;
alter table public.feedback enable row level security;
alter table public.admins enable row level security;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from public.admins where id = auth.uid()) $$;

drop policy if exists "subscribers: leggi il tuo (o tutti se admin)" on public.subscribers;
create policy "subscribers: leggi il tuo (o tutti se admin)" on public.subscribers
  for select to authenticated using (id = auth.uid() or public.is_admin());

drop policy if exists "saved: solo i tuoi" on public.saved;
create policy "saved: solo i tuoi" on public.saved
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "feedback: tutti possono scrivere" on public.feedback;
create policy "feedback: tutti possono scrivere" on public.feedback
  for insert to anon, authenticated with check (user_id is null or user_id = auth.uid());

drop policy if exists "feedback: legge solo l'admin" on public.feedback;
create policy "feedback: legge solo l'admin" on public.feedback
  for select to authenticated using (public.is_admin());

-- Alla registrazione copia la mail (e il consenso) nella tabella iscritti
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.subscribers (id, email, consent)
  values (new.id, new.email, coalesce((new.raw_user_meta_data->>'consent')::boolean, false))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Iscritti già presenti prima di questo script
insert into public.subscribers (id, email)
select id, email from auth.users on conflict (id) do nothing;

-- 5) DA ESEGUIRE DOPO che ti sei registrata nell'app con questa mail:
insert into public.admins (id)
select id from auth.users where email = 'alessialucentini777@gmail.com'
on conflict do nothing;
