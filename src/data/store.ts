import { useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

import { C } from '@/constants/colors';
import { notice } from '@/lib/confirm';
import { supabase } from '@/lib/supabase';

// Supabase에 저장된 우리 가족 데이터를 메모리에 들고 있고,
// 다른 가족이 바꾸면 실시간 알림을 받아 다시 불러온다.

export type Status = 'needed' | 'claimed' | 'ordered' | 'shipping' | 'received';

export const STATUS_INFO: Record<Status, { label: string; color: string; bg: string }> = {
  needed: { label: '필요해요', color: C.danger, bg: C.dangerBg },
  claimed: { label: '구매 예정', color: C.warning, bg: C.warningBg },
  ordered: { label: '주문완료', color: C.warning, bg: C.warningBg },
  shipping: { label: '배송중', color: C.accent, bg: C.accentBg },
  received: { label: '받았어요', color: C.success, bg: C.successBg },
};

export const STATUS_ORDER: Status[] = ['needed', 'claimed', 'ordered', 'shipping', 'received'];

export const CATEGORIES = ['생활용품', '식품', '학용품', '기타'] as const;
export type Category = (typeof CATEGORIES)[number];

// 기본 분류 + 우리 가족이 직접 만든 분류 (많이 쓴 순서). 이력 필터와 새 요청 분류 고르기에 쓴다
export function categoriesOf(items: Item[]): string[] {
  const count = new Map<string, number>();
  for (const i of items) {
    const c = i.category?.trim();
    if (c && !(CATEGORIES as readonly string[]).includes(c)) count.set(c, (count.get(c) ?? 0) + 1);
  }
  const custom = [...count.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  // "기타"는 맨 뒤에
  return [...CATEGORIES.filter((c) => c !== '기타'), ...custom, '기타'];
}

export type Family = { id: string; name: string; invite_code: string; created_at?: string };
export type Member = { id: string; name: string; role: string };

export type Item = {
  id: string;
  name: string;
  quantity: string;
  urgent: boolean;
  category: string | null; // 기본 분류(CATEGORIES) 또는 가족이 직접 입력한 분류
  icon?: string | null; // AI가 고르거나 직접 고른 이모지 (add_icon.sql 실행 후). 없으면 이름으로 고른다
  status: Status;
  requested_by: string | null;
  assignee: string | null;
  store: string | null;
  price: number | null;
  link: string | null;
  eta: string | null;
  received_by: string | null;
  received_note: string | null;
  ordered_at: string | null;
  created_at: string;
};

export type ItemEvent = {
  id: number;
  item_id: string;
  status: Status;
  actor: string | null;
  note: string | null;
  created_at: string;
};

// 중복 구매 확인창에서 "취소"를 눌러 막은 기록 (효과 리포트용)
export type Prevented = { id: number; member_id: string | null; name: string; price: number | null; created_at: string };

type State = {
  phase: 'loading' | 'onboarding' | 'ready' | 'error';
  error?: string;
  me: Member | null;
  family: Family | null;
  members: Member[];
  items: Item[];
  events: ItemEvent[];
  prevented: Prevented[];
  prefs: RestockPref[];
};

// 재구매 알림 설정 (물건별): 미루기 / 그만 받기. 가족 모두에게 같이 적용
export type RestockPref = { key: string; snooze_until: string | null; snoozed_at: string | null; stopped: boolean };

let state: State = { phase: 'loading', me: null, family: null, members: [], items: [], events: [], prevented: [], prefs: [] };

const listeners = new Set<() => void>();
const set = (patch: Partial<State>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};

export function useStore() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

export const useItems = () => useStore().items;

const db = () => {
  if (!supabase) throw new Error('Supabase가 설정되지 않았어요');
  return supabase;
};

const fail = (e: unknown): never => {
  throw new Error(e instanceof Error ? e.message : (e as { message?: string })?.message ?? String(e));
};

// ---------- 시작 / 가족 ----------

let started = false;

export async function start() {
  if (started) return;
  started = true;
  try {
    const sb = db();
    const { data } = await sb.auth.getSession();
    if (!data.session) {
      const { error } = await sb.auth.signInAnonymously();
      if (error) fail(error);
    }
    await loadMe();
  } catch (e) {
    started = false;
    set({ phase: 'error', error: e instanceof Error ? e.message : String(e) });
  }
}

async function loadMe() {
  const sb = db();
  const { data: user } = await sb.auth.getUser();
  const { data: me, error } = await sb.from('members').select('id,name,role,family_id').eq('id', user.user!.id).maybeSingle();
  if (error) fail(error);
  if (!me) {
    set({ phase: 'onboarding', me: null, family: null });
    return;
  }
  const { data: family, error: fErr } = await sb.from('families').select('id,name,invite_code,created_at').eq('id', me.family_id).single();
  if (fErr || !family) fail(fErr);
  set({ me: { id: me.id, name: me.name, role: me.role }, family });
  await refresh();
  subscribe(family!.id);
  set({ phase: 'ready' });
}

export async function createFamily(familyName: string, myName: string) {
  const { error } = await db().rpc('create_family', { p_family_name: familyName, p_member_name: myName });
  if (error) fail(error);
  await loadMe();
}

export async function joinFamily(code: string, myName: string) {
  const { error } = await db().rpc('join_family', { p_code: code, p_member_name: myName });
  if (error) fail(error);
  await loadMe();
}

// 폰을 바꿨거나 앱 데이터가 지워졌을 때: 같은 이름의 기존 구성원 기록을 이 폰으로 이어받기
export async function reclaimMember(code: string, myName: string) {
  const { error } = await db().rpc('reclaim_member', { p_code: code, p_member_name: myName });
  if (error) fail(error);
  await loadMe();
}

// 중복 구매 확인창에서 "취소"를 눌렀을 때 기록하고, 막은 횟수를 바로 보여준다 (실패해도 사용에는 지장 없게)
// 여러 물건을 한 번에 막으면 한 번에 기록하고 안내도 한 번만.
// 같은 물건은 5분 안에 한 번만 센다 (버튼을 두 번 눌렀거나 영수증에 같은 상품이 두 줄일 때 2번으로 세지 않게)
const PREVENT_DEDUP_MS = 5 * 60_000;
const preventing = new Set<string>(); // 지금 기록 중인 물건 (동시에 두 번 불려도 한 번만)

export async function logPrevented(names: string | string[], items: Item[]) {
  if (!state.family || !state.me) return;
  const meId = state.me.id;
  const recent = state.prevented.filter(
    (p) => p.member_id === meId && Date.now() - new Date(p.created_at).getTime() < PREVENT_DEDUP_MS,
  );
  const list = [...new Set((Array.isArray(names) ? names : [names]).map((n) => n.trim()).filter(Boolean))].filter(
    (n) => !preventing.has(n) && !recent.some((p) => sameProduct(p.name, n)),
  );
  // 같은 영수증 안에서 "블루베리"와 "블루베리 125g"처럼 같은 물건이 두 줄이면 하나만
  const unique = list.filter((n, i) => !list.slice(0, i).some((m) => sameProduct(m, n)));
  if (!unique.length) return;
  unique.forEach((n) => preventing.add(n));
  try {
    const { error } = await db()
      .from('prevented')
      .insert(unique.map((name) => ({
        family_id: state.family!.id, member_id: meId, name, price: priceStats(name, items)?.latest.price ?? null,
      })));
    if (error) return;
    await refresh().catch(() => {});
  } finally {
    unique.forEach((n) => preventing.delete(n));
  }
  const now = new Date();
  const thisMonth = state.prevented.filter((p) => {
    const d = new Date(p.created_at);
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  });
  const saved = thisMonth.reduce((s, p) => s + (p.price ?? 0), 0);
  notice(
    '중복 구매를 막았어요 👍',
    `이번 달 ${thisMonth.length}번째예요.${saved ? `\n지금까지 약 ${won(saved)} 아꼈어요.` : ''}\n가족 탭에서 효과를 볼 수 있어요.`,
  );
}

// ---------- 효과 리포트 ----------

export type Report = {
  requests: number; // 기간 안의 새 요청
  done: number; // 기간 안에 받은 것
  prevented: number; // 중복 구매 막은 횟수 (문제 ① 중복 구매)
  saved: number; // 막은 덕분에 아낀 금액 (최근 구매가 기준 추정)
  completed: number; // 기간 안의 요청 중 주문완료 이후까지 간 것 = 끝까지 처리됨 (문제 ② 주문 누락)
  inProgress: number; // 아직 주문 전인 요청 (필요해요, 구매 예정)
  waiting: number; // 그중 지금 하루 넘게 담당자 없이 기다리는 요청
  orderHours: number | null; // 요청부터 주문까지 평균 시간 (택배와 상관없는 가족 처리 속도)
  orderCount: number; // 위 평균에 쓴 요청 수
  restocked: number; // 재구매 알림을 보고 떨어지기 전에 요청한 횟수
};

// 재구매 알림에서 요청할 때 진행 기록에 남기는 표시
export const RESTOCK_NOTE = '재구매 알림';

// 주문 이후 단계
const ORDERED: Status[] = ['ordered', 'shipping', 'received'];

// inMonth: 조회 기간 안에 드는 시각인지 (보드·이력·가족 탭이 같은 기간을 쓴다)
// src: 화면에서 useStore() 로 받은 값을 넘긴다. (React Compiler 가 계산 결과를 기억해 두기 때문에,
// 함수 안에서 state 를 몰래 읽으면 데이터가 바뀌어도 화면이 다시 계산하지 않는다)
type Snapshot = Pick<State, 'items' | 'events' | 'prevented' | 'members' | 'family' | 'prefs'>;

export function monthReport(inMonth: (iso: string) => boolean, src: Snapshot = state): Report {
  const { items, events, prevented } = src;
  const firstAt = new Map<string, string>(); // 요청이 처음 생긴 시각
  const receivedAt = new Map<string, string>();
  for (const e of events) {
    if (!firstAt.has(e.item_id)) firstAt.set(e.item_id, e.created_at);
    if (e.status === 'received' && !e.note?.startsWith('장소')) receivedAt.set(e.item_id, e.created_at);
  }
  const requested = items.filter((i) => inMonth(firstAt.get(i.id) ?? i.created_at));
  const done = items.filter((i) => i.status === 'received' && inMonth(receivedAt.get(i.id) ?? i.created_at));
  // 실제로 "요청"부터 시작한 카드 (영수증으로 바로 등록한 구매 기록은 빼고)
  const DAY_MS = 24 * 3_600_000;
  const realRequests = requested.filter((i) => events.find((e) => e.item_id === i.id)?.status === 'needed');
  const completed = realRequests.filter((i) => ORDERED.includes(i.status));
  // 요청 → 주문: 처음 주문완료(또는 그 뒤 단계)가 된 시각까지. 시연 카드도 넣는다 (늦게 주문하면 평균이 늘어나는 걸 보여 준다)
  const firstOrdered = new Map<string, string>();
  for (const e of events) if (ORDERED.includes(e.status) && !firstOrdered.has(e.item_id)) firstOrdered.set(e.item_id, e.created_at);
  const orderDurations = realRequests
    .map((i) => {
      const end = firstOrdered.get(i.id);
      return end ? Math.max(0, new Date(end).getTime() - new Date(firstAt.get(i.id)!).getTime()) / 3_600_000 : null;
    })
    .filter((h): h is number => h != null);
  const monthPrevented = prevented.filter((p) => inMonth(p.created_at));
  const periodEvents = events.filter((e) => inMonth(e.created_at));
  return {
    requests: realRequests.length,
    done: done.length,
    prevented: monthPrevented.length,
    saved: monthPrevented.reduce((s, p) => s + (p.price ?? 0), 0),
    completed: completed.length,
    inProgress: realRequests.length - completed.length,
    waiting: realRequests.filter(
      (i) => i.status === 'needed' && Date.now() - new Date(firstAt.get(i.id)!).getTime() > DAY_MS,
    ).length,
    orderHours: orderDurations.length ? orderDurations.reduce((a, b) => a + b, 0) / orderDurations.length : null,
    orderCount: orderDurations.length,
    restocked: periodEvents.filter((e) => e.status === 'needed' && e.note === RESTOCK_NOTE).length,
  };
}

// ---------- 실사용 요약 (고른 기간, 시연 카드는 뺀다) ----------

export type Usage = {
  since: string | null; // 가족을 만든 날
  days: number; // 오늘까지 며칠째
  members: { id: string; name: string; requests: number; purchases: number }[];
  activeMembers: number; // 요청이나 구매를 한 번이라도 한 가족 수
  requests: number;
  requestsDone: number; // 주문완료 이후까지 간 요청
  purchases: number;
  fromRequest: number; // 요청에서 이어진 구매
  direct: number; // 요청 없이 영수증·캡처로 바로 등록한 구매
  total: number; // 기간 안의 사용 금액 (주문일 기준)
  byMonth: { label: string; sum: number }[]; // 기간 안의 달별 사용 금액 (여러 달을 골랐을 때)
  restocked: number; // 재구매 알림 보고 요청한 횟수
};

const isDemo = (i: Item) => i.name.endsWith('​');

// inPeriod: 고른 기간 안의 시각인지, months: 기간에 든 달들 (오래된 순, m은 1~12)
export function usageSummary(inPeriod: (iso: string) => boolean, months: { y: number; m: number }[], src: Snapshot = state): Usage {
  const { items, events, members, family } = src;
  const real = items.filter((i) => !isDemo(i));
  const realIds = new Set(real.map((i) => i.id));
  const firstStatus = new Map<string, Status>();
  const firstAt = new Map<string, string>();
  for (const e of events) {
    if (!firstStatus.has(e.item_id)) firstStatus.set(e.item_id, e.status);
    if (!firstAt.has(e.item_id)) firstAt.set(e.item_id, e.created_at);
  }
  // 요청은 올린 날, 구매는 주문일이 기간 안인 것
  const requests = real.filter((i) => firstStatus.get(i.id) === 'needed' && inPeriod(firstAt.get(i.id) ?? i.created_at));
  const orderedAt = (p: Item) => p.ordered_at ?? p.created_at;
  const purchases = purchasesOf(real).filter((p) => inPeriod(orderedAt(p)));
  const fromRequest = purchases.filter((p) => firstStatus.get(p.id) === 'needed').length;

  const now = new Date();
  const byMonth = months.map(({ y, m }) => ({
    label: y === now.getFullYear() ? `${m}월` : `${String(y).slice(2)}년 ${m}월`,
    sum: purchases
      .filter((p) => {
        const d = new Date(orderedAt(p));
        return d.getFullYear() === y && d.getMonth() + 1 === m;
      })
      .reduce((s, p) => s + (p.price ?? 0), 0),
  }));

  const perMember = members.map((m) => ({
    id: m.id,
    name: m.name,
    requests: requests.filter((i) => i.requested_by === m.id).length,
    purchases: purchases.filter((p) => p.assignee === m.id).length,
  }));
  const since = family?.created_at ?? null;
  return {
    since,
    days: since ? Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(since).setHours(0, 0, 0, 0)) / 86_400_000) + 1 : 0,
    members: perMember,
    activeMembers: perMember.filter((m) => m.requests || m.purchases).length,
    requests: requests.length,
    requestsDone: requests.filter((i) => ORDERED.includes(i.status)).length,
    purchases: purchases.length,
    fromRequest,
    direct: purchases.length - fromRequest,
    total: purchases.reduce((s, p) => s + (p.price ?? 0), 0),
    byMonth,
    restocked: events.filter((e) => realIds.has(e.item_id) && e.status === 'needed' && e.note === RESTOCK_NOTE && inPeriod(e.created_at)).length,
  };
}

