import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { Card, Notice, Pill, Section } from '@/components/ui';
import { C } from '@/constants/colors';
import { ItemIcon } from '@/components/item-visual';
import RestockActions from '@/components/restock-actions';
import {
  addItem, cancelSnooze, memberName, priceLabel, priceStats, RESTOCK_NOTE, restockList, resumeRestock, shortDate, useStore, won,
  type Restock,
} from '@/data/store';
import { notice } from '@/lib/confirm';
import { previewRestockNotification } from '@/lib/notify';

function badge(r: Restock) {
  if (r.requested) return { label: '요청됨', color: C.sub, bg: '#ECEAE4' };
  if (r.snoozedUntil) return { label: `${shortDate(r.snoozedUntil)}까지 미룸`, color: C.accent, bg: C.accentBg };
  if (r.dueIn == null) return null;
  if (r.dueIn <= 0) return { label: '살 때 됐어요', color: C.danger, bg: C.dangerBg };
  if (r.dueIn <= 7) return { label: `${r.dueIn}일 후`, color: C.warning, bg: C.warningBg };
  return { label: `${r.dueIn}일 후`, color: C.success, bg: C.successBg };
}

export default function RestockScreen() {
  const { items, events, prefs } = useStore();
  const all = restockList(items, events, prefs);
  // "이제 안 사요"로 끈 물건은 맨 아래 따로
  const list = all.filter((r) => !r.stopped);
  const stopped = all.filter((r) => r.stopped);
  const due = list.filter((r) => !r.requested && r.dueIn != null && r.dueIn <= 7);
  const run = (fn: () => Promise<unknown>) => fn().catch((e) => notice('저장하지 못했어요', e instanceof Error ? e.message : String(e)));

  const request = (r: Restock) =>
    addItem({ name: r.last.name, quantity: r.last.quantity, urgent: (r.dueIn ?? 1) <= 0, link: r.last.link ?? undefined, note: RESTOCK_NOTE, category: r.last.category })
      .then(() => router.navigate('/'))
      .catch((e) => notice('저장하지 못했어요', e instanceof Error ? e.message : String(e)));

  const preview = (r: Restock) =>
    previewRestockNotification(r).then((ok) => {
      if (!ok) notice('알림을 보낼 수 없어요', '휴대폰 설정에서 AI모아 알림을 허용해 주세요.');
    });

  if (!all.length) {
    return (
      <View style={s.empty}>
        <MaterialCommunityIcons name="calendar-refresh-outline" size={48} color={C.muted} />
        <Text style={s.emptyTitle}>재구매 알림</Text>
        <Text style={s.emptyBody}>
          구매 기록이 쌓이면 AI모아가 물건마다 사는 주기를 계산해서 다시 살 때를 알려줘요.
        </Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={s.container}>
      {due.length ? (
        <Notice
          color={C.danger}
          bg={C.dangerBg}
          icon={<MaterialCommunityIcons name="bell-ring-outline" size={18} color={C.danger} />}
          text={`${due.map((r) => r.key).join(', ')} 곧 떨어질 때가 됐어요.`}
        />
      ) : null}

      <Section title="물건별 구매 주기" right={`${list.length}개`} />
      {list.map((r) => {
        const b = badge(r);
        return (
          <Card key={r.key}>
            <View style={s.row}>
              <ItemIcon item={r.last} size={32} />
              <Text style={[s.name, { flex: 1, marginHorizontal: 8 }]} numberOfLines={1}>{r.key}</Text>
              {b ? <Pill label={b.label} color={b.color} bg={b.bg} /> : null}
            </View>
            <Text style={s.meta}>
              {r.avgDays ? `평균 ${r.avgDays}일마다 · ` : ''}마지막 구매 {r.daysSince === 0 ? '오늘' : `${r.daysSince}일 전`} ·{' '}
              {r.count}번 구매
            </Text>
            <Text style={s.meta} numberOfLines={1}>
              최근: {[r.last.name, [r.last.store, won(r.last.price)].filter(Boolean).join(' '), memberName(r.last.assignee)]
                .filter(Boolean)
                .join(' · ')}
            </Text>
            {(() => {
              const st = priceStats(r.last.name, items);
              return st && st.count > 1 ? (
                <Text style={s.lowest}>최저가: {priceLabel(st.min)} · 평균 {won(st.avg)}</Text>
              ) : null;
            })()}
            <View style={{ flexDirection: 'row', gap: 16 }}>
              {!r.requested ? <Text style={s.action} onPress={() => request(r)}>가족에게 요청하기</Text> : null}
              {r.avgDays ? <Text style={s.action} onPress={() => preview(r)}>알림 미리보기</Text> : null}
            </View>
            {/* 주기가 있는 물건: 아직 남았으면 미루기, 더 안 사면 알림 끄기. 미뤘으면 취소 */}
            {r.avgDays && !r.requested ? (
              r.snoozedUntil ? (
                <Text style={s.sub} onPress={() => run(() => cancelSnooze(r.key))}>
                  {shortDate(r.snoozedUntil)}까지 알림을 미뤘어요 · <Text style={{ color: C.accent }}>미루기 취소</Text>
                </Text>
              ) : (
                <RestockActions r={r} />
              )
            ) : null}
          </Card>
        );
      })}
      <Text style={s.note}>두 번 이상 산 물건은 평균 주기로 다음 구매일을 예측해요.</Text>

      {stopped.length ? (
        <>
          <Section title="알림 끈 물건 (이제 안 사요)" right={`${stopped.length}개`} />
          {stopped.map((r) => (
            <Card key={r.key}>
              <View style={s.row}>
                <ItemIcon item={r.last} size={28} />
                <Text style={[s.name, { flex: 1, marginHorizontal: 8, color: C.muted }]} numberOfLines={1}>{r.key}</Text>
                <Pill label="다시 알림 받기" color={C.accent} outline onPress={() => run(() => resumeRestock(r.key))} />
              </View>
            </Card>
          ))}
        </>
      ) : null}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { padding: 16, paddingBottom: 40 },
  row: { flexDirection: 'row', alignItems: 'center' },
  name: { fontSize: 15, color: C.text, fontWeight: '500' },
  meta: { fontSize: 12, color: C.muted, marginTop: 4 },
  action: { fontSize: 13, color: C.accent, marginTop: 8 },
  lowest: { fontSize: 12, color: C.success, marginTop: 4 },
  sub: { fontSize: 13, color: C.sub, marginTop: 8 },
  note: { fontSize: 12, color: C.muted, textAlign: 'center', marginTop: 12 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyTitle: { fontSize: 17, fontWeight: '600', color: C.text, marginTop: 12 },
  emptyBody: { fontSize: 14, color: C.sub, textAlign: 'center', marginTop: 8, lineHeight: 21 },
});
