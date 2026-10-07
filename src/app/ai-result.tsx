import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import KeyboardScroll from '@/components/keyboard-scroll';

import CategoryPicker from '@/components/category-picker';
import { itemEmoji } from '@/components/item-visual';
import { Card, Notice, Pill, PrimaryButton, SecondaryButton } from '@/components/ui';
import { C } from '@/constants/colors';
import { confirm, notice } from '@/lib/confirm';
import {
  analyzeImage, categoriesOf, duplicateWarning, fixYear, guessCategory, frequentPlaces, logPrevented, toMonthDay, getPendingImage, matchRequest, memberName,
  isBeforeRequest, parseDateInput, recordOrders, shortDate, useItems, won,
  type Item, type ParsedItem, type ParsedReceipt,
} from '@/data/store';

// category: AI가 고른 분류. 사용자가 바꾸거나 직접 입력할 수 있다
type Row = Omit<ParsedItem, 'category'> & { category: string; include: boolean; priceText: string };
type Delivery = 'ordered' | 'shipping' | 'received';

const DELIVERY: { key: Delivery; label: string; save: string }[] = [
  { key: 'ordered', label: '주문완료', save: '주문완료로' },
  { key: 'shipping', label: '배송중', save: '배송중으로' },
  { key: 'received', label: '받았어요', save: '받음으로' },
];

// AI가 읽은 배송 상태 → 저장할 단계. 서버 함수가 옛 버전이면 도착 문구로 짐작한다.
function toDelivery(r: ParsedReceipt): Delivery {
  if (r.delivery_status === 'delivered') return 'received';
  if (r.delivery_status === 'shipping') return 'shipping';
  if (r.delivery_status === 'ordered') return 'ordered';
  if (/완료|수령|구매확정/.test(r.eta ?? '')) return 'received';
  if (/배송중|출발|출고/.test(r.eta ?? '')) return 'shipping';
  return 'ordered';
}