// 화면을 열 때 바로 최신으로 (실시간 연결이 늦거나 끊겼을 때 대비). 너무 자주 부르지 않게 3초 간격
let lastManual = 0;
export function refreshNow() {
  if (!state.family || Date.now() - lastManual < 3000) return;
  lastManual = Date.now();
  refresh().catch(() => {});
}

async function refresh() {
  const sb = db();
  const familyId = state.family!.id;
  const [members, items, events, prevented, prefs] = await Promise.all([
    sb.from('members').select('id,name,role').eq('family_id', familyId).order('created_at'),
    sb.from('items').select('*').eq('family_id', familyId).order('created_at', { ascending: false }),
    sb.from('item_events').select('id,item_id,status,actor,note,created_at').eq('family_id', familyId).order('created_at'),
    sb.from('prevented').select('id,member_id,name,price,created_at').eq('family_id', familyId).order('created_at'),
    sb.from('restock_prefs').select('key,snooze_until,snoozed_at,stopped').eq('family_id', familyId),
  ]);
  if (members.error) fail(members.error);
  if (items.error) fail(items.error);
  if (events.error) fail(events.error);
  const newEvents = (events.data ?? []) as ItemEvent[];
  set({
    members: members.data ?? [],
    items: (items.data ?? []) as Item[],
    events: newEvents,
    // prevented 표는 SQL 업데이트 전에는 없을 수 있어서 오류여도 빈 목록으로 둔다
    prevented: prevented.error ? [] : ((prevented.data ?? []) as Prevented[]),
    // restock_prefs 표도 SQL(restock_prefs.sql) 실행 전에는 없을 수 있다
    prefs: prefs.error ? [] : ((prefs.data ?? []) as RestockPref[]),
  });

  // 다른 가족이 진행시킨 단계는 알림으로 알려준다 (처음 불러올 때는 알리지 않음)
  const maxId = newEvents.reduce((m, e) => Math.max(m, e.id), 0);
  if (lastEventId >= 0 && familyEventHandler) {
    for (const e of newEvents) {
      if (e.id > lastEventId && e.actor !== state.me?.id) {
        const item = state.items.find((i) => i.id === e.item_id);
        if (item) familyEventHandler(e, item);
      }
    }
  }
  lastEventId = Math.max(lastEventId, maxId);
}

