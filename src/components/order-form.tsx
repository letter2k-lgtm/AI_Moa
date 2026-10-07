import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Pill, PrimaryButton, SecondaryButton, Section } from '@/components/ui';
import { C } from '@/constants/colors';
import {
  duplicateWarning, fixYear, frequentPlaces, frequentStores, isBeforeRequest, logPrevented, parseDateInput, saveOrderInfo, shortDate,
  useItems, type Item,
} from '@/data/store';
import { pickReceiptImage } from '@/lib/capture';
import { confirm, notice } from '@/lib/confirm';
import { extractUrl } from '@/lib/link';

type Mode = 'manual' | 'capture' | 'link';

const MODES: { key: Mode; label: string; icon: keyof typeof MaterialCommunityIcons.glyphMap }[] = [
  { key: 'manual', label: '직접 입력', icon: 'pencil-outline' },
  { key: 'capture', label: '캡처/영수증', icon: 'camera-outline' },
  { key: 'link', label: '링크', icon: 'link-variant' },
];

const STORE_BY_DOMAIN: [RegExp, string][] = [
  [/coupang/i, '쿠팡'], [/naver/i, '네이버'], [/11st/i, '11번가'], [/gmarket/i, 'G마켓'], [/auction/i, '옥션'],
  [/ssg/i, 'SSG'], [/yes24/i, 'YES24'], [/kyobo/i, '교보문고'], [/daiso/i, '다이소'], [/kurly/i, '컬리'],
];

const DELIVERY: { key: 'ordered' | 'shipping' | 'received'; label: string; save: string }[] = [
  { key: 'ordered', label: '주문완료', save: '주문완료로' },
  { key: 'shipping', label: '배송중', save: '배송중으로' },
  { key: 'received', label: '이미 받았어요', save: '받음으로' },
];

const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(12, 0, 0, 0);
  return d.toISOString();
};

