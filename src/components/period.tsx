import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useState, useSyncExternalStore } from 'react';
import { AppState, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { Pill, PrimaryButton } from '@/components/ui';
import { C } from '@/constants/colors';

// 보드·이력·가족 탭이 함께 쓰는 조회 기간. 기본은 이번 달, 앱을 새로 열면 다시 이번 달.

export type YM = { y: number; m: number };
export type Period = { from: YM; to: YM };

const nowYM = (): YM => {
  const d = new Date();
  return { y: d.getFullYear(), m: d.getMonth() + 1 };
};
const idx = (a: YM) => a.y * 12 + (a.m - 1);
const fromIdx = (i: number): YM => ({ y: Math.floor(i / 12), m: (i % 12) + 1 });

let period: Period = { from: nowYM(), to: nowYM() };
let shownMonth = nowYM(); // 기간을 정할 때의 "이번 달"
const listeners = new Set<() => void>();
const setPeriod = (p: Period) => {
  period = idx(p.from) <= idx(p.to) ? p : { from: p.to, to: p.from };
  shownMonth = nowYM();
  listeners.forEach((l) => l());
};

// 앱을 켜 둔 채 달이 바뀌면(10/31 → 11/1) "이번 달"을 보고 있던 화면은 새 달로 넘긴다
AppState.addEventListener('change', (s) => {
  if (s !== 'active') return;
  const now = nowYM();
  if (idx(now) === idx(shownMonth)) return;
  const wasThisMonth = idx(period.to) === idx(shownMonth);
  if (wasThisMonth) setPeriod({ from: fromIdx(idx(period.from) + idx(now) - idx(shownMonth)), to: now });
  else shownMonth = now;
});

export function usePeriod() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => period,
  );
}

export const months = (p: Period) => idx(p.to) - idx(p.from) + 1;

// 이번 달이 기간 안에 들어 있는지 (진행 중인 카드를 보여줄지 결정)
export const includesNow = (p: Period) => {
  const n = idx(nowYM());
  return idx(p.from) <= n && n <= idx(p.to);
};

export const inPeriod = (p: Period, iso: string) => {
  const d = new Date(iso);
  const i = d.getFullYear() * 12 + d.getMonth();
  return idx(p.from) <= i && i <= idx(p.to);
};

export function periodLabel(p: Period) {
  if (months(p) === 1) return `${p.from.y}년 ${p.from.m}월`;
  if (p.from.y === p.to.y) return `${p.from.y}년 ${p.from.m}~${p.to.m}월`;
  return `${p.from.y}.${p.from.m} ~ ${p.to.y}.${p.to.m}`;
}

// 짧은 이름: "10월", "1~9월"
export function periodShort(p: Period) {
  if (months(p) === 1) return `${p.from.m}월`;
  if (p.from.y === p.to.y) return `${p.from.m}~${p.to.m}월`;
  return '기간';
}

// ◀ 2026년 10월 ▶ [기간]
export function PeriodBar() {
  const p = usePeriod();
  const [open, setOpen] = useState(false);
  const len = months(p);
  const atNow = idx(p.to) >= idx(nowYM());

  const shift = (dir: number) =>
    setPeriod({ from: fromIdx(idx(p.from) + dir * len), to: fromIdx(idx(p.to) + dir * len) });

  return (
    <View style={s.bar}>
      <Pressable onPress={() => shift(-1)} hitSlop={10} accessibilityLabel="이전 기간">
        <MaterialCommunityIcons name="chevron-left" size={26} color={C.text} />
      </Pressable>
      <Pressable onPress={() => setOpen(true)} style={s.labelBox} accessibilityLabel="기간 선택">
        <Text style={s.label}>{periodLabel(p)}</Text>
        <MaterialCommunityIcons name="calendar-range" size={16} color={C.accent} />
      </Pressable>
      <Pressable onPress={() => !atNow && shift(1)} hitSlop={10} accessibilityLabel="다음 기간" disabled={atNow}>
        <MaterialCommunityIcons name="chevron-right" size={26} color={atNow ? C.border : C.text} />
      </Pressable>
      {open ? <PeriodPicker initial={p} onClose={() => setOpen(false)} /> : null}
    </View>
  );
}

