-- AI모아: 재구매 알림 "아직 남았어요(미루기)" / "이제 안 사요(그만 받기)" 저장
-- Supabase > SQL Editor 에 전체를 붙여넣고 Run (여러 번 실행해도 안전, 기존 데이터는 그대로)
-- 가족 모두에게 같이 적용된다 (한 사람이 미루면 가족 폰 모두 알림이 미뤄진다)

create table if not exists public.restock_prefs (
  family_id uuid not null references public.families on delete cascade,
  key text not null,                 -- 물건 대표 이름 (예: 생수, 국어노트)
  snooze_until timestamptz,          -- 이 날까지 알림 미루기
  snoozed_at timestamptz,            -- 미룬 시각 (그 뒤에 새로 사면 미루기는 저절로 끝남)
  stopped boolean not null default false, -- 이제 안 사요
  updated_by uuid references public.members on delete set null,
  updated_at timestamptz not null default now(),
  primary key (family_id, key)
);

alter table public.restock_prefs enable row level security;

drop policy if exists "restock_prefs read" on public.restock_prefs;
create policy "restock_prefs read" on public.restock_prefs
  for select to authenticated using (family_id = public.my_family_id());

drop policy if exists "restock_prefs write" on public.restock_prefs;
create policy "restock_prefs write" on public.restock_prefs
  for insert to authenticated with check (family_id = public.my_family_id());

drop policy if exists "restock_prefs update" on public.restock_prefs;
create policy "restock_prefs update" on public.restock_prefs
  for update to authenticated using (family_id = public.my_family_id()) with check (family_id = public.my_family_id());

drop policy if exists "restock_prefs delete" on public.restock_prefs;
create policy "restock_prefs delete" on public.restock_prefs
  for delete to authenticated using (family_id = public.my_family_id());

-- 다른 가족이 바꾸면 바로 반영 (이미 들어 있으면 건너뜀)
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'restock_prefs') then
    alter publication supabase_realtime add table public.restock_prefs;
  end if;
end $$;
