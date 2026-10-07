import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import type { Item, Restock } from '@/data/store';

// 구매주기 알림: 서버 푸시 없이 폰이 직접 계산해서 띄우는 로컬 알림

const CHANNEL = 'restock';
const FAMILY_CHANNEL = 'family';
const PREFIX = 'restock-';
const NOTIFY_HOUR = 9; // 미래 알림은 해당 날 오전 9시
const supported = Platform.OS !== 'web';

let ready: Promise<boolean> | null = null;

function setup() {
  if (!supported) return Promise.resolve(false);
  ready ??= (async () => {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldPlaySound: true,
        shouldSetBadge: false,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync(CHANNEL, {
        name: '재구매 알림',
        importance: Notifications.AndroidImportance.HIGH,
      });
      await Notifications.setNotificationChannelAsync(FAMILY_CHANNEL, {
        name: '가족 구매 진행 알림',
        importance: Notifications.AndroidImportance.HIGH,
      });
    }
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return true;
    return (await Notifications.requestPermissionsAsync()).granted;
  })();
  return ready;
}

const message = (r: Restock) => ({
  title: `${r.key} 살 때 됐어요`,
  body: `${r.avgDays}일마다 샀는데 마지막 구매가 ${r.daysSince}일 전이에요. 가족에게 요청할까요?`,
  data: { url: '/stock' },
  ...(Platform.OS === 'android' ? { channelId: CHANNEL } : {}),
});

// 하루에 한 번만 같은 물건을 알린다
const today = () => new Date().toDateString();
async function alreadyToday(key: string) {
  try {
    return (await AsyncStorage.getItem(PREFIX + key)) === today();
  } catch {
    return false;
  }
}
const markToday = (key: string) => AsyncStorage.setItem(PREFIX + key, today()).catch(() => {});

// 데이터가 바뀔 때마다 호출: 지금 살 때 된 것은 바로, 곧 될 것은 그날 아침으로 예약
export async function syncRestockNotifications(list: Restock[]) {
  if (!(await setup())) return;
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    scheduled
      .filter((n) => n.identifier.startsWith(PREFIX))
      .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)),
  );

  for (const r of list) {
    // "이제 안 사요"는 알리지 않고, "아직 남았어요"로 미룬 것은 dueIn 이 미룬 날 기준이라 그날 아침에 알린다
    if (r.requested || r.stopped || r.dueIn == null || r.avgDays == null) continue;
    if (r.dueIn <= 0) {
      if (await alreadyToday(r.key)) continue;
      await markToday(r.key);
      await Notifications.scheduleNotificationAsync({
        identifier: `${PREFIX}${r.key}-now`,
        content: message(r),
        trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 3, ...(Platform.OS === 'android' ? { channelId: CHANNEL } : {}) },
      });
    } else if (r.dueIn <= 60) {
      const date = new Date();
      date.setDate(date.getDate() + r.dueIn);
      date.setHours(NOTIFY_HOUR, 0, 0, 0);
      await Notifications.scheduleNotificationAsync({
        identifier: `${PREFIX}${r.key}`,
        content: { ...message(r), body: `평균 ${r.avgDays}일마다 사는 물건이에요. 떨어지기 전에 가족에게 요청해 보세요.` },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date, ...(Platform.OS === 'android' ? { channelId: CHANNEL } : {}) },
      });
    }
  }
}

// 발표 시연용: 지금 바로 알림 한 번 띄우기
export async function previewRestockNotification(r: Restock) {
  if (!(await setup())) return false;
  await Notifications.scheduleNotificationAsync({
    content: message({ ...r, avgDays: r.avgDays ?? 30 }),
    trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 2, ...(Platform.OS === 'android' ? { channelId: CHANNEL } : {}) },
  });
  return true;
}

// ---------- 하루 이상 진행이 없는 카드 알림 ----------

const STALE = 'stale-';
const DAY_MS = 24 * 60 * 60 * 1000;

const staleMessage = (status: Item['status'], name: string, who: string) => {
  switch (status) {
    case 'needed':
      return { title: '아직 아무도 안 샀어요', body: `"${name}" 요청이 하루 넘게 담당자 없이 기다리고 있어요. "내가 살게"를 눌러 주세요.` };
    case 'claimed':
      return { title: '주문을 잊지 않으셨나요?', body: `${who}가 "${name}"을(를) 사기로 했는데 하루 넘게 주문 전이에요.` };
    case 'ordered':
      return { title: '배송 상태를 확인해 주세요', body: `"${name}" 주문한 지 하루가 넘었어요. 배송이 시작됐으면 눌러서 바꿔 주세요.` };
    case 'shipping':
      return { title: '택배 받으셨나요?', body: `"${name}" 배송 중으로 하루가 넘었어요. 받았으면 "내가 받았어요"를 눌러 주세요.` };
    default:
      return null;
  }
};