let lastEventId = -1;
let familyEventHandler: ((e: ItemEvent, item: Item) => void) | null = null;
export const setFamilyEventHandler = (fn: typeof familyEventHandler) => {
  familyEventHandler = fn;
};

let channel: ReturnType<NonNullable<typeof supabase>['channel']> | null = null;
let extraChannel: ReturnType<NonNullable<typeof supabase>['channel']> | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | undefined;

// 여러 변경이 한꺼번에 오면 한 번만 다시 불러온다
const onChange = () => {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => refresh().catch(() => {}), 200);
};

// 추가 표(중복 막은 기록, 재구매 미루기 설정)는 따로 연결한다.
// Supabase 는 연결 안의 표가 하나라도 없으면(SQL 실행 전) 연결 전체를 거부해서, 같이 묶으면 카드 변경까지 늦어진다.
// 이 연결은 실패해도 다시 시도하지 않는다 (20초 확인과 화면을 열 때 새로 불러오기로 충분).
function subscribeExtras(familyId: string) {
  const sb = db();
  if (extraChannel) sb.removeChannel(extraChannel);
  extraChannel = sb
    .channel(`family-extra-${familyId}-${Date.now()}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'prevented', filter: `family_id=eq.${familyId}` }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'restock_prefs', filter: `family_id=eq.${familyId}` }, onChange)
    .subscribe();
}

function subscribe(familyId: string) {
  const sb = db();
  if (channel) sb.removeChannel(channel);
  // 카드·진행 기록·구성원: 가족이 바꾸면 바로 반영 (끊기면 다시 연결)
  const ch = sb
    .channel(`family-${familyId}-${Date.now()}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'items' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'item_events', filter: `family_id=eq.${familyId}` }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'members', filter: `family_id=eq.${familyId}` }, onChange)
    .subscribe((status) => {
      // 연결이 끊기면 잠시 뒤 다시 연결하고, 그동안 놓친 변경을 불러온다
      // (일부러 닫은 옛 채널이면 무시)
      if (channel !== ch) return;
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        setTimeout(() => {
          if (channel === ch && state.family?.id === familyId) {
            subscribe(familyId);
            onChange();
          }
        }, 3000);
      }
    });
  channel = ch;
  if (!extraChannel) subscribeExtras(familyId);
  startKeepFresh();
}

// 실시간 연결이 휴대폰 절전 등으로 끊겨도 늦지 않게:
// 앱이 다시 화면에 나오면 바로 새로고침, 켜져 있는 동안은 20초마다 확인
let keepFreshStarted = false;
function startKeepFresh() {
  if (keepFreshStarted) return;
  keepFreshStarted = true;
  AppState.addEventListener('change', (s) => {
    if (s === 'active' && state.family) refresh().catch(() => {});
  });
  setInterval(() => {
    if (state.family && AppState.currentState === 'active') refresh().catch(() => {});
  }, 20_000);
}

// ---------- 요청 카드 ----------

async function logEvent(itemId: string, status: Status, note?: string, at?: string) {
  const { error } = await db().from('item_events').insert({
    item_id: itemId, family_id: state.family!.id, status, actor: state.me!.id, note: note ?? null,
    ...(at ? { created_at: at } : {}),
  });
  if (error) fail(error);
}

// 과거 날짜(어제 이전)의 영수증/주문이면 진행 기록도 그 날짜로 남긴다. 오늘이면 지금 시각 그대로.
// step 으로 주문완료 → 배송중 → 받았어요 순서가 유지되게 몇 분씩 띄운다.
function pastTime(orderedAt: string | undefined, step = 0) {
  if (!orderedAt) return undefined;
  const d = new Date(orderedAt);
  if (d.toDateString() === new Date().toDateString() || d.getTime() > Date.now()) return undefined;
  return new Date(d.getTime() + step * 60_000).toISOString();
}

// 받은 날 기록 시각: 받은 날을 따로 알면 그 날, 모르면 주문일 (주문 기록보다 뒤에 오게 몇 분 띄움)
function receivedTime(orderedAt?: string, receivedAt?: string) {
  if (receivedAt && orderedAt && new Date(receivedAt).toDateString() !== new Date(orderedAt).toDateString()) {
    return pastTime(receivedAt);
  }
  return pastTime(receivedAt ?? orderedAt, 2);
}

// 지금 일어난 일이 아니라 과거 기록을 넣는 중인지 (가족 알림을 보내지 않기 위함)
export const isPastEvent = (e: ItemEvent) => Date.now() - new Date(e.created_at).getTime() > 6 * 60 * 60 * 1000;