// 주문 정보 입력 / 수정. 처음 주문할 때도, 이미 산 카드를 고칠 때도 쓴다.
export default function OrderForm({ item, onDone, onCancel }: { item: Item; onDone: () => void; onCancel: () => void }) {
  const items = useItems();
  const stores = frequentStores(items);
  const editing = item.status !== 'needed' && item.status !== 'claimed';

  const [mode, setMode] = useState<Mode>('manual');
  const [store, setStore] = useState(item.store ?? '');
  const [price, setPrice] = useState(item.price != null ? String(item.price) : '');
  const [dateIso, setDateIso] = useState(item.ordered_at ?? daysAgo(0));
  const [dateText, setDateText] = useState('');
  const [link, setLink] = useState(item.link ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [delivery, setDelivery] = useState<'ordered' | 'shipping' | 'received'>('ordered');
  const [receivedText, setReceivedText] = useState('');
  const places = frequentPlaces(items);
  const [place, setPlace] = useState(places[0] ?? '');

  const quickDates = [
    { label: '오늘', iso: daysAgo(0) },
    { label: '어제', iso: daysAgo(1) },
    { label: '그저께', iso: daysAgo(2) },
  ];
  const sameDay = (a: string, b: string) => new Date(a).toDateString() === new Date(b).toDateString();

  const onLink = (text: string) => {
    const url = extractUrl(text) ?? text;
    setLink(url);
    const guess = STORE_BY_DOMAIN.find(([re]) => re.test(url))?.[1];
    if (guess && !store) setStore(guess);
  };

  const capture = async (source: 'camera' | 'library') => {
    setError('');
    const r = await pickReceiptImage(source);
    if (r === 'ok') router.push({ pathname: '/ai-result', params: { target: item.id } });
    else if (r !== 'canceled') setError(r);
  };

  const save = async () => {
    let iso = dateIso;
    if (dateText.trim()) {
      const parsed = parseDateInput(dateText);
      if (!parsed) return setError('날짜는 9/14 처럼 입력해 주세요');
      iso = fixYear(parsed);
    }
    const parsedReceived = delivery === 'received' && receivedText.trim() ? parseDateInput(receivedText) : null;
    if (delivery === 'received' && receivedText.trim() && !parsedReceived) return setError('받은 날은 9/14 처럼 입력해 주세요');
    const receivedAt = parsedReceived ? fixYear(parsedReceived, iso) : null;
    // 요청 카드에 요청한 날보다 이전 주문일로는 등록하지 않는다 (지난 영수증이 이 요청의 구매가 될 수 없음)
    if (!editing && isBeforeRequest(item, iso)) {
      const msg = `${shortDate(item.created_at)}에 요청한 물건이에요. 그보다 이전(${shortDate(iso)}) 날짜로는 등록할 수 없어요.`;
      setError(msg);
      return notice('요청보다 이전 날짜예요', `${msg}\n\n주문일을 확인해 주세요.`);
    }
    const missing = [!store.trim() && '구매처', !Number(price) && '금액'].filter(Boolean);
    if (missing.length) {
      setError(`입력해 주세요: ${missing.join(', ')}`);
      return notice('빠진 내용이 있어요', `아래 내용을 입력해 주세요.\n\n· ${missing.join('\n· ')}`);
    }
    if (!editing) {
      const dup = duplicateWarning(item.name, items, item.id);
      if (dup && !(await confirm('최근에 산 물건이에요', `${dup}\n\n또 산 게 맞나요?`, '저장'))) {
        logPrevented(item.name, items);
        return;
      }
    }
    setBusy(true);
    try {
      await saveOrderInfo(item, {
        store, price: price ? Number(price) : null, orderedAt: iso, link: link.trim() || null,
        status: delivery, place: delivery === 'received' ? place : undefined,
        receivedAt: receivedAt ?? undefined,
      });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <View style={s.box}>
      <Text style={s.title}>{editing ? '구매 정보 수정' : '어떻게 주문했나요?'}</Text>

      <View style={s.modes}>
        {MODES.map((m) => {
          const on = mode === m.key;
          return (
            <Pressable key={m.key} onPress={() => setMode(m.key)} style={[s.mode, on && { borderColor: C.accent, borderWidth: 2 }]}>
              <MaterialCommunityIcons name={m.icon} size={20} color={on ? C.accent : C.text} />
              <Text style={{ fontSize: 12, marginTop: 2, color: on ? C.accent : C.text }}>{m.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {mode === 'capture' ? (
        <>
          <Text style={s.hint}>AI가 구매처, 금액, 주문일을 읽어서 이 카드에 넣어요.</Text>
          <PrimaryButton label="앨범에서 캡처 고르기" onPress={() => capture('library')} style={{ marginTop: 12 }} />
          <SecondaryButton label="영수증 사진 찍기" onPress={() => capture('camera')} style={{ marginTop: 8 }} />
        </>
      ) : (
        <>
          {mode === 'link' ? (
            <>
              <Section title="구매 링크" />
              <TextInput style={s.input} value={link} onChangeText={onLink} autoCapitalize="none"
                placeholder="쇼핑앱 공유하기 → 복사한 내용 붙여넣기" placeholderTextColor={C.muted} />
            </>
          ) : null}

          <Section title="구매처 *" />
          <View style={s.wrap}>
            {stores.map((p) => (
              <Pill key={p} label={p} outline={store !== p} color={store === p ? C.accent : C.sub}
                bg={store === p ? C.accentBg : undefined} onPress={() => setStore(p)} />
            ))}
          </View>
          <TextInput style={s.input} value={stores.includes(store) ? '' : store} onChangeText={setStore}
            placeholder="직접 입력 (예: 동네 마트)" placeholderTextColor={C.muted} />

          <Section title="금액 (원) *" />
          <TextInput style={s.input} value={price} onChangeText={(t) => setPrice(t.replace(/[^0-9]/g, ''))}
            keyboardType="number-pad" placeholder="18900" placeholderTextColor={C.muted} />

          <Section title="주문일 / 영수증 날짜" right={shortDate(dateText ? parseDateInput(dateText) ?? dateIso : dateIso)} />
          <View style={s.wrap}>
            {quickDates.map((q) => {
              const on = !dateText && sameDay(dateIso, q.iso);
              return (
                <Pill key={q.label} label={q.label} outline={!on} color={on ? C.accent : C.sub}
                  bg={on ? C.accentBg : undefined} onPress={() => { setDateIso(q.iso); setDateText(''); }} />
              );
            })}
          </View>
          <TextInput style={s.input} value={dateText} onChangeText={(t) => { setDateText(t); setError(''); }}
            placeholder="다른 날짜 (예: 9/14)" placeholderTextColor={C.muted} />

          {!editing ? (
            <>
              <Section title="지금 상태" />
              <View style={s.wrap}>
                {DELIVERY.map((d) => (
                  <Pill key={d.key} label={d.label} outline={delivery !== d.key}
                    color={delivery === d.key ? C.accent : C.sub} bg={delivery === d.key ? C.accentBg : undefined}
                    onPress={() => setDelivery(d.key)} />
                ))}
              </View>
              {delivery === 'received' ? (
                <>
                  <Section title="받은 날" />
                  <TextInput style={s.input} value={receivedText} onChangeText={(t) => { setReceivedText(t); setError(''); }}
                    placeholder="주문일과 다르면 입력 (예: 9/14)" placeholderTextColor={C.muted} />
                  <Section title="어디서 받았나요?" />
                  <View style={s.wrap}>
                    {places.map((p) => (
                      <Pill key={p} label={p} outline={place !== p} color={place === p ? C.accent : C.sub}
                        bg={place === p ? C.accentBg : undefined} onPress={() => setPlace(p)} />
                    ))}
                  </View>
                  <TextInput style={s.input} value={places.includes(place) ? '' : place} onChangeText={setPlace}
                    placeholder="직접 입력 (예: 매장에서 직접)" placeholderTextColor={C.muted} />
                </>
              ) : null}
            </>
          ) : null}

          {error ? <Text style={s.error}>{error}</Text> : null}
          <PrimaryButton
            label={busy ? '저장 중…' : editing ? '수정 저장' : `${DELIVERY.find((d) => d.key === delivery)!.save} 저장`}
            onPress={busy ? () => {} : save} style={{ marginTop: 16 }} />
        </>
      )}
      {mode === 'capture' && error ? <Text style={s.error}>{error}</Text> : null}
      <Text style={s.cancel} onPress={onCancel}>닫기</Text>
    </View>
  );
}

const s = StyleSheet.create({
  box: { backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 14, marginTop: 20 },
  title: { fontSize: 16, fontWeight: '600', color: C.text, marginBottom: 10 },
  modes: { flexDirection: 'row', gap: 6 },
  mode: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: C.border },
  hint: { fontSize: 13, color: C.sub, marginTop: 12 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  input: {
    backgroundColor: C.bg, borderWidth: 1, borderColor: C.border, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: C.text, marginTop: 8,
  },
  error: { color: C.danger, fontSize: 13, marginTop: 10 },
  cancel: { color: C.muted, fontSize: 13, textAlign: 'center', marginTop: 14 },
});
