-- ※ 이미 실행한 파일이에요. 다시 실행하면 가족 카드가 모두 지워져요!
--   시연 데이터 내용은 demo_update.sql 이 최신 (배변패드 지연 + 커피믹스 재구매 2가지, 삭제 18:00)
-- AI모아 발표 시연 데이터 예약 (10/17 14:00~17:00)
--
-- 사용법: 맨 아래 세 군데의 'MOA-XXXX' 를 우리 가족 초대 코드로 바꾸고
--         Supabase > SQL Editor 에 전체를 붙여넣고 Run (한 번만)
--
-- 하는 일
--   1) 지금: 우리 가족의 카드를 모두 지운다 (가족·구성원은 그대로) → 이제부터 실제로 사용
--   2) 10/17 13:50: 시연 예시 데이터 13건이 나타난다 (그때까지 가족이 등록한 카드는 그대로)
--   3) 10/17 17:00: 시연 예시 데이터만 사라진다
--
-- 시연 예시 (우리 가족이 실제로 살 물건과 겹치지 않게 반려동물·캠핑·커피 위주)
--   [재구매 알림]  커피캡슐: 60일 전, 30일 전 구매 → "커피 살 때 됐어요 · 30일마다"
--                  고양이 모래: 50일 전, 24일 전 구매 → "2일 후"
--   [중복 확인]    건전지: 3일 전 구매 → "건전지" 입력 시 "3일 전에 샀어요. 또 살까요?"
--   [하루 지연]    배변패드(요청 2일째 담당 없음), 올리브유(구매 예정 30시간째),
--                  키보드(주문 후 하루 넘음), 부탄가스(배송중 하루 넘음)
--   [새 요청]      고양이 간식 츄르 (방금 요청)
--   [이력]         바디워시, A4 복사용지, 수세미 + 위 물건들의 지난 구매
--   [보관 장소]    주방 식탁 위, 베란다, 거실, 욕실 선반, 작은방 책상 위
--   날짜는 실제처럼: 요청·담당·주문은 같은 날 → 배송 시작 1일 뒤 → 받음 2~3일 뒤

create extension if not exists pg_cron with schema pg_catalog;

-- 예전 테스트용 예약과 함수 정리
select cron.unschedule(jobid) from cron.job where jobname in ('aimoa-demo-refresh', 'aimoa-demo-on', 'aimoa-demo-off');
drop function if exists public.seed_test_data(text, boolean);

-- p_mode: 'wipe_all' 가족 카드 전부 삭제 / 'insert' 시연 데이터 넣기 / 'remove' 시연 데이터만 삭제
create or replace function public.seed_demo(p_code text, p_mode text)
returns text
language plpgsql
set search_path = public
as $$
declare
  v_mark text := chr(8203);  -- 시연 카드 표시: 이름 끝의 보이지 않는 문자 (화면에는 안 보임)
  fam uuid;
  m uuid[];
  n int;
  r record;
  new_id uuid;
  a uuid;
  b uuid;
  t timestamptz;   -- 지금 단계가 된 시각 (받은 카드는 주문 시각)
begin
  select id into fam from public.families where invite_code = upper(trim(p_code));
  if fam is null then raise exception '초대 코드 %인 가족이 없어요', p_code; end if;
  select array_agg(id order by created_at) into m from public.members where family_id = fam;
  n := array_length(m, 1);

  if p_mode = 'wipe_all' then
    delete from public.items where family_id = fam;
    return '가족 카드를 모두 지웠어요';
  end if;

  delete from public.items where family_id = fam and right(name, 1) = v_mark;
  if p_mode = 'remove' then
    return '시연 데이터를 지웠어요';
  end if;

  -- 이름, 카테고리, 단계, 구매처, 금액, 며칠 전(받은 카드는 주문일), 요청자, 구매자, 수령 장소, 주문 후 며칠 뒤 받음
  for r in
    select * from (values
      ('반려견 배변패드 100매',     '생활용품', 'needed',   null,     null,  2.0,  1, 1, null,         0),
      ('고양이 간식 츄르 20개',     '식품',     'needed',   null,     null,  0.05, 2, 1, null,         0),
      ('올리브유 1L',               '식품',     'claimed',  null,     null,  0.15, 2, 1, null,         0),
      ('블루투스 키보드',           '기타',     'ordered',  '쿠팡',   29900, 0.2,  1, 2, null,         0),
      ('캠핑용 부탄가스 4개',       '생활용품', 'shipping', '네이버',  6900, 1.1,  2, 2, null,         0),
      ('네스프레소 커피캡슐 50개',  '식품',     'received', '쿠팡',   37000, 60,   1, 1, '주방 식탁 위',    2),
      ('네스프레소 커피캡슐 50개',  '식품',     'received', '네이버', 35500, 32,   1, 2, '주방 식탁 위',    2),
      ('고양이 모래 10L',           '생활용품', 'received', '쿠팡',   12900, 50,   2, 1, '베란다',          2),
      ('고양이 모래 10L',           '생활용품', 'received', '쿠팡',   12900, 12,   2, 1, '베란다',          2),
      ('건전지 AA 20개',            '생활용품', 'received', '다이소',  5000, 3,    1, 2, '거실',            2),
      ('바디워시 900ml',            '생활용품', 'received', '이마트',  9900, 12,   2, 2, '욕실 선반',       3),
      ('A4 복사용지 500매',         '학용품',   'received', '쿠팡',    5900, 20,   1, 1, '작은방 책상 위',  2),
      ('주방 수세미 10개',          '생활용품', 'received', '다이소',  2000, 40,   2, 2, '주방 식탁 위',    2)
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

    -- 진행 기록: 요청 → 담당 → 주문(같은 날) → 배송 시작(1일 뒤) → 받음(2~3일 뒤)
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

  return format('시연 데이터 13건 완료 (구성원 %s명, 기준 %s)', n, to_char(now() at time zone 'Asia/Seoul', 'MM/DD HH24:MI'));
end $$;

-- 앱(일반 사용자)에서는 이 함수를 부를 수 없게 막는다
revoke all on function public.seed_demo(text, text) from public, anon, authenticated;

-- 1) 지금: 가족 카드 모두 지우기 (실제 사용 시작)
select public.seed_demo('MOA-XXXX', 'wipe_all');   -- ← 초대 코드

-- 2) 10/17 13:50 (한국) = 04:50 UTC: 시연 데이터 넣기
select cron.schedule(
  'aimoa-demo-on', '50 4 17 10 *',
  $job$ select public.seed_demo('MOA-XXXX', 'insert'); select cron.unschedule('aimoa-demo-on'); $job$   -- ← 초대 코드
);

-- 3) 10/17 17:00 (한국) = 08:00 UTC: 시연 데이터만 지우기
select cron.schedule(
  'aimoa-demo-off', '0 8 17 10 *',
  $job$ select public.seed_demo('MOA-XXXX', 'remove'); select cron.unschedule('aimoa-demo-off'); $job$   -- ← 초대 코드
);