export default function AiResultScreen() {
  const items = useItems();
  // 카드 상세에서 "캡처로 입력"을 눌렀으면 그 카드에 바로 연결
  const { target } = useLocalSearchParams<{ target?: string }>();
  const targetItem = target ? items.find((i) => i.id === target) : undefined;
  const [image] = useState(getPendingImage);
  const [dateText, setDateText] = useState('');
  const [receivedText, setReceivedText] = useState('');
  const [phase, setPhase] = useState<'reading' | 'done' | 'error'>(image ? 'reading' : 'error');
  const [error, setError] = useState(image ? '' : '사진이 없어요. 다시 골라 주세요.');
  const [receipt, setReceipt] = useState<ParsedReceipt | null>(null);
  const [store, setStore] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [delivery, setDelivery] = useState<Delivery>('ordered');
  const places = frequentPlaces(items);
  const categories = categoriesOf(items);
  const [place, setPlace] = useState(places[0] ?? '');

  const analyze = () => {
    if (!image) return;
    analyzeImage(image)
      .then((r) => {
        setReceipt(r);
        setStore(r.store === '알 수 없음' ? '' : r.store);
        const orderMD = toMonthDay(r.order_date);
        setDateText(orderMD);
        // AI가 받은 날을 못 찾았으면 도착 문구("9/28(일) 도착완료")에서 날짜를 한 번 더 찾는다
        const etaDate = /완료|도착|수령/.test(r.eta ?? '') ? (r.eta ?? '').match(/\d{1,2}\s*[/.월]\s*\d{1,2}/)?.[0] : '';
        const orderIso = orderMD ? parseDateInput(orderMD) : null;
        setReceivedText(toMonthDay(r.delivered_date || etaDate, orderIso));
        setDelivery(toDelivery(r));
        // AI가 "기타"라고 했어도 이름으로 알 수 있으면 그 분류로 (예: 제주귤 → 식품)
        setRows(r.items.map((it) => ({
          ...it,
          category: it.category === '기타' ? guessCategory(it.name) : it.category,
          include: true,
          priceText: it.price ? String(it.price) : '',
        })));
        setPhase('done');
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : String(e));
        setPhase('error');
      });
  };

  // 화면이 열리면 바로 분석 시작 (처음 상태가 이미 'reading')
  useEffect(analyze, [image]);

  const read = () => {
    setPhase('reading');
    setError('');
    analyze();
  };

  // 지금 입력된 주문일 (비어 있으면 오늘) — 요청보다 이전 영수증인지 볼 때 쓴다
  const orderIsoNow = (() => {
    const p = dateText.trim() ? parseDateInput(dateText) : null;
    return p ? fixYear(p) : new Date().toISOString();
  })();

  // 상품마다 연결할 요청 카드 (한 카드는 한 번만). 요청한 날보다 이전 영수증은 연결하지 않고 지난 구매로 저장
  const taken = new Set<string>();
  const skippedOld: (Item | undefined)[] = [];
  const matches = rows.map((r, i) => {
    if (!r.include) return undefined;
    // 대상 카드가 있으면 첫 번째 상품을 그 카드에 연결
    const m = targetItem && !taken.has(targetItem.id) ? targetItem : matchRequest(r.name, items, taken, orderIsoNow);
    if (m) taken.add(m.id);
    // 날짜 때문에 연결하지 않은 같은 물건 요청 (화면에 안내)
    if (!m) skippedOld[i] = matchRequest(r.name, items, taken);
    return m;
  });

  const update = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const chosen = rows.filter((r) => r.include && r.name.trim());

  // 저장 버튼을 빠르게 두 번 눌러도 확인창·저장이 한 번만 (busy 는 확인창 뒤에야 켜져서 따로 막는다)
  const saving = useRef(false);
  const save = async () => {
    if (saving.current) return;
    saving.current = true;
    try {
      await doSave();
    } finally {
      saving.current = false;
    }
  };

  const doSave = async () => {
    // 필수 입력 확인
    const missing = [
      !chosen.length && '저장할 상품 (하나 이상 체크)',
      !store.trim() && '구매처',
      chosen.some((r) => !Number(r.priceText)) && `금액 (${chosen.filter((r) => !Number(r.priceText)).map((r) => r.name).join(', ')})`,
      chosen.some((r) => !r.category.trim()) && `분류 (${chosen.filter((r) => !r.category.trim()).map((r) => r.name).join(', ')})`,
    ].filter(Boolean);
    if (missing.length) {
      setError(`입력해 주세요: ${missing.join(', ')}`);
      return notice('빠진 내용이 있어요', `아래 내용을 입력해 주세요.\n\n· ${missing.join('\n· ')}`);
    }
    const parsedOrder = dateText.trim() ? parseDateInput(dateText) : null;
    const orderedAt = parsedOrder ? fixYear(parsedOrder) : null;
    if (dateText.trim() && !orderedAt) {
      setError('주문일은 9/14 또는 2026-09-14 처럼 입력해 주세요');
      return notice('날짜를 확인해 주세요', '주문일은 9/14 또는 2026-09-14 처럼 입력해 주세요.');
    }
    const parsedReceived = delivery === 'received' && receivedText.trim() ? parseDateInput(receivedText) : null;
    const receivedAt = parsedReceived ? fixYear(parsedReceived, orderedAt) : null;
    if (delivery === 'received' && receivedText.trim() && !parsedReceived) {
      setError('받은 날은 9/14 처럼 입력해 주세요');
      return notice('날짜를 확인해 주세요', '받은 날은 9/14 또는 2026-09-14 처럼 입력해 주세요.');
    }
    // 카드 상세에서 이 카드로 올린 영수증인데 요청한 날보다 이전 날짜면 저장하지 않는다
    if (targetItem && isBeforeRequest(targetItem, orderedAt ?? new Date().toISOString())) {
      const msg = `"${targetItem.name}"은(는) ${shortDate(targetItem.created_at)}에 요청했어요. 그보다 이전(${shortDate(orderedAt!)}) 영수증은 이 요청에 등록할 수 없어요.`;
      setError(msg);
      return notice('요청보다 이전 영수증이에요', `${msg}\n\n주문일이 맞는지 확인해 주세요. 지난 구매 기록이면 보드의 + 버튼에서 올려 주세요.`);
    }
    if (!orderedAt && !(await confirm('주문일이 비어 있어요', '오늘 산 것으로 저장할까요?\n과거 영수증이면 "취소"를 누르고 주문일을 입력해 주세요.', '오늘로 저장'))) return;

    // 중복 구매 확인: 연결할 요청이 없는 새 상품 중 최근에 샀거나 이미 주문 중인 것
    // 요청과 연결되는 상품은 요청할 때 이미 확인했으니, 새로 생기는 상품만 확인
    // 요청보다 이전 영수증이라 연결하지 않은 상품은 그 (더 새) 요청과 겹치는 게 아니라서 묻지 않는다
    const dupRows = rows.filter((r, i) => r.include && r.name.trim() && !matches[i] && !skippedOld[i] && duplicateWarning(r.name, items));
    const dups = dupRows.map((r) => `· ${duplicateWarning(r.name, items)}`);
    if (dups.length && !(await confirm('최근에 산 물건이 있어요', `${dups.join('\n')}\n\n또 산 게 맞나요?`, '저장', '취소'))) {
      logPrevented(dupRows.map((r) => r.name), items);
      return;
    }

    setBusy(true);
    try {
      await recordOrders(
        rows.flatMap((r, i) =>
          r.include && r.name.trim()
            ? [{
                order: {
                  name: r.name.trim(), store: store.trim(), price: Number(r.priceText) || 0,
                  category: r.category, quantity: r.quantity, eta: receipt?.eta, orderedAt: orderedAt ?? undefined,
                  icon: r.emoji || undefined,
                  status: delivery, place: delivery === 'received' ? place : undefined,
                  receivedAt: receivedAt ?? undefined,
                },
                matchId: matches[i]?.id,
              }]
            : [],
        ),
      );
      router.dismissTo('/');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <KeyboardScroll contentContainerStyle={s.container}>
      {image ? <Image source={{ uri: image.uri }} style={s.image} resizeMode="contain" /> : null}

      {phase === 'reading' ? (
        <View style={s.reading}>
          <ActivityIndicator color={C.accent} />
          <Text style={{ color: C.sub, marginTop: 8 }}>AI가 캡처를 읽고 있어요…</Text>
        </View>
      ) : null}

      {phase === 'error' ? (
        <>
          <Notice color={C.danger} bg={C.dangerBg} text={error} />
          <View style={s.buttons}>
            <SecondaryButton label="다른 사진" onPress={() => router.back()} style={{ flex: 1 }} />
            {image ? <PrimaryButton label="다시 읽기" onPress={read} style={{ flex: 1 }} /> : null}
          </View>
        </>
      ) : null}

      {phase === 'done' && receipt ? (
        <>
          <Card style={{ marginTop: 12 }}>
            <View style={s.row}>
              <Text style={s.key}>구매처</Text>
              <TextInput style={s.input} value={store} onChangeText={setStore} placeholder="쿠팡" placeholderTextColor={C.muted} />
            </View>
            <View style={s.row}>
              <Text style={s.key}>주문일</Text>
              <TextInput style={s.input} value={dateText} onChangeText={(t) => { setDateText(t); setError(''); }}
                placeholder="비우면 오늘 (예: 9/14)" placeholderTextColor={C.muted} />
            </View>
            {receipt.eta ? (
              <View style={s.row}>
                <Text style={s.key}>도착</Text>
                <Text style={s.val}>{receipt.eta}</Text>
              </View>
            ) : null}
            {receipt.total ? (
              <View style={s.row}>
                <Text style={s.key}>총액</Text>
                <Text style={s.val}>{won(receipt.total)}</Text>
              </View>
            ) : null}
            <View style={[s.row, { alignItems: 'flex-start', marginTop: 4 }]}>
              <Text style={[s.key, { marginTop: 4 }]}>상태</Text>
              <View style={s.pills}>
                {DELIVERY.map((d) => (
                  <Pill key={d.key} label={d.label} outline={delivery !== d.key}
                    color={delivery === d.key ? C.accent : C.sub} bg={delivery === d.key ? C.accentBg : undefined}
                    onPress={() => setDelivery(d.key)} />
                ))}
              </View>
            </View>
            {delivery === 'received' ? (
              <View style={s.row}>
                <Text style={s.key}>받은 날</Text>
                <TextInput style={s.input} value={receivedText} onChangeText={(t) => { setReceivedText(t); setError(''); }}
                  placeholder="비우면 주문일 (예: 9/14)" placeholderTextColor={C.muted} />
              </View>
            ) : null}
            {delivery === 'received' ? (
              <View style={[s.row, { alignItems: 'flex-start' }]}>
                <Text style={[s.key, { marginTop: 4 }]}>수령</Text>
                <View style={{ flex: 1 }}>
                  <View style={s.pills}>
                    {places.map((p) => (
                      <Pill key={p} label={p} outline={place !== p} color={place === p ? C.accent : C.sub}
                        bg={place === p ? C.accentBg : undefined} onPress={() => setPlace(p)} />
                    ))}
                  </View>
                  <TextInput style={[s.input, { marginTop: 6 }]} value={places.includes(place) ? '' : place}
                    onChangeText={setPlace} placeholder="직접 입력 (예: 매장에서 직접)" placeholderTextColor={C.muted} />
                </View>
              </View>
            ) : null}
          </Card>

          <Text style={s.section}>상품 {rows.length}개 · 저장할 것만 체크하세요</Text>
          {!rows.length ? (
            <Notice color={C.sub} bg="#ECEAE4" text="상품을 찾지 못했어요. 상품 목록이 보이게 다시 캡처해 주세요." />
          ) : null}

          {rows.map((r, i) => (
            <Card key={i} style={!r.include ? { opacity: 0.5 } : undefined}>
              <View style={s.itemTop}>
                <Pressable onPress={() => update(i, { include: !r.include })} hitSlop={8} accessibilityLabel="저장할지 선택">
                  <MaterialCommunityIcons
                    name={r.include ? 'checkbox-marked' : 'checkbox-blank-outline'}
                    size={22}
                    color={r.include ? C.accent : C.muted}
                  />
                </Pressable>
                <Text style={{ fontSize: 22 }}>{r.emoji || itemEmoji(r.name, r.category)}</Text>
                <TextInput style={[s.input, { flex: 1 }]} value={r.name} onChangeText={(t) => update(i, { name: t })} multiline />
              </View>
              <View style={[s.itemTop, { marginTop: 6 }]}>
                <Text style={s.key}>금액</Text>
                <TextInput
                  style={[s.input, { width: 110 }]}
                  value={r.priceText}
                  onChangeText={(t) => update(i, { priceText: t.replace(/[^0-9]/g, '') })}
                  keyboardType="number-pad"
                  placeholder="0"
                  placeholderTextColor={C.muted}
                />
                <Text style={s.val}>원{r.quantity > 1 ? ` · ${r.quantity}개` : ''}</Text>
              </View>
              <View style={{ marginTop: 8 }}>
                <Text style={[s.key, { marginBottom: 6 }]}>분류</Text>
                <CategoryPicker
                  value={r.category}
                  options={categories}
                  suggested={guessCategory(r.name)}
                  error={r.include && !r.category.trim()}
                  onChange={(c) => update(i, { category: c })}
                />
              </View>
              {!matches[i] && skippedOld[i] ? (
                <Text style={s.oldNote}>
                  요청 &quot;{skippedOld[i]!.name}&quot;({shortDate(skippedOld[i]!.created_at)})보다 이전 영수증이라 연결하지 않고 지난 구매로 저장해요
                </Text>
              ) : null}
              {matches[i] ? (
                <Text style={s.match}>
                  <MaterialCommunityIcons name="link-variant" size={13} /> 요청 &quot;{matches[i]!.name}&quot;
                  ({memberName(matches[i]!.requested_by)})과 연결돼요
                </Text>
              ) : null}
            </Card>
          ))}

          {error ? <Text style={s.error}>{error}</Text> : null}
          <View style={s.buttons}>
            <SecondaryButton label="다른 사진" onPress={() => router.back()} style={{ flex: 1 }} />
            <PrimaryButton
              label={busy ? '저장 중…' : `${chosen.length}개 ${DELIVERY.find((d) => d.key === delivery)!.save} 저장`}
              onPress={busy ? () => {} : save}
              style={{ flex: 2 }}
            />
          </View>
          <Text style={s.note}>AI가 잘못 읽은 글자는 눌러서 고칠 수 있어요.</Text>
        </>
      ) : null}
    </KeyboardScroll>
  );
}

const s = StyleSheet.create({
  container: { padding: 16, paddingBottom: 40 },
  image: { height: 200, borderRadius: 12, backgroundColor: '#ECEAE4' },
  reading: { alignItems: 'center', paddingVertical: 32 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  key: { width: 56, fontSize: 13, color: C.muted },
  val: { fontSize: 14, color: C.text },
  input: {
    flex: 1, fontSize: 15, color: C.text, paddingVertical: 6, paddingHorizontal: 8,
    borderWidth: 1, borderColor: C.border, borderRadius: 8, backgroundColor: C.bg,
  },
  section: { fontSize: 13, color: C.sub, marginTop: 18, marginBottom: 8 },
  itemTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pills: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  match: { fontSize: 12, color: C.accent, marginTop: 8 },
  oldNote: { fontSize: 12, color: C.warning, marginTop: 8 },
  error: { color: C.danger, fontSize: 13, marginTop: 10 },
  buttons: { flexDirection: 'row', gap: 8, marginTop: 20 },
  note: { fontSize: 12, color: C.muted, textAlign: 'center', marginTop: 10 },
});
