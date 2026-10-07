import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router, Tabs } from 'expo-router';
import { useEffect } from 'react';
import type { ColorValue } from 'react-native';

import { C } from '@/constants/colors';
import {
  isPastEvent, memberName, restockList, setFamilyEventHandler, stageTimes, useStore, type Status,
} from '@/data/store';
import { notifyFamilyEvent, onNotificationTap, syncRestockNotifications, syncStaleNotifications } from '@/lib/notify';

// label: 따옴표까지 붙은 물건 이름 ("귤" 또는 "국어노트", "연필", "문제집")
function familyMessage(status: Status, note: string | null, who: string, label: string) {
  if (note?.startsWith('장소 변경') || note?.startsWith('구매 정보 수정')) return null;
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
}

// 같은 사람이 같은 종류를 몇 초 안에 여러 번 하면 (예: 학용품 3개 한 번에 요청, 영수증 한 장에 3개 주문) 알림 하나로 묶는다
const GROUP_WAIT_MS = 4000;
type Pending = { status: Status; note: string | null; who: string; names: string[]; url: string; timer: ReturnType<typeof setTimeout> };
const pending = new Map<string, Pending>();

// "국어노트", "연필", "문제집" / 4개 이상이면 "국어노트", "연필" 외 2개
const nameList = (names: string[]) =>
  names.length <= 3 ? names.map((n) => `"${n}"`).join(', ') : `${names.slice(0, 2).map((n) => `"${n}"`).join(', ')} 외 ${names.length - 2}개`;

function flush(key: string) {
  const p = pending.get(key);
  pending.delete(key);
  if (!p) return;
  const single = p.names.length === 1;
  // 묶을 때는 금액·장소 같은 개별 메모는 빼고, 종류를 정하는 메모(담당 취소, 재요청)만 남긴다
  const note = single || p.note === '담당 취소' || p.note === '재요청' ? p.note : null;
  const msg = familyMessage(p.status, note, p.who, nameList(p.names));
  if (!msg) return;
  notifyFamilyEvent(single ? msg.title : `${msg.title} (${p.names.length}개)`, msg.body, single ? p.url : '/').catch(() => {});
}

type IconName = keyof typeof MaterialCommunityIcons.glyphMap;

const tab = (title: string, icon: IconName) => ({
  title,
  tabBarIcon: ({ color, size }: { color: ColorValue; size: number }) => (
    <MaterialCommunityIcons name={icon} color={color as string} size={size} />
  ),
});

export default function TabsLayout() {
  const { family, items, events, prefs } = useStore();

  // 구매 기록이나 미루기·그만 받기 설정이 바뀔 때마다 재구매 알림을 다시 예약
  useEffect(() => {
    syncRestockNotifications(restockList(items, events, prefs)).catch(() => {});
  }, [items, events, prefs]);

  // 하루 넘게 진행이 없는 카드 알림 (받기 전 카드만)
  useEffect(() => {
    const stageAt = stageTimes(items, events);
    const open = items
      .filter((i) => i.status !== 'received')
      .map((item) => ({
        item,
        stageAt: stageAt(item),
        who: memberName(item.status === 'needed' ? item.requested_by : item.assignee),
      }));
    syncStaleNotifications(open).catch(() => {});
  }, [items, events]);

  // 알림을 누르면 해당 화면으로 이동
  useEffect(() => onNotificationTap((url) => router.navigate(url as '/stock')), []);

  // 다른 가족이 단계를 진행하면 알림
  useEffect(() => {
    setFamilyEventHandler((e, item) => {
      if (isPastEvent(e)) return; // 과거 영수증을 등록하며 생긴 기록은 알리지 않음
      const who = memberName(e.actor);
      const kind = familyMessage(e.status, e.note, who, '')?.title; // 알림 종류 (새 요청, 주문완료 …)
      if (!kind) return;
      // 같은 사람 + 같은 종류는 몇 초 모았다가 하나로
      const key = `${e.actor}|${kind}`;
      const p = pending.get(key);
      if (p) {
        if (!p.names.includes(item.name)) p.names.push(item.name);
        // 물건이 계속 들어오는 동안은 조금 더 기다린다 (10개를 한 번에 요청해도 알림 하나)
        clearTimeout(p.timer);
        p.timer = setTimeout(() => flush(key), GROUP_WAIT_MS);
        return;
      }
      pending.set(key, {
        status: e.status, note: e.note, who, names: [item.name], url: `/item/${item.id}`,
        timer: setTimeout(() => flush(key), GROUP_WAIT_MS),
      });
    });
    return () => setFamilyEventHandler(null);
  }, []);

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: C.accent,
        tabBarInactiveTintColor: C.muted,
        tabBarStyle: { backgroundColor: C.card, borderTopColor: C.border },
        headerStyle: { backgroundColor: C.bg },
        headerShadowVisible: false,
        headerTitleStyle: { fontWeight: '600' },
        sceneStyle: { backgroundColor: C.bg },
      }}>
      <Tabs.Screen name="index" options={{ ...tab('보드', 'view-dashboard-outline'), title: `${family?.name ?? '우리집'} 모아`, tabBarLabel: '보드' }} />
      <Tabs.Screen name="history" options={{ ...tab('구매 이력', 'magnify'), tabBarLabel: '이력' }} />
      <Tabs.Screen name="stock" options={{ ...tab('재구매 알림', 'calendar-refresh-outline'), tabBarLabel: '재구매' }} />
      <Tabs.Screen name="family" options={tab('가족', 'account-group-outline')} />
      <Tabs.Screen name="guide" options={tab('사용법', 'book-open-variant')} />
    </Tabs>
  );
}
