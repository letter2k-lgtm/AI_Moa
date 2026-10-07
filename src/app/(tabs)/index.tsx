import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ItemIcon, MemberDot, ProgressSteps } from '@/components/item-visual';
import RestockActions from '@/components/restock-actions';
import { includesNow, inPeriod, PeriodBar, periodLabel, periodShort, usePeriod } from '@/components/period';
import { Card, Pill, Section } from '@/components/ui';
import { C } from '@/constants/colors';
import { notice } from '@/lib/confirm';
import {
  addItem, advance, formatDate, memberName, priceLabel, priceStats, RESTOCK_NOTE, restockList, stageTimes, STATUS_INFO, timeAgo, useStore, won,
  type Item, type Restock, type Status,
} from '@/data/store';

// 받음 칸은 고른 달 기준이라 아래에서 따로 만든다
const SUMMARY: { label: string; statuses: Status[]; color: string; bg: string }[] = [
  { label: '필요', statuses: ['needed'], color: C.danger, bg: C.dangerBg },
  { label: '주문', statuses: ['claimed', 'ordered'], color: C.warning, bg: C.warningBg },
  { label: '배송중', statuses: ['shipping'], color: C.accent, bg: C.accentBg },
];

function ItemCard({ item, lastAt }: { item: Item; lastAt?: string }) {
  const info = STATUS_INFO[item.status];
  const meta =
    item.status === 'needed'
      ? `요청: ${memberName(item.requested_by)} · ${timeAgo(item.created_at)}${item.link ? ' · 링크 첨부' : ''}`
      : item.status === 'received'
        ? `${memberName(item.received_by)}가 수령${item.received_note ? ` · ${item.received_note}` : ''}`
        : [memberName(item.assignee), item.store, item.eta ?? won(item.price)].filter(Boolean).join(' · ');

  const [busy, setBusy] = useState(false);
  const claim = () => {
    if (busy) return; // 두 번 눌러도 한 번만
    setBusy(true);
    advance(item)
      .catch((e) => notice('저장하지 못했어요', e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };

  // 동그라미 색은 지금 이 카드의 주인공: 요청한 사람 → 담당자 → 받은 사람
  const who = item.status === 'needed' ? item.requested_by : item.status === 'received' ? item.received_by : item.assignee;

  return (
    <Card onPress={() => router.push(`/item/${item.id}`)}>
      <View style={s.row}>
        <ItemIcon item={item} />
        <View style={{ flex: 1, marginHorizontal: 10 }}>
          <Text style={s.name}>
            {item.urgent && item.status === 'needed' ? <Text style={{ color: C.danger }}>급함 · </Text> : null}
            {item.name}
          </Text>
          <View style={s.metaRow}>
            <MemberDot id={who} />
            <Text style={[s.meta, { flex: 1, marginTop: 0 }]}>{meta}</Text>
          </View>
          <ProgressSteps status={item.status} />
          {item.status !== 'needed' && lastAt ? (
            <Text style={s.date}>{info.label} · {formatDate(lastAt)}</Text>
          ) : null}
        </View>
        {item.status === 'needed' ? (
          <Pill label="내가 살게" color={C.accent} outline onPress={claim} />
        ) : (
          <Pill label={info.label} color={info.color} bg={info.bg} />
        )}
      </View>
    </Card>
  );
}

export default function BoardScreen() {
  const { items, events, prefs } = useStore();
  const period = usePeriod();
  // 이번 달이 들어 있는 기간이면 진행 중인 카드도 함께 보여 준다
  const isThisMonth = includesNow(period);

  // 카드가 지금 단계가 된 시각. 과거 영수증이면 그 날짜가 된다.
  const last = stageTimes(items, events);
  const byRecent = (a: Item, b: Item) => last(b).localeCompare(last(a));

  // 진행 중인 카드는 이번 달이 포함된 화면에만, 받은 카드는 받은 날 기준으로 기간에 맞춰 본다
  const needed = items.filter((i) => i.status === 'needed');
  const inProgress = items.filter((i) => i.status !== 'needed' && i.status !== 'received').sort(byRecent);
  const received = items.filter((i) => i.status === 'received' && inPeriod(period, last(i))).sort(byRecent);
  const monthTotal = received.reduce((sum, i) => sum + (i.price ?? 0), 0);
  // "이제 안 사요"로 끈 물건은 빼고, 미룬 물건은 미룬 날이 되면 다시 나온다
  const due = restockList(items, events, prefs).filter((r) => !r.requested && !r.stopped && r.dueIn != null && r.dueIn <= 0);
  const short = periodShort(period);

  const summary = [
    ...SUMMARY.map((x) => ({ ...x, count: [...needed, ...inProgress].filter((i) => x.statuses.includes(i.status)).length })),
    { label: `${short} 받음`, color: C.success, bg: C.successBg, count: received.length },
  ];

  const requestRestock = (r: Restock) =>
    addItem({ name: r.last.name, quantity: r.last.quantity, urgent: true, link: r.last.link ?? undefined, note: RESTOCK_NOTE, category: r.last.category }).catch((e) =>
      notice('저장하지 못했어요', e instanceof Error ? e.message : String(e)),
    );

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={s.container}>
        <PeriodBar />

        {isThisMonth ? due.map((r) => (
          <View key={r.key} style={s.banner}>
            <MaterialCommunityIcons name="bell-ring-outline" size={20} color={C.danger} />
            <View style={{ flex: 1 }}>
              <Text style={s.bannerTitle}>{r.key} 살 때 됐어요</Text>
              <Text style={s.bannerBody}>
                평균 {r.avgDays}일마다 샀는데 마지막 구매가 {r.daysSince}일 전이에요
              </Text>
              {(() => {
                const st = priceStats(r.last.name, items);
                return st && st.count > 1 ? <Text style={s.bannerBody}>최저가: {priceLabel(st.min)}</Text> : null;
              })()}
              <RestockActions r={r} color={C.danger} />
            </View>
            <Pill label="요청하기" color={C.danger} outline onPress={() => requestRestock(r)} />
          </View>
        )) : null}

        {isThisMonth ? (
          <>
            <View style={s.summary}>
              {summary.map((x) => (
                <View key={x.label} style={[s.summaryBox, { backgroundColor: x.bg }]}>
                  <Text style={{ color: x.color, fontSize: 12 }}>{x.label}</Text>
                  <Text style={{ color: x.color, fontSize: 20, fontWeight: '600' }}>{x.count}</Text>
                </View>
              ))}
            </View>

            <Section title="필요해요 · 담당자 없음" right={`${needed.length}개`} />
            {needed.length ? (
              needed.map((i) => <ItemCard key={i.id} item={i} />)
            ) : (
              <Text style={s.empty}>필요한 물건이 없어요. 필요할 때 + 버튼으로 요청하세요.</Text>
            )}

            <Section title="진행 중" right={`${inProgress.length}개`} />
            {inProgress.length ? (
              inProgress.map((i) => <ItemCard key={i.id} item={i} lastAt={last(i)} />)
            ) : (
              <Text style={s.empty}>진행 중인 구매가 없어요.</Text>
            )}
          </>
        ) : null}

        <Section
          title={`${periodLabel(period)}에 받은 물건`}
          right={`${received.length}개${monthTotal ? ` · ${won(monthTotal)}` : ''}`}
        />
        {received.length ? (
          received.map((i) => <ItemCard key={i.id} item={i} lastAt={last(i)} />)
        ) : (
          <Text style={s.empty}>이 기간에 받은 물건이 없어요.</Text>
        )}
      </ScrollView>

      <Pressable style={s.fab} onPress={() => router.push('/new-request')} accessibilityLabel="새 요청">
        <MaterialCommunityIcons name="plus" size={28} color="#fff" />
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  container: { padding: 16, paddingBottom: 100 },
  banner: {
    flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.dangerBg,
    borderRadius: 12, padding: 12, marginBottom: 10,
  },
  bannerTitle: { fontSize: 15, fontWeight: '600', color: C.danger },
  bannerBody: { fontSize: 12, color: C.danger, marginTop: 2 },
  summary: { flexDirection: 'row', gap: 8 },
  summaryBox: { flex: 1, borderRadius: 12, paddingVertical: 10, alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center' },
  name: { fontSize: 15, color: C.text },
  meta: { fontSize: 12, color: C.muted, marginTop: 3 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  date: { fontSize: 12, color: C.sub, marginTop: 2 },
  empty: { fontSize: 13, color: C.muted, paddingVertical: 12 },
  fab: {
    position: 'absolute', right: 20, bottom: 20, width: 56, height: 56, borderRadius: 28,
    backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center', elevation: 4,
  },
});