export async function addItem(input: {
  name: string; quantity: string; urgent: boolean; assignee?: string | null; link?: string;
  note?: string; // 진행 기록에 남길 표시 (예: 재구매 알림)
  category?: string | null; // 고른 분류. 없으면 이름으로 추측
}) {
  const { data, error } = await db()
    .from('items')
    .insert({
      family_id: state.family!.id,
      name: input.name,
      quantity: input.quantity,
      urgent: input.urgent,
      category: input.category?.trim() || guessCategory(input.name),
      link: input.link ?? null,
      requested_by: state.me!.id,
      assignee: input.assignee ?? null,
      status: input.assignee ? 'claimed' : 'needed',
    })
    .select()
    .single();
  if (error) fail(error);
  await logEvent(data.id, 'needed', input.note ?? (input.link ? '링크 첨부' : undefined));
  if (input.assignee) await logEvent(data.id, 'claimed', `${memberName(input.assignee)} 담당`);
  await refresh();
  return data as Item;
}

// ---------- AI 캡처 분석 ----------

export type ParsedItem = { name: string; quantity: number; price: number; category: Category; emoji?: string };
export type ParsedReceipt = {
  store: string; order_date: string; items: ParsedItem[]; total: number; eta?: string; model?: string;
  delivery_status?: 'ordered' | 'shipping' | 'delivered';
  delivered_date?: string;
};

// 고른 사진을 분석 화면으로 넘기기 위한 임시 보관함
let pendingImage: { uri: string; base64: string; mimeType: string } | null = null;
export const setPendingImage = (img: typeof pendingImage) => {
  pendingImage = img;
};
export const getPendingImage = () => pendingImage;

export async function analyzeImage(img: { base64: string; mimeType: string }): Promise<ParsedReceipt> {
  const { data, error } = await db().functions.invoke('parse-receipt', {
    body: { image: img.base64, mimeType: img.mimeType },
  });
  if (error) {
    // 서버가 보낸 한국어 오류 메시지를 꺼내서 보여준다
    const ctx = (error as { context?: Response }).context;
    const body = ctx && typeof ctx.json === 'function' ? await ctx.json().catch(() => null) : null;
    throw new Error(body?.error ?? 'AI 분석 서버에 연결하지 못했어요');
  }
  return data as ParsedReceipt;
}

// 아직 주문 안 된 요청 중 이름이 겹치는 카드 (양쪽 방향으로 단어 비교)
// 주문(영수증) 날짜가 요청한 날보다 이전인지 (날짜 단위). 이전 영수증은 그 요청의 구매가 아니다.
export function isBeforeRequest(req: Item, orderedAt: string) {
  return new Date(orderedAt).setHours(0, 0, 0, 0) < new Date(req.created_at).setHours(0, 0, 0, 0);
}

// orderedAt 을 주면 그날 이후에 올린 요청에는 연결하지 않는다 (지난 영수증이 오늘 요청에 붙지 않게)
export function matchRequest(name: string, items: Item[], taken: Set<string> = new Set(), orderedAt?: string) {
  return items.find(
    (i) => (i.status === 'needed' || i.status === 'claimed') && !taken.has(i.id) && sameProduct(name, i.name) &&
      !(orderedAt && isBeforeRequest(i, orderedAt)),
  );
}

// AI가 읽은 주문을 기존 요청에 연결하거나, 없으면 새 구매 기록으로 저장
export async function recordOrder(
  order: {
    name: string; store: string; price: number; link?: string; category?: string; quantity?: number; eta?: string;
    icon?: string; // AI가 고른 이모지
    orderedAt?: string; // 영수증/주문 날짜. 없으면 지금
    status?: 'ordered' | 'shipping' | 'received'; // 캡처에 보이는 배송 상태 (영수증은 받았어요)
    place?: string; // 받았어요일 때 수령 장소
    receivedAt?: string; // 받은 날 (배송완료일). 없으면 주문일
  },
  matchId?: string,
) {
  const sb = db();
  const status = order.status ?? 'ordered';
  const received = status === 'received';
  const patch = {
    status,
    store: order.store,
    price: order.price,
    eta: received ? null : order.eta || null,
    ...(order.link ? { link: order.link } : {}),
    ...(received ? { received_by: state.me!.id, received_note: order.place?.trim() || null } : {}),
    assignee: state.me!.id,
    ordered_at: order.orderedAt ?? new Date().toISOString(),
  };
  let id = matchId;
  let kept: Status | null = null;
  if (id) {
    // 카드가 이미 더 진행된 단계면 단계는 그대로 두고 구매 정보만 채운다
    const existing = state.items.find((i) => i.id === id);
    const keep = existing && STATUS_ORDER.indexOf(existing.status) >= STATUS_ORDER.indexOf(status);
    if (keep) kept = existing.status;
    const { status: _s, assignee: _a, received_by: _r, received_note: _n, ...info } = patch as typeof patch & {
      received_by?: string; received_note?: string | null;
    };
    const { error } = await sb
      .from('items')
      .update(keep ? info : { ...patch, assignee: existing?.assignee ?? patch.assignee })
      .eq('id', id);
    if (error) fail(error);
  } else {
    const { data, error } = await sb
      .from('items')
      .insert({
        ...patch,
        family_id: state.family!.id,
        name: order.name,
        quantity: order.quantity && order.quantity > 1 ? `${order.quantity}개` : '1개',
        category: order.category ?? guessCategory(order.name),
        requested_by: state.me!.id,
        ...(pastTime(order.orderedAt) ? { created_at: pastTime(order.orderedAt) } : {}),
      })
      .select('id')
      .single();
    if (error || !data) fail(error);
    id = data!.id as string;
  }
  // AI가 고른 아이콘: 직접 고른 아이콘이 없을 때만 (icon 칸이 아직 없으면 조용히 넘어간다)
  if (order.icon && !state.items.find((i) => i.id === id)?.icon) await saveIcon(id, order.icon).catch(() => {});
  if (kept) {
    await logEvent(id, kept, `구매 정보 수정: ${order.store} · ${won(order.price)}`);
    return;
  }
  await logEvent(id, 'ordered', `${order.store} · ${won(order.price)}`, pastTime(order.orderedAt));
  if (status === 'shipping') await logEvent(id, 'shipping', undefined, pastTime(order.orderedAt, 1));
  if (received) {
    await logEvent(id, 'received', order.place?.trim() || undefined, receivedTime(order.orderedAt, order.receivedAt));
  }
}

export async function recordOrders(orders: { order: Parameters<typeof recordOrder>[0]; matchId?: string }[]) {
  for (const o of orders) await recordOrder(o.order, o.matchId);
  await refresh();
}

// 화면을 본 뒤 다른 가족이 먼저 단계를 바꿨으면 저장하지 않고 알려준다 (두 사람이 동시에 "내가 살게" 등)
async function updateIfStatus(item: Item, allowed: Status[], patch: Partial<Item>) {
  const { data, error } = await db().from('items').update(patch).eq('id', item.id).in('status', allowed).select('id');
  if (error) fail(error);
  if (!data?.length) {
    await refresh().catch(() => {});
    const now = state.items.find((i) => i.id === item.id);
    const byId = now && (now.status === 'needed' ? now.requested_by : now.assignee);
    fail(
      !now
        ? '이미 지워진 카드예요.'
        : byId === state.me?.id
          ? `이미 "${STATUS_INFO[now.status].label}" 상태예요. 화면을 새로 고쳤어요.`
          : `이미 ${memberName(byId)}가 "${STATUS_INFO[now.status].label}"(으)로 바꿨어요. 화면을 새로 고쳤어요.`,
    );
  }
}