function PeriodPicker({ initial, onClose }: { initial: Period; onClose: () => void }) {
  const now = nowYM();
  const [year, setYear] = useState(initial.to.y);
  const [from, setFrom] = useState<YM | null>(initial.from);
  const [to, setTo] = useState<YM | null>(initial.to);

  const apply = (p: Period) => {
    setPeriod(p);
    onClose();
  };

  const presets: { label: string; p: Period }[] = [
    { label: '이번 달', p: { from: now, to: now } },
    { label: '지난달', p: { from: fromIdx(idx(now) - 1), to: fromIdx(idx(now) - 1) } },
    { label: '최근 3개월', p: { from: fromIdx(idx(now) - 2), to: now } },
    { label: '올해', p: { from: { y: now.y, m: 1 }, to: now } },
  ];

  // 월을 누르면: 처음 누른 달 = 시작, 두 번째 누른 달 = 끝
  const tap = (m: number) => {
    const ym = { y: year, m };
    if (!from || (from && to)) {
      setFrom(ym);
      setTo(null);
    } else {
      setTo(ym);
    }
  };

  const sel = (m: number) => {
    const i = idx({ y: year, m });
    if (!from) return 'none';
    const a = idx(from);
    const b = to ? idx(to) : a;
    const [lo, hi] = a <= b ? [a, b] : [b, a];
    if (i === lo || i === hi) return 'edge';
    if (i > lo && i < hi) return 'mid';
    return 'none';
  };

  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose}>
        <Pressable style={s.sheet} onPress={() => {}}>
          <Text style={s.title}>조회 기간</Text>

          <View style={s.presets}>
            {presets.map((x) => (
              <Pill key={x.label} label={x.label} outline color={C.accent} onPress={() => apply(x.p)} />
            ))}
          </View>

          <Text style={s.hint}>직접 선택: 시작 월과 끝 월을 차례로 누르세요</Text>
          <View style={s.yearRow}>
            <Pressable onPress={() => setYear(year - 1)} hitSlop={10} accessibilityLabel="이전 해">
              <MaterialCommunityIcons name="chevron-left" size={24} color={C.text} />
            </Pressable>
            <Text style={s.year}>{year}년</Text>
            <Pressable onPress={() => year < now.y && setYear(year + 1)} hitSlop={10} accessibilityLabel="다음 해">
              <MaterialCommunityIcons name="chevron-right" size={24} color={year < now.y ? C.text : C.border} />
            </Pressable>
          </View>

          <View style={s.grid}>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
              const future = idx({ y: year, m }) > idx(now);
              const state = sel(m);
              return (
                <Pressable
                  key={m}
                  disabled={future}
                  onPress={() => tap(m)}
                  style={[
                    s.cell,
                    state === 'mid' && { backgroundColor: C.accentBg },
                    state === 'edge' && { backgroundColor: C.accent },
                    future && { opacity: 0.3 },
                  ]}>
                  <Text style={[s.cellText, state === 'edge' && { color: '#fff', fontWeight: '600' }]}>{m}월</Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={s.picked}>
            {from ? `${from.y}.${from.m}` : '시작 월'} ~ {to ? `${to.y}.${to.m}` : from ? `${from.y}.${from.m}` : '끝 월'}
          </Text>
          <PrimaryButton
            label="이 기간으로 보기"
            onPress={() => from && apply({ from, to: to ?? from })}
            style={{ marginTop: 12 }}
          />
          <Text style={s.cancel} onPress={onClose}>닫기</Text>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, marginBottom: 12 },
  labelBox: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 16, borderWidth: 1, borderColor: C.border, backgroundColor: C.card,
  },
  label: { fontSize: 16, fontWeight: '600', color: C.text },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: C.card, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 20, paddingBottom: 32 },
  title: { fontSize: 17, fontWeight: '700', color: C.text },
  presets: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  hint: { fontSize: 13, color: C.sub, marginTop: 18 },
  yearRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 20, marginTop: 10 },
  year: { fontSize: 16, fontWeight: '600', color: C.text },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  cell: { width: '22%', flexGrow: 1, paddingVertical: 10, borderRadius: 8, alignItems: 'center', backgroundColor: C.bg },
  cellText: { fontSize: 14, color: C.text },
  picked: { fontSize: 14, color: C.accent, textAlign: 'center', marginTop: 12, fontWeight: '600' },
  cancel: { fontSize: 13, color: C.muted, textAlign: 'center', marginTop: 12 },
});
