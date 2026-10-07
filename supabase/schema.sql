-- AI모아 데이터베이스 설정
-- Supabase 대시보드 > SQL Editor 에 이 파일 전체를 붙여넣고 Run 한 번이면 끝.
-- 여러 번 실행해도 안전하도록 작성됨.

-- 1. 테이블 -------------------------------------------------------------

create table if not exists public.families (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  invite_code text not null unique,
  created_at timestamptz not null default now()
);

-- 구성원 id = 로그인한 사용자 id (기기마다 익명 로그인)
create table if not exists public.members (
  id uuid primary key references auth.users on delete cascade,
  family_id uuid not null references public.families on delete cascade,
  name text not null,
  role text not null default '구성원',
  created_at timestamptz not null default now()
);

create table if not exists public.items (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families on delete cascade,
  name text not null,
  quantity text not null default '1개',
  urgent boolean not null default false,
  category text,
  status text not null default 'needed'
    check (status in ('needed', 'claimed', 'ordered', 'shipping', 'received')),
  requested_by uuid references public.members on delete set null,
  assignee uuid references public.members on delete set null,
  store text,
  price integer,
  link text,
  eta text,
  received_by uuid references public.members on delete set null,
  received_note text,
  ordered_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.item_events (
  id bigint generated always as identity primary key,
  item_id uuid not null references public.items on delete cascade,
  family_id uuid not null references public.families on delete cascade,
  status text not null,
  actor uuid references public.members on delete set null,
  note text,
  created_at timestamptz not null default now()
);

create unique index if not exists members_family_name_unique on public.members (family_id, name);
create index if not exists items_family_idx on public.items (family_id, created_at desc);
create index if not exists item_events_family_idx on public.item_events (family_id, created_at);

-- 2. 보안 규칙: 우리 가족 데이터만 보고 쓸 수 있음 ---------------------------

create or replace function public.my_family_id()
returns uuid
language sql stable security definer set search_path = public
as $$ select family_id from public.members where id = auth.uid() $$;

alter table public.families enable row level security;
alter table public.members enable row level security;
alter table public.items enable row level security;
alter table public.item_events enable row level security;

drop policy if exists "family read" on public.families;
create policy "family read" on public.families
  for select to authenticated using (id = public.my_family_id());

drop policy if exists "members read" on public.members;
create policy "members read" on public.members
  for select to authenticated using (family_id = public.my_family_id());

drop policy if exists "members update self" on public.members;
create policy "members update self" on public.members
  for update to authenticated using (id = auth.uid()) with check (family_id = public.my_family_id());

drop policy if exists "items all" on public.items;
create policy "items all" on public.items
  for all to authenticated
  using (family_id = public.my_family_id())
  with check (family_id = public.my_family_id());

drop policy if exists "events read" on public.item_events;
create policy "events read" on public.item_events
  for select to authenticated using (family_id = public.my_family_id());

drop policy if exists "events insert" on public.item_events;
create policy "events insert" on public.item_events
  for insert to authenticated with check (family_id = public.my_family_id() and actor = auth.uid());

-- 3. 가족 만들기 / 초대 코드로 참여 ---------------------------------------

create or replace function public.create_family(p_family_name text, p_member_name text)
returns public.families
language plpgsql security definer set search_path = public
as $$
declare
  fam public.families;
  code text;
begin
  if auth.uid() is null then raise exception '로그인이 필요해요'; end if;
  loop
    code := 'MOA-' || upper(substr(md5(random()::text), 1, 4));
    exit when not exists (select 1 from public.families where invite_code = code);
  end loop;
  insert into public.families (name, invite_code) values (trim(p_family_name), code) returning * into fam;
  insert into public.members (id, family_id, name, role) values (auth.uid(), fam.id, trim(p_member_name), '리더')
    on conflict (id) do update set family_id = excluded.family_id, name = excluded.name, role = excluded.role;
  return fam;
end $$;

create or replace function public.join_family(p_code text, p_member_name text)
returns public.families
language plpgsql security definer set search_path = public
as $$
declare
  fam public.families;
begin
  if auth.uid() is null then raise exception '로그인이 필요해요'; end if;
  select * into fam from public.families where invite_code = upper(trim(p_code));
  if fam.id is null then raise exception '초대 코드를 찾을 수 없어요'; end if;
  if exists (
    select 1 from public.members
    where family_id = fam.id and name = trim(p_member_name) and id <> auth.uid()
  ) then
    raise exception '이미 "%"(이)라는 구성원이 있어요. 다른 이름으로 참여해 주세요 (예: %2, 첫째)', trim(p_member_name), trim(p_member_name);
  end if;
  insert into public.members (id, family_id, name) values (auth.uid(), fam.id, trim(p_member_name))
    on conflict (id) do update set family_id = excluded.family_id, name = excluded.name, role = '구성원';
  return fam;
end $$;

revoke execute on function public.create_family(text, text) from public, anon;
revoke execute on function public.join_family(text, text) from public, anon;
grant execute on function public.create_family(text, text) to authenticated;
grant execute on function public.join_family(text, text) to authenticated;

-- 4. 실시간 공유 켜기 ------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['items', 'item_events', 'members'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