export async function advance(item: Item, opts: { place?: string } = {}) {
  const meId = state.me!.id;
  const place = opts.place?.trim() || null;
  const next: Record<Status, { patch: Partial<Item>; status: Status; note?: string } | undefined> = {
    needed: { patch: { status: 'claimed', assignee: meId }, status: 'claimed' },
    claimed: { patch: { status: 'ordered', ordered_at: new Date().toISOString() }, status: 'ordered' },
    ordered: { patch: { status: 'shipping' }, status: 'shipping' },
    shipping: { patch: { status: 'received', received_by: meId, received_note: place }, status: 'received', note: place ?? undefined },
    received: undefined,
  };
  const step = next[item.status];
  if (!step) return;
  await updateIfStatus(item, [item.status], step.patch);
  await logEvent(item.id, step.status, step.note);
  await refresh();
}

// 요청한 사람이 "아직 필요해요" 하고 가족에게 다시 알림
export async function rerequest(item: Item) {
  await logEvent(item.id, item.status, '재요청');
  await refresh();
}

// 택배를 받음 (배송중이 아니어도 주문완료에서 바로 받을 수 있음)
export async function receive(item: Item, place: string) {
  const note = place.trim() || null;
  await updateIfStatus(item, ['ordered', 'shipping'], { status: 'received', received_by: state.me!.id, received_note: note });
  await logEvent(item.id, 'received', note ?? undefined);
  await refresh();
}

// "내가 살게" 취소 → 다시 담당자 없는 요청으로
export async function cancelClaim(item: Item) {
  await updateIfStatus(item, ['claimed'], { status: 'needed', assignee: null });
  await logEvent(item.id, 'needed', '담당 취소');
  await refresh();
}

export type OrderInfo = {
  store: string; price: number | null; orderedAt: string; link?: string | null; eta?: string | null;
  status?: 'ordered' | 'shipping' | 'received'; // 처음 주문 정보를 넣을 때 바로 이 단계로
  place?: string;
  receivedAt?: string; // 받은 날. 없으면 주문일
};

// "주문했어요"로 구매 정보를 넣거나, 이미 산 카드의 구매 정보를 고친다
export async function saveOrderInfo(item: Item, info: OrderInfo) {
  const first = item.status === 'needed' || item.status === 'claimed';
  const status = info.status ?? 'ordered';
  const place = info.place?.trim() || null;
  const patch: Partial<Item> = {
    store: info.store.trim() || null,
    price: info.price,
    ordered_at: info.orderedAt,
    ...(info.link !== undefined ? { link: info.link || null } : {}),
    ...(info.eta !== undefined ? { eta: info.eta || null } : {}),
    ...(first ? { status, assignee: item.assignee ?? state.me!.id } : {}),
    ...(first && status === 'received' ? { received_by: state.me!.id, received_note: place } : {}),
  };
  if (first) {
    // 처음 주문 정보를 넣을 때는 그 사이 다른 가족이 먼저 주문하지 않았는지 확인
    await updateIfStatus(item, ['needed', 'claimed'], patch);
  } else {
    const { error } = await db().from('items').update(patch).eq('id', item.id);
    if (error) fail(error);
  }
  const summary = [info.store.trim(), info.price != null ? won(info.price) : ''].filter(Boolean).join(' · ');
  if (first) {
    await logEvent(item.id, 'ordered', summary || undefined, pastTime(info.orderedAt));
    if (status === 'shipping') await logEvent(item.id, 'shipping', undefined, pastTime(info.orderedAt, 1));
    if (status === 'received') await logEvent(item.id, 'received', place ?? undefined, receivedTime(info.orderedAt, info.receivedAt));
  } else {
    await logEvent(item.id, item.status, `구매 정보 수정${summary ? `: ${summary}` : ''}`);
  }
  await refresh();
}

const DEFAULT_STORES = ['쿠팡', '네이버', '이마트', '다이소', '마트'];

export function frequentStores(items: Item[], limit = 6) {
  const count = new Map<string, number>();
  for (const i of items) if (i.store) count.set(i.store, (count.get(i.store) ?? 0) + 1);
  const used = [...count.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => p);
  return [...new Set([...used, ...DEFAULT_STORES])].slice(0, limit);
}

// "9/14", "2026-09-14", "2026.09.14" 같은 날짜 글자를 그날 정오 시각으로. 미래 날짜면 작년으로 본다.
export function parseDateInput(text: string): string | null {
  const t = text.trim();
  let y: number | undefined, mo: number, d: number;
  // 2026-09-14, 2026.09.14, 2026년 9월 14일
  const full = t.match(/(\d{4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})/);
  // 26.09.14 (영수증에 흔한 두 자리 연도)
  const yy = t.match(/^(\d{2})[-./](\d{1,2})[-./](\d{1,2})/);
  // 9/14, 9.14, 9월 14일
  const short = t.match(/(\d{1,2})\s*[/.월-]\s*(\d{1,2})/);
  if (full) [y, mo, d] = [Number(full[1]), Number(full[2]), Number(full[3])];
  else if (yy) [y, mo, d] = [2000 + Number(yy[1]), Number(yy[2]), Number(yy[3])];
  else if (short) [mo, d] = [Number(short[1]), Number(short[2])];
  else return null;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const now = new Date();
  const date = new Date(y ?? now.getFullYear(), mo - 1, d, 12, 0, 0);
  if (!y && date.getTime() > now.getTime() + 24 * 60 * 60 * 1000) date.setFullYear(date.getFullYear() - 1);
  return date.toISOString();
}

// AI가 연도를 잘못 읽는 경우(예: 2021-09-28) 바로잡기.
// 받은 날: 주문일 바로 뒤에 오는 같은 월/일로. 주문일: 오늘에서 가장 가까운 지난 같은 월/일로 (1년 넘게 차이 나면).
export function fixYear(iso: string, notBefore?: string | null): string {
  const d = new Date(iso);
  const DAY_MS = 86_400_000;
  if (notBefore) {
    const ref = new Date(notBefore);
    d.setFullYear(ref.getFullYear());
    if (d.getTime() < ref.getTime() - DAY_MS) d.setFullYear(ref.getFullYear() + 1);
    return d.toISOString();
  }
  const now = new Date();
  if (d.getTime() > now.getTime() + DAY_MS || d.getTime() < now.getTime() - 365 * DAY_MS) {
    d.setFullYear(now.getFullYear());
    if (d.getTime() > now.getTime() + DAY_MS) d.setFullYear(now.getFullYear() - 1);
  }
  return d.toISOString();
}

