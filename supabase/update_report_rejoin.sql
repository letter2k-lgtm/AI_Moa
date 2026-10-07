-- AI모아 업데이트: ① 폰이 바뀌어도 기존 구성원으로 다시 참여  ④ 효과 리포트(중복 구매 막은 기록)
-- Supabase > SQL Editor 에 전체를 붙여넣고 Run (한 번만, 초대 코드 바꿀 필요 없음)
-- 기존 가족 데이터와 10/17 시연 예약은 그대로 둔다.

-- ============================================================
-- ④ 중복 구매를 막은 기록 (확인창에서 "취소"를 누른 경우)
-- ============================================================
create table if not exists public.prevented (
  id bigint generated always as identity primary key,
  family_id uuid not null references public.families on delete cascade,
  member_id uuid references public.members on delete set null,
  name text not null,
  price integer,               -- 그 물건의 최근 구매 가격 (아낀 금액 추정용)
  created_at timestamptz not null default now()
);
create index if not exists prevented_family_idx on public.prevented (family_id, created_at);

alter table public.prevented enable row level security;

drop policy if exists "prevented read" on public.prevented;
create policy "prevented read" on public.prevented
  for select to authenticated using (family_id = public.my_family_id());

drop policy if exists "prevented insert" on public.prevented;
create policy "prevented insert" on public.prevented
  for insert to authenticated with check (family_id = public.my_family_id() and member_id = auth.uid());

-- ============================================================
-- ① 폰을 바꾸거나 앱 데이터가 지워졌을 때: 같은 이름의 기존 구성원을 이 폰으로 이어받기
--    (기존 구성원의 요청·구매·수령 기록을 모두 새 폰으로 옮긴다)
-- ============================================================
create or replace function public.reclaim_member(p_code text, p_member_name text)
returns public.families
language plpgsql security definer set search_path = public
as $$
declare
  fam public.families;
  prev public.members;
  me uuid := auth.uid();
begin
  if me is null then raise exception '로그인이 필요해요'; end if;
  select * into fam from public.families where invite_code = upper(trim(p_code));
  if fam.id is null then raise exception '초대 코드를 찾을 수 없어요'; end if;
  select * into prev from public.members where family_id = fam.id and name = trim(p_member_name);
  if prev.id is null then raise exception '"%"(이)라는 구성원이 없어요', trim(p_member_name); end if;
  if prev.id = me then return fam; end if;

  -- 이 폰을 잠시 다른 이름으로 가족에 넣고 (같은 이름 금지 규칙 때문에)
  insert into public.members (id, family_id, name, role)
    values (me, fam.id, '이어받는 중 ' || left(me::text, 8), prev.role)
    on conflict (id) do update set family_id = excluded.family_id, name = excluded.name, role = excluded.role;

  -- 기존 기록을 모두 이 폰으로 옮기고
  update public.items set requested_by = me where requested_by = prev.id;
  update public.items set assignee = me where assignee = prev.id;
  update public.items set received_by = me where received_by = prev.id;
  update public.item_events set actor = me where actor = prev.id;
  update public.prevented set member_id = me where member_id = prev.id;

  -- 예전 구성원을 지운 뒤 원래 이름으로 바꾼다
  delete from public.members where id = prev.id;
  update public.members set name = prev.name where id = me;
  return fam;
end $$;

revoke execute on function public.reclaim_member(text, text) from public, anon;
grant execute on function public.reclaim_member(text, text) to authenticated;

-- ============================================================
-- 10/17 시연 데이터: 효과 리포트에 숫자가 보이도록 "중복 구매 막은 기록" 3건 추가
-- (예약은 그대로, 함수 내용만 바꾼다)
-- ※ 예전 내용이에요. 시연 데이터는 demo_update.sql 이 최신이니, 이 파일을 다시 실행했다면 demo_update.sql 도 다시 실행하세요.
-- ============================================================
create or replace function public.seed_demo(p_code text, p_mode text)
returns text
language plpgsql
set search_path = public
as $$
declare
  v_mark text := chr(8203);  -- 시연 데이터 표시: 이름 끝의 보이지 않는 문자 (화면에는 안 보임)
  fam uuid;
  m uuid[];
  n int;
  r record;
  new_id uuid;
  a uuid;
  b uuid;
  t timestamptz;
