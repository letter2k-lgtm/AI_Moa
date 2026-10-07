import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { Pill } from '@/components/ui';
import { C } from '@/constants/colors';
import { parseFutureDate, shortDate, snoozeRestock, stopRestock, type Restock } from '@/data/store';
import { confirm, notice } from '@/lib/confirm';

const DAY = 86_400_000;

// 재구매 알림 카드·배너에 붙는 버튼: "아직 남았어요"(미루기) / "이제 안 사요"(그만 받기)
// 미루기 기본은 주기의 절반 뒤. 날짜(11/25)나 일수(15일)를 직접 넣을 수도 있다.
export default function RestockActions({ r, color = C.sub }: { r: Restock; color?: string }) {
  const [open, setOpen] = useState(false);
  const half = Math.max(1, Math.ceil((r.avgDays ?? 14) / 2));
  // 기본: 오늘부터 주기 절반 뒤 오전 9시 (화면이 처음 열릴 때 한 번 계산)
  const [defaultIso] = useState(() => {
    const d = new Date(Date.now() + half * DAY);
    d.setHours(9, 0, 0, 0);
    return d.toISOString();
  });
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      setOpen(false);
      setText('');
    } catch (e) {
      notice('저장하지 못했어요', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const saveSnooze = () => {
    const iso = text.trim() ? parseFutureDate(text) : defaultIso;
    if (!iso) return notice('날짜를 확인해 주세요', '11/25 처럼 날짜를 넣거나, 15일 처럼 며칠 뒤인지 넣어 주세요.');
    run(() => snoozeRestock(r.key, iso));
  };

  const stop = async () => {
    if (!(await confirm('이제 안 사요', `"${r.key}" 재구매 알림을 더 이상 보내지 않을까요?\n재구매 탭 맨 아래에서 다시 켤 수 있어요.`, '알림 끄기'))) return;
    run(() => stopRestock(r.key));
  };

  if (!open) {
    return (
      <View style={s.row}>
        <Text style={[s.link, { color }]} onPress={() => setOpen(true)}>아직 남았어요 (미루기)</Text>
        <Text style={[s.link, { color }]} onPress={stop}>이제 안 사요</Text>
      </View>
    );
  }

  return (
    <View style={s.box}>
      <Text style={s.title}>언제 다시 알려 드릴까요?</Text>
      <View style={s.row}>
        <Pill label={`주기 절반 · ${half}일 뒤 (${shortDate(defaultIso)})`} color={C.accent} bg={C.accentBg} onPress={() => run(() => snoozeRestock(r.key, defaultIso))} />
      </View>
      <View style={[s.row, { marginTop: 8 }]}>
        <TextInput
          style={s.input}
          value={text}
          onChangeText={setText}
          placeholder="직접: 11/25 또는 15일"
          placeholderTextColor={C.muted}
        />
        <Text style={[s.link, { color: C.accent }]} onPress={saveSnooze}>{busy ? '저장 중…' : '이 날로 미루기'}</Text>
      </View>
      <Text style={[s.link, { color: C.muted, marginTop: 8 }]} onPress={() => setOpen(false)}>닫기</Text>
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 16, flexWrap: 'wrap' },
  link: { fontSize: 13, marginTop: 8 },
  box: { marginTop: 8, backgroundColor: C.bg, borderRadius: 10, padding: 10 },
  title: { fontSize: 13, color: C.text, fontWeight: '600', marginBottom: 6 },
  input: {
    flex: 1, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 8, fontSize: 14, color: C.text, marginTop: 8,
  },
});