// AI가 읽은 날짜 글자를 화면에 "9/28"처럼 보여주기 (연도 문제를 숨기고 고치기 쉽게)
export function toMonthDay(text?: string | null, notBefore?: string | null) {
  const iso = text ? parseDateInput(text) : null;
  if (!iso) return '';
  const d = new Date(fixYear(iso, notBefore));
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

// ---------- 아이콘 ----------

// 이모지 한 개만 (글자가 섞이거나 너무 길면 버린다)
const cleanIcon = (s: string) => {
  const t = s.trim();
  return t && t.length <= 8 && !/[\p{L}\p{N}]/u.test(t) ? t : null;
};

async function saveIcon(id: string, icon: string) {
  const v = cleanIcon(icon);
  if (!v) return;
  const { error } = await db().from('items').update({ icon: v }).eq('id', id);
  if (error) throw error;
}

// 카드 상세에서 아이콘 바꾸기. 같은 물건의 다른 카드에도 이 아이콘이 쓰인다 (learnedIcon)
export async function updateIcon(item: Item, icon: string | null) {
  const v = icon ? cleanIcon(icon) : null;
  if (icon && !v) fail('이모지 하나만 넣어 주세요');
  const { error } = await db().from('items').update({ icon: v }).eq('id', item.id);
  if (error) fail(/icon/.test(error.message) ? '아이콘 칸이 아직 없어요. Supabase에서 add_icon.sql 을 실행해 주세요.' : error);
  await refresh();
}

// 같은 물건(이름 비교)에 가족이 정해 둔 아이콘이 있으면 그것을 쓴다. 가장 최근 것 우선
let iconCache: { items: Item[]; map: Map<string, string | null> } | null = null;
export function learnedIcon(name: string): string | null {
  if (!iconCache || iconCache.items !== state.items) iconCache = { items: state.items, map: new Map() };
  const hit = iconCache.map.get(name);
  if (hit !== undefined) return hit;
  const found = [...state.items]
    .filter((i) => i.icon)
    .sort((a, b) => (b.ordered_at ?? b.created_at).localeCompare(a.ordered_at ?? a.created_at))
    .find((i) => i.name === name || sameProduct(name, i.name));
  const v = found?.icon ?? null;
  iconCache.map.set(name, v);
  return v;
}

// 분류만 고치기 (예: 기타로 들어간 귤 → 식품)
export async function updateCategory(item: Item, category: string) {
  const c = category.trim();
  if (!c || c === item.category) return;
  const { error } = await db().from('items').update({ category: c }).eq('id', item.id);
  if (error) fail(error);
  await refresh();
}

// 받은 뒤에 수령 장소만 고치기
export async function updatePlace(item: Item, place: string) {
  const note = place.trim() || null;
  const { error } = await db().from('items').update({ received_note: note }).eq('id', item.id);
  if (error) fail(error);
  await logEvent(item.id, 'received', note ? `장소 변경: ${note}` : '장소 지움');
  await refresh();
}

const DEFAULT_PLACES = ['현관 앞', '경비실', '무인택배함', '집 안', '회사'];

// 우리 가족이 자주 쓴 수령 장소 순서 + 기본 장소
export function frequentPlaces(items: Item[], limit = 6) {
  const count = new Map<string, number>();
  for (const i of items) {
    const p = i.received_note?.trim();
    if (p && !p.includes('(시연)')) count.set(p, (count.get(p) ?? 0) + 1);
  }
  const used = [...count.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => p);
  return [...new Set([...used, ...DEFAULT_PLACES])].slice(0, limit);
}

export async function deleteItem(id: string) {
  const { error } = await db().from('items').delete().eq('id', id);
  if (error) fail(error);
  await refresh();
}

// ---------- 화면용 도우미 ----------

export const memberName = (id?: string | null) =>
  (id && state.members.find((m) => m.id === id)?.name) || (id ? '알 수 없음' : '아무나');

// 가족별 색깔: 가족에 들어온 순서대로 (아빠 파랑, 엄마 분홍, 아이 초록…). 모두가 같은 색으로 본다.
const MEMBER_COLORS = ['#2F6FD6', '#D6457A', '#3B8A2F', '#E07B16', '#7A4FD0', '#138A8A'];
export const memberColor = (id?: string | null) => {
  const i = id ? state.members.findIndex((m) => m.id === id) : -1;
  return i < 0 ? C.muted : MEMBER_COLORS[i % MEMBER_COLORS.length];
};

export const won = (n?: number | null) => (n == null ? '' : `${n.toLocaleString('ko-KR')}원`);

export function formatDate(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return d.toDateString() === now.toDateString() ? `오늘 ${hm}` : `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}

export function timeAgo(iso: string) {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return '방금';
  if (min < 60) return `${min}분 전`;
  if (min < 60 * 24) return `${Math.floor(min / 60)}시간 전`;
  return `${Math.floor(min / 60 / 24)}일 전`;
}

// 카드마다 지금 단계가 된 시각 (과거 영수증이면 그 날짜). 기록이 없으면 주문일/만든 시각.
export function stageTimes(items: Item[], events: ItemEvent[]) {
  const statusOf = new Map(items.map((i) => [i.id, i.status]));
  const at = new Map<string, string>();
  for (const e of events) if (e.status === statusOf.get(e.item_id)) at.set(e.item_id, e.created_at); // events 는 오래된 순
  return (i: Item) => at.get(i.id) ?? i.ordered_at ?? i.created_at;
}

export const currentMonth = () => {
  const d = new Date();
  return { y: d.getFullYear(), m: d.getMonth() + 1 };
};

const RECENT_DAYS = 7;

export const isRecent = (iso: string, days = RECENT_DAYS) => Date.now() - new Date(iso).getTime() < days * 24 * 60 * 60 * 1000;

export const shortDate = (iso: string) => {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
};

// 구매 이력 = 가격이 기록된 카드 (주문완료 이후)
export function purchasesOf(items: Item[]) {
  return items
    .filter((i) => i.status === 'ordered' || i.status === 'shipping' || i.status === 'received')
    .sort((a, b) => (b.ordered_at ?? b.created_at).localeCompare(a.ordered_at ?? a.created_at));
}

// 중복 구매 경고: 이름에 같은 단어가 있는 가장 최근 구매
export function findPastPurchase(name: string, items: Item[]) {
  if (!name.trim()) return undefined;
  return purchasesOf(items).find((p) => sameProduct(name, p.name));
}

const daysLabel = (iso: string) => {
  const days = Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(iso).setHours(0, 0, 0, 0)) / 86_400_000);
  return days <= 0 ? '오늘' : days === 1 ? '어제' : `${days}일 전`;
};

// 주기가 없는 물건도 최근 30일 안에 샀으면 한 번 물어본다 (예: 어제 산 국어노트를 오늘 또)
// 진행 중인 같은 물건이 있으면 그것을 먼저 알린다. 없으면 null.
export function duplicateWarning(name: string, items: Item[], excludeId?: string): string | null {
  if (!name.trim()) return null;
  const others = items.filter((i) => i.id !== excludeId);
  const open = findOpenRequest(name, others);
  if (open) {
    const who = memberName(open.status === 'needed' ? open.requested_by : open.assignee);
    return `"${open.name}"은(는) 이미 ${who}가 ${STATUS_INFO[open.status].label} 상태예요.`;
  }
  const past = findPastPurchase(name, others);
  const at = past && (past.ordered_at ?? past.created_at);
  if (past && at && isRecent(at, 30)) {
    return `${daysLabel(at)}(${shortDate(at)}) ${memberName(past.assignee)}가 "${past.name}"을(를) 샀어요.`;
  }
  return null;
}

// 아직 받지 않은 같은 물건 (요청됨, 구매 예정, 주문완료, 배송중)
export function findOpenRequest(name: string, items: Item[]) {
  if (!name.trim()) return undefined;
  return items.find((i) => i.status !== 'received' && sameProduct(name, i.name));
}

// 같은 물건을 다르게 부르는 말 (첫 단어가 대표 이름)
const SYNONYMS = [
  ['생수', '물', '삼다수', '아이시스', '백산수', '에비앙', '샘물', '평창수', '볼빅', '미네랄워터', '먹는물', '몽베스트', '석수'],
  ['휴지', '화장지', '두루마리'],
  ['키친타올', '키친타월', '키친타워'],
  ['세제', '세탁세제'],
  ['물티슈', '아기물티슈'],
];

// 이름에서 숫자·단위가 붙은 단어와 [쿠팡] 같은 앞머리를 뺀 핵심 (예: "백설 올리브유 1L" → "백설 올리브유")
const coreName = (name: string) =>
  name
    .replace(/​/g, '')
    .replace(/\[[^\]]*\]/g, ' ')
    .split(/[\s,()/]+/)
    .filter((w) => w && !/\d/.test(w))
    .join(' ')
    .trim();

// 한국어는 단어 끝이 실제 물건이다: 두루마리휴지 = 휴지, 휴지통 = 통, 커피잔 = 잔, 우유식빵 = 빵
const isWordOrEnd = (word: string, target: string) => word === target || (target.length >= 2 && word.endsWith(target));

// 짧은 이름의 단어가 긴 이름에 모두 있고, 짧은 이름의 마지막 단어(실제 물건)가 긴 이름의 한 단어와 같거나 그 끝일 때
function containsProduct(short: string[], long: string[]) {
  if (!short.length || !long.length) return false;
  const head = short[short.length - 1];
  if (!long.some((w) => isWordOrEnd(w, head))) return false;
  return short.slice(0, -1).every((w) => long.some((x) => x.includes(w)));
}

// 같은 물건인지: 대표 이름이 같거나(삼다수 = 생수), 한쪽 이름이 다른 쪽에 포함될 때(올리브유 ⊂ 백설 올리브유)
// 단어 하나만 겹치는 경우(고양이 모래 ↔ 고양이 간식, 커피 ↔ 커피잔)는 다른 물건으로 본다
export function sameProduct(a: string, b: string) {
  if (productKey(a) === productKey(b)) return true;
  const wa = coreName(a).split(' ').filter(Boolean);
  const wb = coreName(b).split(' ').filter(Boolean);
  return wa.length <= wb.length ? containsProduct(wa, wb) : containsProduct(wb, wa);
}

// ---------- 재구매 예측 ----------

export type Restock = {
  key: string;
  last: Item;
  count: number;
  daysSince: number;
  avgDays: number | null; // 두 번 이상 샀을 때만
  dueIn: number | null; // 음수면 이미 지남 (미뤘으면 미룬 날 기준)
  requested: boolean; // 이미 보드에 진행 중인 카드가 있음
  snoozedUntil: string | null; // "아직 남았어요"로 이 날까지 미룸
  stopped: boolean; // "이제 안 사요" → 알림·배너에서 뺀다
};

// 같은 물건의 가격 비교: 최저가, 평균가, 최근가 (금액이 들어간 구매만)
export type PriceStats = { count: number; min: Item; latest: Item; avg: number };

export function priceStats(name: string, items: Item[]): PriceStats | null {
  const q = name.trim();
  if (!q) return null;
  const key = productKey(q);
  // 중복 확인과 같은 기준으로 같은 물건을 찾는다 (블루베리 125g = 냉동 블루베리 1kg). 최근 순
  const list = purchasesOf(items).filter((p) => p.price && (productKey(p.name) === key || p.name.includes(q) || sameProduct(q, p.name)));
  if (!list.length) return null;
  return {
    count: list.length,
    min: list.reduce((a, b) => (b.price! < a.price! ? b : a)),
    latest: list[0],
    avg: Math.round(list.reduce((s, p) => s + p.price!, 0) / list.length),
  };
}

// "쿠팡 7,980원 (9/12)"
export const priceLabel = (p: Item) =>
  `${p.store ? `${p.store} ` : ''}${won(p.price)} (${shortDate(p.ordered_at ?? p.created_at)})`;

// 재구매 계산용 대표 이름: 같은 종류(삼다수, 아이시스 → 생수)는 하나로 묶는다
function productKey(name: string) {
  const clean = name.replace(/​/g, '').replace(/\[[^\]]*\]/g, ' ');
  const words = clean.split(/[\s,()/]+/).filter(Boolean);
  // 1) 동의어 묶음 (물티슈는 물과 헷갈리지 않게 먼저 확인). 단어 끝에 있을 때만: 생수병 ≠ 생수, 휴지통 ≠ 휴지
  if (words.some((x) => x.endsWith('물티슈'))) return '물티슈';
  const group = SYNONYMS.find((g) => g.some((s) => words.some((x) => isWordOrEnd(x, s))));
  if (group) return group[0];
  // 2) 생활용품·식품 대표 단어 (휴지, 세제, 건전지…). 학용품은 국어노트/수학노트처럼 따로 본다.
  //    한국어는 단어 끝이 실제 물건이라 끝에 있을 때만 (두루마리휴지 = 휴지, 우유식빵 ≠ 우유)
  const keyword = CATEGORY_WORDS.filter(([c]) => c !== '학용품')
    .flatMap(([, w]) => w)
    .find((w) => words.some((x) => isWordOrEnd(x, w)));
  if (keyword) return keyword;
  // 3) 숫자·단위를 뺀 이름 (고양이 모래 10L → 고양이 모래)
  const base = words.filter((w) => !/\d/.test(w)).join(' ').trim();
  return base || clean.trim();
}

const DAY = 24 * 60 * 60 * 1000;

// 같은 물건(대표 이름)끼리 묶은 구매와, 주문한 시각 목록 (오래된 순, 같은 날 여러 번은 한 번으로)
// 주기는 "주문일" 기준: 재구매 알림은 "주문할 때"를 알려 주는 것이고, 택배 도착이 늦어도 주기가 흔들리지 않게.
// (마트 영수증은 산 날 = 주문일)
function purchaseGroups(items: Item[], _events?: ItemEvent[]) {
  const groups = new Map<string, Item[]>();
  for (const p of purchasesOf(items)) {
    const k = productKey(p.name);
    groups.set(k, [...(groups.get(k) ?? []), p]);
  }
  const orderAt = (p: Item) => new Date(p.ordered_at || p.created_at).getTime();
  return [...groups.entries()].map(([key, list]) => {
    const sorted = list.map(orderAt).sort((a, b) => a - b);
    const times = sorted.filter((t, i) => i === 0 || new Date(t).toDateString() !== new Date(sorted[i - 1]).toDateString());
    return { key, list, times };
  });
}

// prefs: 화면에서 useStore().prefs 를 넘긴다 (미루기·그만 받기가 바뀌면 바로 다시 계산되게)
export function restockList(items: Item[], events: ItemEvent[] = state.events, prefs: RestockPref[] = state.prefs): Restock[] {
  const now = Date.now();
  return purchaseGroups(items, events)
    .map(({ key, list, times }) => {
      const last = list[0];
      const daysSince = Math.floor((now - times[times.length - 1]) / DAY);
      const avgDays =
        times.length >= 2 ? Math.round((times[times.length - 1] - times[0]) / DAY / (times.length - 1)) : null;
      const cycleDue = avgDays && avgDays > 0 ? avgDays - daysSince : null;
      // 미루기는 미룬 뒤에 새로 사지 않았을 때만 (새로 사면 주기를 다시 계산하니까 미루기는 끝)
      const pref = prefs.find((p) => p.key === key);
      const snoozedUntil =
        pref?.snooze_until && new Date(pref.snooze_until).getTime() > now &&
        !(pref.snoozed_at && times[times.length - 1] > new Date(pref.snoozed_at).getTime())
          ? pref.snooze_until
          : null;
      const snoozeDue = snoozedUntil ? Math.ceil((new Date(snoozedUntil).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / DAY) : null;
      return {
        key,
        last,
        count: list.length,
        daysSince,
        avgDays: avgDays && avgDays > 0 ? avgDays : null,
        dueIn: cycleDue != null && snoozeDue != null ? Math.max(cycleDue, snoozeDue) : cycleDue,
        snoozedUntil,
        stopped: !!pref?.stopped,
        // 새 요청이 이미 있거나, 마지막 구매가 아직 배송 중이면 다시 살 필요 없음
        requested:
          last.status === 'ordered' ||
          last.status === 'shipping' ||
          items.some((i) => (i.status === 'needed' || i.status === 'claimed') && productKey(i.name) === key),
      };
    })
    .sort((a, b) => (a.dueIn ?? 9999) - (b.dueIn ?? 9999) || b.daysSince - a.daysSince);
}

// ---------- 재구매 알림 미루기 / 그만 받기 (가족 공통) ----------

async function savePref(key: string, patch: Partial<RestockPref>) {
  const { error } = await db()
    .from('restock_prefs')
    .upsert({ family_id: state.family!.id, key, updated_by: state.me!.id, updated_at: new Date().toISOString(), ...patch });
  if (error) fail(/restock_prefs/.test(error.message) ? '설정 표가 아직 없어요. Supabase에서 restock_prefs.sql 을 실행해 주세요.' : error);
  await refresh();
}

// "아직 남았어요": until 날까지 알림을 미룬다 (주기 계산은 그대로)
export const snoozeRestock = (key: string, until: string) =>
  savePref(key, { snooze_until: until, snoozed_at: new Date().toISOString(), stopped: false });
export const cancelSnooze = (key: string) => savePref(key, { snooze_until: null, snoozed_at: null });
// "이제 안 사요" / 다시 알림 받기
export const stopRestock = (key: string) => savePref(key, { stopped: true, snooze_until: null, snoozed_at: null });
export const resumeRestock = (key: string) => savePref(key, { stopped: false });

// 미룰 날 입력: "11/25", "11.25", "15일"(오늘부터 15일 뒤), "15". 오늘 이전 날짜면 내년으로. 그날 오전 9시. 못 읽으면 null
export function parseFutureDate(text: string): string | null {
  const t = text.trim();
  const days = t.match(/^(\d{1,3})\s*일?\s*(뒤|후)?$/);
  const today = new Date();
  today.setHours(9, 0, 0, 0);
  if (days && !/[/.월]/.test(t)) {
    const n = Number(days[1]);
    return n >= 1 ? new Date(today.getTime() + n * DAY).toISOString() : null;
  }
  const m = t.match(/(\d{1,2})\s*[/.월-]\s*(\d{1,2})/);
  if (!m) return null;
  const mo = Number(m[1]), d = Number(m[2]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const date = new Date(today.getFullYear(), mo - 1, d, 9, 0, 0);
  if (date.getTime() <= today.getTime()) date.setFullYear(date.getFullYear() + 1);
  return date.toISOString();
}

// ---------- 구매 주기 예측 적중률 ----------
// 같은 물건을 3번 이상 샀으면, k번째 주문을 그 전 주문들의 평균 주기로 예측했을 때(재구매 알림과 같은 계산)
// 실제로 주문한 날이 예측일 ± 주기의 20% (최소 ±2일) 안이면 적중. 기간과 상관없이 전체 기록으로 본다.

export type Prediction = { key: string; predicted: number; actual: number; errorDays: number; cycle: number; hit: boolean };
export type PredictionReport = { count: number; hits: number; avgErrorDays: number | null; latest: Prediction | null };

const HIT_RATIO = 0.2;
const HIT_MIN_DAYS = 2;
const dayStart = (t: number) => new Date(t).setHours(0, 0, 0, 0);

export function predictionReport(items: Item[] = state.items, events: ItemEvent[] = state.events): PredictionReport {
  const all: Prediction[] = [];
  for (const { key, times } of purchaseGroups(items, events)) {
    for (let k = 2; k < times.length; k++) {
      const cycle = Math.round((times[k - 1] - times[0]) / DAY / (k - 1));
      if (cycle <= 0) continue;
      const predicted = dayStart(times[k - 1]) + cycle * DAY;
      const errorDays = Math.round((dayStart(times[k]) - predicted) / DAY); // +면 늦게 주문, -면 일찍 주문
      all.push({ key, predicted, actual: times[k], errorDays, cycle, hit: Math.abs(errorDays) <= Math.max(HIT_MIN_DAYS, cycle * HIT_RATIO) });
    }
  }
  return {
    count: all.length,
    hits: all.filter((p) => p.hit).length,
    avgErrorDays: all.length ? all.reduce((s, p) => s + Math.abs(p.errorDays), 0) / all.length : null,
    latest: all.length ? all.reduce((a, b) => (b.actual > a.actual ? b : a)) : null,
  };
}

const CATEGORY_WORDS: [Category, string[]][] = [
  ['생활용품', ['휴지', '세제', '물티슈', '샴푸', '치약', '칫솔', '비누', '수건', '키친타올', '섬유유연제', '건전지']],
  ['식품', ['생수', '물', '라면', '우유', '쌀', '계란', '커피', '과자', '음료', '김치']],
  ['학용품', ['문제집', '볼펜', '연필', '공책', '노트', '지우개', '책', '파일', '색연필']],
];


// 분류 추측에만 쓰는 단어 (재구매 묶음·중복 확인 규칙에는 쓰지 않는다)
const GUESS_EXTRA: [Category, string[]][] = [
  ['생활용품', ['화장지', '두루마리', '키친타월', '린스', '바디워시', '로션', '수세미', '고무장갑', '쓰레기봉투', '종량제', '지퍼백',
    '호일', '랩', '마스크', '기저귀', '생리대', '면도기', '배터리', '전구', '부탄가스', '세정제', '방향제', '모래', '배변패드', '사료']],
  ['식품', ['귤', '감귤', '한라봉', '사과', '배', '바나나', '포도', '딸기', '수박', '참외', '복숭아', '토마토', '감자', '고구마',
    '당근', '양파', '마늘', '대파', '배추', '양배추', '오이', '버섯', '두부', '고기', '삼겹살', '닭', '생선', '새우', '햄', '소시지',
    '빵', '식빵', '떡', '만두', '가루', '전분', '블루베리', '오트밀', '국수', '파스타', '햇반', '즉석밥', '두유', '요거트', '치즈', '버터', '달걀', '식용유', '올리브유',
    '간장', '고추장', '된장', '소금', '설탕', '꿀', '잼', '주스', '콜라', '사이다', '맥주', '와인', '차', '녹차', '원두', '캡슐',
    '커피믹스', '시리얼', '초콜릿', '사탕', '젤리', '아이스크림', '츄르', '간식', '견과', '김', '참치', '삼다수']],
  ['학용품', ['사인펜', '형광펜', '크레파스', '스케치북', '물감', '교재', '테이프', '가위', '풀', '필통', '복사용지', 'A4']],
];
// 한 글자 중 단어 전체가 그 글자일 때만 맞는 것 (선물 ≠ 물, 택배 ≠ 배, 녹차는 따로 있음)
const EXACT_ONLY = new Set(['물', '배', '차', '김', '풀', '랩']);

export function guessCategory(name: string): Category {
  // "제주귤5kg"처럼 숫자·단위가 붙어 있으면 숫자 앞까지만 본다
  const words = name.split(/[\s,()/[\]]+/).filter(Boolean).map((w) => w.replace(/\d.*$/, '')).filter(Boolean);
  const has = (w: string) =>
    w.length >= 2 ? name.includes(w) : EXACT_ONLY.has(w) ? words.includes(w) : words.some((x) => x.endsWith(w));
  const lists: [Category, string[]][] = CATEGORY_WORDS.map(([c, list]) => [c, [...list, ...(GUESS_EXTRA.find(([g]) => g === c)?.[1] ?? [])]]);
  return lists.find(([, list]) => list.some(has))?.[0] ?? '기타';
}