begin
  select id into fam from public.families where invite_code = upper(trim(p_code));
  if fam is null then raise exception '초대 코드 %인 가족이 없어요', p_code; end if;
  select array_agg(id order by created_at) into m from public.members where family_id = fam;
  n := array_length(m, 1);

  if p_mode = 'wipe_all' then
    delete from public.items where family_id = fam;
    delete from public.prevented where family_id = fam;
    return '가족 카드를 모두 지웠어요';
  end if;

  delete from public.items where family_id = fam and right(name, 1) = v_mark;
  delete from public.prevented where family_id = fam and right(name, 1) = v_mark;
  if p_mode = 'remove' then
    return '시연 데이터를 지웠어요';
  end if;

  -- 이름, 카테고리, 단계, 구매처, 금액, 며칠 전(받은 카드는 주문일), 요청자, 구매자, 수령 장소, 주문 후 며칠 뒤 받음
  for r in
    select * from (values
      ('반려견 배변패드 100매',     '생활용품', 'needed',   null,     null,  2.0,  1, 1, null,             0),
      ('고양이 간식 츄르 20개',     '식품',     'needed',   null,     null,  0.05, 2, 1, null,             0),
      ('올리브유 1L',               '식품',     'claimed',  null,     null,  0.15, 2, 1, null,             0),
      ('블루투스 키보드',           '기타',     'ordered',  '쿠팡',   29900, 0.2,  1, 2, null,             0),
      ('캠핑용 부탄가스 4개',       '생활용품', 'shipping', '네이버',  6900, 1.1,  2, 2, null,             0),
      ('네스프레소 커피캡슐 50개',  '식품',     'received', '쿠팡',   37000, 60,   1, 1, '주방 식탁 위',   2),
      ('네스프레소 커피캡슐 50개',  '식품',     'received', '네이버', 35500, 32,   1, 2, '주방 식탁 위',   2),
      ('고양이 모래 10L',           '생활용품', 'received', '쿠팡',   12900, 50,   2, 1, '베란다',         2),
      ('고양이 모래 10L',           '생활용품', 'received', '쿠팡',   12900, 12,   2, 1, '베란다',         2),
      ('건전지 AA 20개',            '생활용품', 'received', '다이소',  5000, 3,    1, 2, '거실',           2),
      ('바디워시 900ml',            '생활용품', 'received', '이마트',  9900, 12,   2, 2, '욕실 선반',      3),
      ('A4 복사용지 500매',         '학용품',   'received', '쿠팡',    5900, 20,   1, 1, '작은방 책상 위', 2),
      ('주방 수세미 10개',          '생활용품', 'received', '다이소',  2000, 40,   2, 2, '주방 식탁 위',   2)
    ) as v(name, category, status, store, price, days_ago, req, buy, place, recv_after)
  loop
    a := m[least(r.req, n)];
    b := m[least(r.buy, n)];
    t := now() - make_interval(secs => (r.days_ago * 86400)::int);

    insert into public.items (
      family_id, name, quantity, category, status, requested_by, assignee, store, price,
      received_by, received_note, ordered_at, created_at
    ) values (
      fam, r.name || v_mark, '1개', r.category, r.status, a,
      case when r.status = 'needed' then null else b end,
      r.store, r.price,
      case when r.status = 'received' then b end,
      r.place,
      case when r.status in ('ordered', 'shipping', 'received') then t end,
      case
        when r.status = 'needed' then t
        when r.status = 'claimed' then t - interval '3 hours'
        else t - interval '2 hours'
      end
    ) returning id into new_id;

    if r.status = 'needed' then
      insert into public.item_events (item_id, family_id, status, actor, created_at) values (new_id, fam, 'needed', a, t);
    elsif r.status = 'claimed' then
      insert into public.item_events (item_id, family_id, status, actor, created_at) values
        (new_id, fam, 'needed', a, t - interval '3 hours'),
        (new_id, fam, 'claimed', b, t);
    else
      insert into public.item_events (item_id, family_id, status, actor, note, created_at) values
        (new_id, fam, 'needed', a, null, t - interval '2 hours'),
        (new_id, fam, 'claimed', b, null, t - interval '1 hour'),
        (new_id, fam, 'ordered', b, r.store || ' · ' || to_char(r.price, 'FM999,999') || '원', t);
      if r.status in ('shipping', 'received') then
        insert into public.item_events (item_id, family_id, status, actor, created_at)
          values (new_id, fam, 'shipping', b, t + interval '1 day');
      end if;
      if r.status = 'received' then
        insert into public.item_events (item_id, family_id, status, actor, note, created_at)
          values (new_id, fam, 'received', b, r.place, t + make_interval(days => r.recv_after));
      end if;
    end if;
  end loop;

  -- 이번 달 중복 구매를 막은 기록 (효과 리포트용)
  insert into public.prevented (family_id, member_id, name, price, created_at) values
    (fam, m[least(2, n)], '건전지 AA 20개' || v_mark, 5000, now() - interval '2 days'),
    (fam, m[1], '네스프레소 커피캡슐 50개' || v_mark, 35500, now() - interval '6 days'),
    (fam, m[least(2, n)], '고양이 모래 10L' || v_mark, 12900, now() - interval '9 days');

  return format('시연 데이터 완료 (구성원 %s명, 기준 %s)', n, to_char(now() at time zone 'Asia/Seoul', 'MM/DD HH24:MI'));
end $$;

revoke all on function public.seed_demo(text, text) from public, anon, authenticated;
