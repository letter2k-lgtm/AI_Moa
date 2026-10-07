-- AI모아: 앱이 꺼져 있어도 가족 알림이 오게 (안드로이드 푸시)
-- Supabase > SQL Editor 에 전체를 붙여넣고 Run (여러 번 실행해도 안전, 기존 데이터는 그대로)
-- 폰마다 "알림 받을 주소(Expo 푸시 토큰)"를 저장한다. 서버 함수 notify-family 가 이 주소로 보낸다.

create table if not exists public.push_tokens (
  token text primary key,                                   -- ExponentPushToken[...]
  member_id uuid not null references public.members on delete cascade,
  family_id uuid not null references public.families on delete cascade,
  platform text not null default 'android',
  updated_at timestamptz not null default now()
);
create index if not exists push_tokens_family_idx on public.push_tokens (family_id);

alter table public.push_tokens enable row level security;

-- 앱(구성원)은 자기 폰 주소만 넣고 바꾸고 지울 수 있다. 읽기·발송은 서버 함수(관리자 권한)만.
drop policy if exists "push_tokens insert" on public.push_tokens;
create policy "push_tokens insert" on public.push_tokens
  for insert to authenticated with check (member_id = auth.uid() and family_id = public.my_family_id());

drop policy if exists "push_tokens update" on public.push_tokens;
create policy "push_tokens update" on public.push_tokens
  for update to authenticated using (member_id = auth.uid()) with check (member_id = auth.uid() and family_id = public.my_family_id());

drop policy if exists "push_tokens select own" on public.push_tokens;
create policy "push_tokens select own" on public.push_tokens
  for select to authenticated using (member_id = auth.uid());

drop policy if exists "push_tokens delete own" on public.push_tokens;
create policy "push_tokens delete own" on public.push_tokens
  for delete to authenticated using (member_id = auth.uid());

-- 폰을 이어받기(reclaim_member)로 옮기면 예전 구성원의 주소는 members 삭제와 함께 지워진다 (on delete cascade)