// ---------- 새 요청: 하루가 되기 전까지 3시간마다 / 도착 예정일: 그날 4시간 지나면 ----------

const REMIND_EVERY_H = 3; // "오늘 필요" 요청은 담당자가 정해질 때까지 3시간마다
const QUIET_FROM = 22; // 밤 10시 ~ 아침 8시에는 3시간 알림을 울리지 않는다
const QUIET_TO = 8;
const ETA_START_HOUR = 9; // 도착 예정일 오전 9시부터
const ETA_WAIT_H = 4; // 4시간(오후 1시)까지 배송 시작·받음 표시가 없으면 알림

const isQuiet = (d: Date) => d.getHours() >= QUIET_FROM || d.getHours() < QUIET_TO;

// "10/5(일) 도착 예정", "내일 도착", "오늘 도착" → 그날 0시. "내일·모레"는 주문한 날 기준. 못 읽으면 null
export function etaDay(item: Item): Date | null {
  const text = item.eta?.trim();
  if (!text) return null;
  const base = new Date(item.ordered_at ?? item.created_at);
  base.setHours(0, 0, 0, 0);
  const rel = text.includes('모레') ? 2 : text.includes('내일') ? 1 : text.includes('오늘') ? 0 : null;
  if (rel != null) return new Date(base.getTime() + rel * DAY_MS);
  const m = text.match(/(\d{1,2})\s*[/.월]\s*(\d{1,2})/);
  if (!m) return null;
  const d = new Date(base.getFullYear(), Number(m[1]) - 1, Number(m[2]));
  if (d.getTime() < base.getTime() - 30 * DAY_MS) d.setFullYear(d.getFullYear() + 1); // 12/30 주문 → 1/2 도착
  return d;
}

const etaMessage = (status: Item['status'], name: string, who: string, eta: Date) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const when = eta.getTime() < today.getTime() ? `도착 예정일(${eta.getMonth() + 1}/${eta.getDate()})이 지났어요` : '오늘 도착 예정이에요';
  return status === 'shipping'
    ? { title: when, body: `"${name}" 택배 받으셨나요? 받았으면 "내가 받았어요"를 눌러 주세요.` }
    : { title: `${when} · 아직 배송 전`, body: `${who}가 주문한 "${name}" 배송이 시작됐는지 확인해 주세요.` };
};

// 여러 카드를 묶을 때 쓰는 문장 (물건 이름 목록 뒤에 붙는다)
const STALE_GROUP: Partial<Record<Item['status'], string>> = {
  needed: '요청이 하루 넘게 담당자 없이 기다리고 있어요. "내가 살게"를 눌러 주세요.',
  claimed: '사기로 했는데 하루 넘게 주문 전이에요.',
  ordered: '주문한 지 하루가 넘었어요. 배송이 시작됐으면 눌러서 바꿔 주세요.',
  shipping: '배송 중으로 하루가 넘었어요. 받았으면 "내가 받았어요"를 눌러 주세요.',
};

// "국어노트", "연필", "문제집" / 4개 이상이면 "국어노트", "연필" 외 2개
const nameList = (names: string[]) =>
  names.length <= 3 ? names.map((n) => `"${n}"`).join(', ') : `${names.slice(0, 2).map((n) => `"${n}"`).join(', ')} 외 ${names.length - 2}개`;

// 울릴 알림 하나 (at: 울릴 시각, 'now': 바로)
type Plan = { at: number | 'now'; title: string; body: string; groupText: string; name: string; url: string };
const GROUP_WINDOW_MS = 10 * 60_000; // 같은 종류가 10분 안에 몰리면 알림 하나로

