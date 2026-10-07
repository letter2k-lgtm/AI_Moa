import { MaterialCommunityIcons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { includesNow, inPeriod, months, PeriodBar, periodLabel, periodShort, usePeriod } from '@/components/period';
import { Card } from '@/components/ui';
import { C } from '@/constants/colors';
import { monthReport, predictionReport, shortDate, useStore, won, type Report } from '@/data/store';

const hoursLabel = (h: number) =>
  h < 1 ? `${Math.max(1, Math.round(h * 60))}분` : h < 24 ? `${Math.round(h)}시간` : `${(h / 24).toFixed(1)}일`;

// 발표 마지막 화면이 되는 한 줄: "이번 달 AI모아 덕분에 중복 구매 2번을 막아 약 12,000원을 아꼈어요"
function headline(label: string, r: Report) {
  if (r.prevented && r.saved) return `${label} AI모아 덕분에 중복 구매 ${r.prevented}번을 막아 약 ${won(r.saved)}을 아꼈어요`;
  if (r.prevented) return `${label} AI모아 덕분에 중복 구매를 ${r.prevented}번 막았어요`;
  return `${label} 같은 물건을 또 사려고 하면 AI모아가 막아 드려요`;
}

// 고른 기간(기본 이번 달)에 우리 가족이 AI모아로 얻은 효과를 숫자로.
// 실제 결과로 보여 준다: 중복 구매를 막았는지, 요청이 빠짐없이 주문까지 갔는지, 얼마나 빨리 주문했는지.
export default function ReportCard() {
  const store = useStore(); // 데이터를 직접 넘겨야 바뀔 때마다 다시 계산된다
  const period = usePeriod();
  const label = periodLabel(period);
  const r = monthReport((iso) => inPeriod(period, iso), store);
  const p = predictionReport(store.items, store.events);

  // hint: 이 숫자가 어느 쪽이면 좋은지 (보는 사람이 바로 판단할 수 있게). bad: 지금 확인이 필요한 상태
  type Icon = keyof typeof MaterialCommunityIcons.glyphMap;
  // of: 큰 숫자 위에 작게 붙는 기준 ("총 요청 4건 중")
  const tiles: { icon: Icon; label: string; of?: string; value: string; sub?: string; color: string; hint: { icon: Icon; text: string }; bad?: boolean; full?: boolean }[] = [
    {
      icon: 'shield-check-outline',
      label: '중복 구매 막음',
      value: `${r.prevented}번`,
      sub: r.saved ? `약 ${won(r.saved)} 아낌` : '같은 물건 두 번 사기 방지',
      color: C.success,
      hint: { icon: 'arrow-up-bold', text: '많을수록 좋아요' },
    },
    {
      // 요청부터 주문완료까지 (택배 기간은 빼고 가족이 얼마나 빨리 처리했는지)
      icon: 'timer-outline',
      label: '주문까지 걸린 시간',
      value: r.orderHours != null ? hoursLabel(r.orderHours) : '-',
      sub: r.orderHours != null ? `주문한 요청 ${r.orderCount}건 평균` : '아직 주문한 요청이 없어요',
      color: C.text,
      hint: { icon: 'arrow-down-bold', text: '짧을수록 좋아요' },
    },
    {
      // 그달 누적: 요청 중 주문완료 이후까지 간 것. 지금 하루 넘게 담당자 없는 요청이 있으면 칸을 빨갛게.
      icon: r.waiting ? 'alert-circle-outline' : 'check-circle-outline',
      label: '끝까지 처리된 요청',
      of: r.requests ? `총 요청 ${r.requests}건 중` : undefined,
      value: r.requests ? `${r.completed}건 주문 완료 (${Math.round((r.completed / r.requests) * 100)}%)` : '-',
      sub: r.waiting
        ? `지금 ${r.waiting}건이 하루 넘게 담당자를 기다려요`
        : !r.requests
          ? '아직 요청이 없어요'
          : r.inProgress
            ? `진행 중 ${r.inProgress}건 (주문 전)`
            : '모든 요청이 주문까지 끝났어요',
      color: r.waiting ? C.danger : r.requests && !r.inProgress ? C.success : C.text,
      hint: r.waiting ? { icon: 'alert', text: '지금 확인이 필요해요' } : { icon: 'arrow-up-bold', text: '높을수록 좋아요' },
      bad: r.waiting > 0,
      full: true,
    },
    {
      full: true,
      // 전체 기록 기준: 재구매 알림이 예측한 날과 실제로 산 날 비교 (±주기의 20%, 최소 ±2일이면 적중)
      icon: 'bullseye-arrow',
      label: '구매 주기 예측 적중률 (전체 기록)',
      of: p.count ? `예측 ${p.count}번 중` : undefined,
      value: p.count ? `${p.hits}번 적중 (${Math.round((p.hits / p.count) * 100)}%)` : '-',
      sub: p.latest
        ? `최근: ${p.latest.key} 예측 ${shortDate(new Date(p.latest.predicted).toISOString())} · 실제 ${shortDate(new Date(p.latest.actual).toISOString())} (${p.latest.errorDays === 0 ? '딱 맞음' : `${Math.abs(p.latest.errorDays)}일 ${p.latest.errorDays > 0 ? '늦게' : '일찍'}`})`
        : '같은 물건을 3번 사면 예측이 맞았는지 보여 드려요',
      color: p.count && p.hits === p.count ? C.success : C.text,
      hint: { icon: 'arrow-up-bold', text: '높을수록 좋아요' },
    },
  ];

  return (
    <Card>
      <PeriodBar />
      <View style={s.titleRow}>
        <Text style={s.title}>{label} 우리 가족 효과</Text>
        <Text style={s.total}>요청 총 {r.requests}건</Text>
      </View>
      <View style={s.headline}>
        <MaterialCommunityIcons name="star-four-points" size={18} color={C.success} />
        <Text style={s.headlineText}>{headline(months(period) === 1 && includesNow(period) ? '이번 달' : periodShort(period).replace(/^기간$/, '이 기간'), r)}</Text>
      </View>
      <View style={s.grid}>
        {tiles.map((t) => (
          <View key={t.label} style={[s.tile, t.full && { width: '100%' }, t.bad && { backgroundColor: C.dangerBg }]}>
            <View style={s.tileHead}>
              <MaterialCommunityIcons name={t.icon} size={16} color={t.bad ? C.danger : C.sub} />
              <Text style={[s.label, t.bad && { color: C.danger }]}>{t.label}</Text>
            </View>
            {t.of ? <Text style={s.of}>{t.of}</Text> : null}
            <Text style={[s.value, { color: t.color }, t.of ? { marginTop: 0 } : null]}>{t.value}</Text>
            {t.sub ? <Text style={s.sub}>{t.sub}</Text> : null}
            <View style={s.hint}>
              <MaterialCommunityIcons name={t.hint.icon} size={11} color={t.bad ? C.danger : C.success} />
              <Text style={[s.hintText, { color: t.bad ? C.danger : C.success }]}>{t.hint.text}</Text>
            </View>
          </View>
        ))}
      </View>
      {r.restocked ? (
        <Text style={s.extra}>🔔 재구매 알림을 보고 떨어지기 전에 요청한 물건 {r.restocked}번</Text>
      ) : null}
    </Card>
  );
}

const s = StyleSheet.create({
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 },
  title: { fontSize: 16, fontWeight: '600', color: C.text },
  total: { fontSize: 13, fontWeight: '600', color: C.accent },
  headline: {
    flexDirection: 'row', gap: 8, alignItems: 'flex-start', backgroundColor: C.successBg,
    borderRadius: 10, padding: 12, marginBottom: 10,
  },
  headlineText: { flex: 1, fontSize: 15, fontWeight: '700', color: C.success, lineHeight: 22 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: { width: '48%', flexGrow: 1, backgroundColor: C.bg, borderRadius: 10, padding: 10 },
  tileHead: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  label: { fontSize: 12, color: C.sub },
  value: { fontSize: 20, fontWeight: '700', marginTop: 4 },
  sub: { fontSize: 11, color: C.muted, marginTop: 2 },
  of: { fontSize: 12, color: C.sub, marginTop: 6 },
  hint: {
    flexDirection: 'row', alignItems: 'center', gap: 3, alignSelf: 'flex-start', backgroundColor: C.card,
    borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2, marginTop: 6,
  },
  hintText: { fontSize: 11, fontWeight: '600' },
  extra: { fontSize: 12, color: C.sub, marginTop: 10 },
});
