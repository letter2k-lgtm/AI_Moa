import { StyleSheet, Text, View } from 'react-native';

import { MemberDot } from '@/components/item-visual';
import { inPeriod, periodShort, usePeriod, type Period } from '@/components/period';
import { Card } from '@/components/ui';
import { C } from '@/constants/colors';
import { shortDate, usageSummary, useStore, won } from '@/data/store';

// 기간에 든 달들 (오래된 순)
function monthsOf(p: Period) {
  const out: { y: number; m: number }[] = [];
  for (let i = p.from.y * 12 + p.from.m - 1; i <= p.to.y * 12 + p.to.m - 1; i++) out.push({ y: Math.floor(i / 12), m: (i % 12) + 1 });
  return out;
}

// 우리 가족이 실제로 얼마나 썼는지 (위에서 고른 기간, 기본 이번 달). 시연 카드는 세지 않는다.
export default function UsageCard() {
  const store = useStore(); // 데이터를 직접 넘겨야 바뀔 때마다 다시 계산된다
  const period = usePeriod();
  const months = monthsOf(period);
  const u = usageSummary((iso) => inPeriod(period, iso), months, store);
  const maxMonth = Math.max(1, ...u.byMonth.map((m) => m.sum));

  return (
    <Card>
      <View style={s.head}>
        <Text style={s.title}>📱 {periodShort(period)} 실사용 기록</Text>
        {u.since ? <Text style={s.since}>가족 시작 {shortDate(u.since)} · {u.days}일째</Text> : null}
      </View>

      <Text style={s.line}>
        👨‍👩‍👦 가족 {u.members.length}명 중 <Text style={s.strong}>{u.activeMembers}명 참여</Text>
      </Text>
      <View style={s.members}>
        {u.members.map((m) => (
          <View key={m.id} style={s.member}>
            <MemberDot id={m.id} size={18} />
            <Text style={s.memberName}>{m.name}</Text>
            <Text style={s.memberNum}>요청 {m.requests} · 구매 {m.purchases}</Text>
          </View>
        ))}
      </View>

      <Text style={s.line}>
        📝 요청 <Text style={s.strong}>{u.requests}건</Text>
        <Text style={s.sub}>  (구매 완료 {u.requestsDone} · 진행 중 {u.requests - u.requestsDone})</Text>
      </Text>
      <Text style={s.line}>
        🛒 구매 <Text style={s.strong}>{u.purchases}건</Text>
        <Text style={s.sub}>  (요청에서 {u.fromRequest} + 영수증으로 바로 {u.direct})</Text>
      </Text>
      {u.restocked ? <Text style={s.line}>🔔 재구매 알림 보고 요청 <Text style={s.strong}>{u.restocked}번</Text></Text> : null}

      <Text style={s.line}>
        💰 사용 금액 <Text style={s.strong}>{won(u.total) || '0원'}</Text>
      </Text>
      {/* 여러 달을 골랐을 때만 달별로 나눠 보여 준다 */}
      {u.byMonth.length > 1 && u.byMonth.map((m) => (
        <View key={m.label} style={s.monthRow}>
          <Text style={s.monthName}>{m.label}</Text>
          <View style={s.barTrack}>
            <View style={[s.bar, { width: `${Math.max(3, Math.round((m.sum / maxMonth) * 100))}%` }]} />
          </View>
          <Text style={s.monthSum}>{won(m.sum) || '0원'}</Text>
        </View>
      ))}
    </Card>
  );
}

const s = StyleSheet.create({
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 },
  title: { fontSize: 16, fontWeight: '600', color: C.text },
  since: { fontSize: 13, fontWeight: '600', color: C.accent },
  line: { fontSize: 14, color: C.text, marginTop: 8 },
  strong: { fontWeight: '700' },
  sub: { fontSize: 12, color: C.muted },
  members: { marginTop: 4, gap: 4 },
  member: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 4 },
  memberName: { fontSize: 13, color: C.text, width: 64 },
  memberNum: { fontSize: 13, color: C.sub },
  monthRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  monthName: { width: 56, fontSize: 12, color: C.sub },
  barTrack: { flex: 1, height: 8, backgroundColor: C.bg, borderRadius: 4, overflow: 'hidden' },
  bar: { height: 8, backgroundColor: C.accent, borderRadius: 4 },
  monthSum: { width: 80, fontSize: 12, color: C.text, textAlign: 'right' },
});
