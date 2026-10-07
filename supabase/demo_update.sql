-- AI모아 시연 데이터를 2가지만 남기기 (10/17 14:00~17:00 발표용)
-- Supabase > SQL Editor 에 전체를 붙여넣고 Run (초대 코드 바꿀 필요 없음, 여러 번 실행해도 안전)
--
-- 시연 때 보이는 것 (딱 2개):
--   ① 하루 지연: 반려견 배변패드 — 이틀째 아무도 안 맡은 요청
--   ② 재구매: 커피믹스 — 평균 28일마다 샀는데 마지막으로 받은 지 30일 → "커피믹스 살 때 됐어요"
--      (주기를 계산하려면 지난 구매 2건이 필요해서, 이력에는 커피믹스 지난 구매 2건이 함께 보인다. 둘 다 9월이라 10월 보드에는 안 나온다)
-- 중복 구매는 시연 중 실제로 있는 물건을 다시 요청해서 보여 준다.
--
-- 하는 일
--   1) 지금 남아 있는 시연 데이터(리허설 등)를 모두 지운다. 가족이 직접 등록한 카드는 그대로.
--   2) 시연 데이터 내용을 위 2가지로 바꾼다. 10/17 13:50 예약이 이 내용으로 넣는다.
--   3) 시연 데이터 삭제 예약을 17:00 → 18:00으로 늦춘다 (질의응답이 길어져도 안전하게)

-- 1) 남아 있는 시연 데이터 지우기 (이름 끝에 보이지 않는 표시 문자가 붙은 것만)
delete from public.items where right(name, 1) = chr(8203);
delete from public.prevented where right(name, 1) = chr(8203);

-- 2) 시연 데이터 내용
-- p_mode: 'wipe_all' 가족 카드 전부 삭제 / 'insert' 시연 데이터 넣기 / 'remove' 시연 데이터만 삭제
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
  -- 커피믹스: 60일 전 주문 → 58일 전 받음, 32일 전 주문 → 30일 전 받음 ⇒ 평균 28일, 2일 지남
  for r in
    select * from (values
      ('반려견 배변패드 100매', '생활용품', 'needed',   null,     null,  2.0, 1, 1, null,           0),
      ('커피믹스 180개',        '식품',     'received', '쿠팡',   21900, 60,  1, 1, '주방 식탁 위', 2),
      ('커피믹스 180개',        '식품',     'received', '이마트', 20900, 32,  1, 2, '주방 식탁 위', 2)
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
      case when r.status = 'received' then t end,
      case when r.status = 'needed' then t else t - interval '2 hours' end
    ) returning id into new_id;

    if r.status = 'needed' then
      insert into public.item_events (item_id, family_id, status, actor, created_at) values (new_id, fam, 'needed', a, t);
    else
      -- 요청 → 담당 → 주문(같은 날) → 배송 시작(1일 뒤) → 받음
      insert into public.item_events (item_id, family_id, status, actor, note, created_at) values
        (new_id, fam, 'needed', a, null, t - interval '2 hours'),
        (new_id, fam, 'claimed', b, null, t - interval '1 hour'),
        (new_id, fam, 'ordered', b, r.store || ' · ' || to_char(r.price, 'FM999,999') || '원', t),
        (new_id, fam, 'shipping', b, null, t + interval '1 day'),
        (new_id, fam, 'received', b, r.place, t + make_interval(days => r.recv_after));
    end if;
  end loop;

  return format('시연 데이터 완료: 배변패드 지연 1건 + 커피믹스 재구매 1건 (구성원 %s명, 기준 %s)',
    n, to_char(now() at time zone 'Asia/Seoul', 'MM/DD HH24:MI'));
end $$;

-- 앱(일반 사용자)에서는 이 함수를 부를 수 없게 막는다
revoke all on function public.seed_demo(text, text) from public, anon, authenticated;

-- 3) 삭제 예약을 18:00(한국) = 09:00 UTC 로 늦추기 (예약이 있을 때만)
do $$
declare j bigint;
begin
  select jobid into j from cron.job where jobname = 'aimoa-demo-off';
  if j is not null then perform cron.alter_job(j, schedule := '0 9 17 10 *'); end if;
end $$;

-- 확인: 아래 결과에 두 줄이 나와야 해요 (command 안의 초대 코드가 'MOA-XXXX'가 아니라 우리 가족 코드인지도 확인)
--   aimoa-demo-on  | 50 4 17 10 *  (10/17 13:50 한국 시간에 시연 데이터 넣기)
--   aimoa-demo-off | 0 9 17 10 *   (10/17 18:00 한국 시간에 시연 데이터 지우기)
select jobname, schedule, active, command from cron.job where jobname like 'aimoa-demo-%' order by jobname desc;