// stageAt: 카드가 지금 단계가 된 시각. 그로부터 24시간이 지나면 알림 (같은 카드는 하루 한 번).
// 도착 예정일이 있는 주문·배송 카드는 24시간 대신 도착 예정일 오후 1시 기준.
// "오늘 필요"로 요청했는데 아직 담당자가 없으면 하루가 되기 전까지 3시간마다 한 번 더 알린다.
// 한 번에 요청한 여러 카드처럼 같은 종류 알림이 비슷한 시각에 몰리면 하나로 묶어 보낸다.
export async function syncStaleNotifications(
  list: { item: Item; stageAt: string; who: string }[],
) {
  if (!(await setup())) return;
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    scheduled
      .filter((n) => n.identifier.startsWith(STALE))
      .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)),
  );
  const channel = Platform.OS === 'android' ? { channelId: FAMILY_CHANNEL } : {};
  const now = Date.now();
  const plans: Plan[] = [];

  for (const { item, stageAt, who } of list) {
    let msg = staleMessage(item.status, item.name, who);
    if (!msg) continue;
    let groupText = STALE_GROUP[item.status] ?? msg.body;
    const start = new Date(stageAt).getTime();
    let due = start + DAY_MS;
    const key = `${STALE}${item.id}`;
    const url = `/item/${item.id}`;

    // "오늘 필요"(급함)로 요청한 것만: 하루가 되기 전까지 3시간마다 (밤에는 건너뜀). "이번 주"는 24시간 규칙만
    if (item.status === 'needed' && item.urgent) {
      for (let h = REMIND_EVERY_H; h < 24; h += REMIND_EVERY_H) {
        const at = start + h * 3_600_000;
        if (at <= now || isQuiet(new Date(at))) continue;
        plans.push({
          at, url, name: item.name,
          title: '오늘 필요한 물건인데 아직 아무도 안 맡았어요',
          body: `"${item.name}" 요청이 ${h}시간째 기다려요. 하루까지 ${24 - h}시간 남았어요. "내가 살게"를 눌러 주세요.`,
          groupText: `요청이 ${h}시간째 기다려요. 하루까지 ${24 - h}시간 남았어요. "내가 살게"를 눌러 주세요.`,
        });
      }
    }

    // 주문·배송 카드에 도착 예정일이 있으면 그날 오후 1시 기준
    const eta = (item.status === 'ordered' || item.status === 'shipping') ? etaDay(item) : null;
    if (eta) {
      due = eta.getTime() + (ETA_START_HOUR + ETA_WAIT_H) * 3_600_000;
      msg = etaMessage(item.status, item.name, who, eta);
      groupText = item.status === 'shipping' ? '택배 받으셨나요? 받았으면 "내가 받았어요"를 눌러 주세요.' : '배송이 시작됐는지 확인해 주세요.';
    }
    const base = { ...msg, groupText, name: item.name, url };

    if (due > now) {
      // 아직 하루가 안 됐으면 하루가 되는 순간으로 예약 (앱이 꺼져 있어도 울림)
      plans.push({ ...base, at: due });
    } else {
      // 이미 하루가 지났으면 오늘 아직 안 알렸을 때만 바로 알리고, 내일 아침 9시에 한 번 더 예약
      if (!(await alreadyToday(key))) {
        await markToday(key);
        plans.push({ ...base, at: 'now' });
      }
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(NOTIFY_HOUR, 0, 0, 0);
      plans.push({ ...base, at: tomorrow.getTime() });
    }
  }

  // 같은 제목끼리, 시각 순으로 보면서 첫 알림부터 10분 안에 울리는 것들을 하나로 묶는다
  const sorted = [...plans].sort((a, b) => a.title.localeCompare(b.title) || (a.at === 'now' ? 0 : a.at) - (b.at === 'now' ? 0 : b.at));
  const groups: Plan[][] = [];
  for (const p of sorted) {
    const g = groups[groups.length - 1];
    const head = g?.[0];
    const same = head && head.title === p.title &&
      (head.at === 'now' ? p.at === 'now' : p.at !== 'now' && p.at - head.at <= GROUP_WINDOW_MS);
    if (same) g.push(p);
    else groups.push([p]);
  }

  for (const [i, g] of groups.entries()) {
    const names = [...new Set(g.map((p) => p.name))];
    const first = g[0];
    const content = names.length === 1
      ? { title: first.title, body: first.body, data: { url: first.url }, ...channel }
      : { title: `${first.title} (${names.length}개)`, body: `${nameList(names)} ${first.groupText}`, data: { url: '/' }, ...channel };
    // 묶음은 가장 늦은 알림 시각에 맞춰 한 번에 (몇 분 차이)
    const last = g.reduce((m, p) => (p.at !== 'now' && p.at > m ? p.at : m), 0);
    await Notifications.scheduleNotificationAsync({
      identifier: `${STALE}g${i}`,
      content,
      trigger: first.at === 'now'
        ? { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 5, ...channel }
        : { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(last), ...channel },
    });
  }
}

// 가족이 카드 단계를 진행시키면 바로 알림 (앱이 켜져 있거나 백그라운드에 있을 때)
export async function notifyFamilyEvent(title: string, body: string, url: string) {
  if (!(await setup())) return;
  await Notifications.scheduleNotificationAsync({
    content: { title, body, data: { url }, ...(Platform.OS === 'android' ? { channelId: FAMILY_CHANNEL } : {}) },
    trigger: null,
  });
}

// 알림을 누르면 재구매 화면으로
export function onNotificationTap(go: (url: string) => void) {
  if (!supported) return () => {};
  const sub = Notifications.addNotificationResponseReceivedListener((res) => {
    const url = res.notification.request.content.data?.url;
    if (typeof url === 'string') go(url);
  });
  return () => sub.remove();
}
