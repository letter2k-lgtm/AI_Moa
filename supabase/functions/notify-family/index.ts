// AI모아: 가족이 요청·담당·주문·배송·받음을 하면, 앱이 꺼져 있는 가족 폰에도 푸시 알림을 보낸다.
// Supabase 대시보드 > Edge Functions 에 이름 "notify-family" 로 배포.
// Database Webhook: item_events 표 INSERT → 이 함수 호출 (설정 방법은 push_tokens.sql 안내 참고)
// 필요한 Secret 없음 (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY 는 Supabase 가 자동으로 넣어 준다)

import { createClient } from 'npm:@supabase/supabase-js@2';

type Ev = { id: number; item_id: string; family_id: string; status: string; actor: string | null; note: string | null; created_at: string };

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

const GROUP_WAIT_MS = 5000; // 같은 사람이 이어서 한 일은 5초 모아서 알림 하나로
const PAST_MS = 6 * 60 * 60 * 1000; // 6시간보다 오래된 날짜로 들어온 기록(지난 영수증)은 알리지 않음

// 따옴표 붙인 물건 이름: "국어노트", "연필" 외 2개
const nameList = (names: string[]) =>
  names.length <= 3 ? names.map((n) => `"${n}"`).join(', ') : `${names.slice(0, 2).map((n) => `"${n}"`).join(', ')} 외 ${names.length - 2}개`;

// 앱의 가족 알림과 같은 문구 (label 은 따옴표까지 붙은 이름)
function message(status: string, note: string | null, who: string, label: string) {
  if (note?.startsWith('장소') || note?.startsWith('구매 정보 수정')) return null;
  if (note === '재요청') return { title: '다시 요청했어요', body: `${who}: ${label} 아직 필요해요` };
  switch (status) {
    case 'needed':
      return note === '담당 취소'
        ? { title: '담당이 취소됐어요', body: `${who}가 ${label} 담당을 취소했어요. 대신 살 사람이 필요해요.` }
        : { title: '새 요청이 왔어요', body: `${who}: ${label} 필요해요` };
    case 'claimed':
      return { title: '구매 담당이 정해졌어요', body: `${who}가 ${label} 사기로 했어요` };
    case 'ordered':
      return { title: '주문완료', body: `${who}가 ${label} 주문했어요${note ? ` (${note})` : ''}` };
    case 'shipping':
      return { title: '배송이 시작됐어요', body: `${label} 배송 중이에요` };
    case 'received':
      return { title: '택배를 받았어요', body: `${who}가 ${label} 받았어요${note ? ` · ${note}` : ''}` };
  }
  return null;
}

// 알림 종류 (같은 종류끼리 묶는다)
const kindOf = (e: Ev) => message(e.status, e.note, '', '')?.title ?? null;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  let ev: Ev;
  try {
    const payload = await req.json();
    ev = payload.record as Ev; // Database Webhook 은 { type, table, record, ... } 로 보낸다
  } catch {
    return json({ error: 'bad request' }, 400);
  }
  if (!ev?.item_id || !ev.family_id) return json({ skipped: 'no record' });
  if (Date.now() - new Date(ev.created_at).getTime() > PAST_MS) return json({ skipped: 'past' });
  const kind = kindOf(ev);
  if (!kind) return json({ skipped: 'not notified' });

  // 몇 초 기다렸다가, 같은 사람의 같은 종류 기록 중 내가 마지막일 때만 묶어서 보낸다
  await new Promise((r) => setTimeout(r, GROUP_WAIT_MS));
  const since = new Date(new Date(ev.created_at).getTime() - 30_000).toISOString();
  const { data: recent } = await sb
    .from('item_events')
    .select('id,item_id,family_id,status,actor,note,created_at')
    .eq('family_id', ev.family_id)
    .eq('actor', ev.actor)
    .gte('created_at', since)
    .order('id');
  const same = ((recent ?? []) as Ev[]).filter((e) => kindOf(e) === kind && Date.now() - new Date(e.created_at).getTime() < PAST_MS);
  // 내 뒤에 같은 종류가 더 들어왔으면 그쪽이 보낸다
  if (same.some((e) => e.id > ev.id && new Date(e.created_at).getTime() - new Date(ev.created_at).getTime() < 25_000)) {
    return json({ skipped: 'grouped into later event' });
  }
  // 나와 같이 묶을 기록: 나보다 앞서 25초 안에 들어온 것 (그 기록들은 위 조건으로 건너뛰었다)
  const group = same.filter((e) => e.id <= ev.id && new Date(ev.created_at).getTime() - new Date(e.created_at).getTime() < 25_000);
  const itemIds = [...new Set(group.map((e) => e.item_id))];

  const [{ data: items }, { data: actor }, { data: tokens }] = await Promise.all([
    sb.from('items').select('id,name').in('id', itemIds),
    sb.from('members').select('name').eq('id', ev.actor).maybeSingle(),
    sb.from('push_tokens').select('token,member_id').eq('family_id', ev.family_id),
  ]);
  const names = itemIds.map((id) => (items ?? []).find((i) => i.id === id)?.name).filter(Boolean) as string[];
  if (!names.length) return json({ skipped: 'item gone' });
  const who = actor?.name ?? '가족';
  const single = names.length === 1;
  const msg = message(ev.status, single ? ev.note : ev.note === '담당 취소' || ev.note === '재요청' ? ev.note : null, who, nameList(names));
  if (!msg) return json({ skipped: 'no message' });

  // 한 사람 본인 폰에는 보내지 않는다
  const to = (tokens ?? []).filter((t) => t.member_id !== ev.actor).map((t) => t.token);
  if (!to.length) return json({ skipped: 'no tokens' });

  const messages = to.map((token) => ({
    to: token,
    title: single ? msg.title : `${msg.title} (${names.length}개)`,
    body: msg.body,
    data: { url: single ? `/item/${itemIds[0]}` : '/' },
    channelId: 'family',
    sound: 'default',
    priority: 'high',
  }));
  const res = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(messages),
  });
  const result = await res.json().catch(() => null);
  // 더 이상 쓰지 않는 폰 주소(앱 삭제 등)는 지운다
  const tickets = (result?.data ?? []) as { status: string; details?: { error?: string } }[];
  const dead = tickets.map((t, i) => (t.status === 'error' && t.details?.error === 'DeviceNotRegistered' ? to[i] : null)).filter(Boolean) as string[];
  if (dead.length) await sb.from('push_tokens').delete().in('token', dead);
  return json({ sent: to.length, dead: dead.length, title: messages[0].title });
});
