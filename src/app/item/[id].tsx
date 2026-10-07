import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import KeyboardScroll from '@/components/keyboard-scroll';

import CategoryPicker from '@/components/category-picker';
import { iconOf, ItemIcon } from '@/components/item-visual';
import OrderForm from '@/components/order-form';
import { Card, Pill, PrimaryButton, SecondaryButton, Section } from '@/components/ui';
import { C } from '@/constants/colors';
import { confirm, notice } from '@/lib/confirm';
import { openLink } from '@/lib/link';
import {
  advance, cancelClaim, categoriesOf, deleteItem, formatDate, frequentPlaces, guessCategory, memberName, receive, rerequest,
  STATUS_INFO, STATUS_ORDER, updateCategory, updateIcon, updatePlace, useStore, won,
} from '@/data/store';

// 아이콘 바꾸기에서 바로 고를 수 있는 이모지 (없으면 아래 칸에 붙여넣기)
const ICON_CHOICES = [
  '🧻', '🧴', '🧼', '🪥', '🧽', '🧺', '🗑️', '🔋', '💡', '🔥', '🛁', '😷',
  '💧', '🥛', '☕', '🍵', '🧃', '🍚', '🍜', '🍞', '🥚', '🧀', '🥩', '🍗',
  '🐟', '🍊', '🍎', '🍌', '🍇', '🍓', '🫐', '🥬', '🥕', '🧅', '🌾', '🍪',
  '🍫', '🥣', '🐶', '🐱', '✏️', '📒', '📚', '✂️', '💊', '👕', '🎁', '📦',
];

export default function ItemDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { items, events, me, members } = useStore();
  const [busy, setBusy] = useState(false);
  const item = items.find((i) => i.id === id);
  const places = frequentPlaces(items);
  const [place, setPlace] = useState(places[0] ?? '');
  const [editingPlace, setEditingPlace] = useState(false);
  const [orderForm, setOrderForm] = useState(false);
  const [receiving, setReceiving] = useState(false);
  const [editingCat, setEditingCat] = useState(false);
  const [catDraft, setCatDraft] = useState('');
  const [editingIcon, setEditingIcon] = useState(false);
  const [iconDraft, setIconDraft] = useState('');

  if (!item) return <Text style={{ padding: 16, color: C.sub }}>카드를 찾을 수 없어요.</Text>;

  const info = STATUS_INFO[item.status];
  const step = STATUS_ORDER.indexOf(item.status);
  const history = events.filter((e) => e.item_id === item.id).reverse();
  const receivedEvent =
    item.status === 'received' ? history.find((e) => e.status === 'received' && !e.note?.startsWith('장소')) : undefined;
  // 산다고 한 사람. 그 사람이 가족에서 빠져서 담당자가 없어졌으면 누구나 이어서 진행할 수 있게 한다
  const assigneeGone = !!item.assignee && !members.some((m) => m.id === item.assignee);
  const isMine = item.assignee === me?.id || ((!item.assignee || assigneeGone) && item.status !== 'needed');
  const isRequester = item.requested_by === me?.id;
  const isLeader = me?.role === '리더'; // 가족을 만든 사람(아빠)

  const run = async (fn: () => Promise<unknown>) => {
    if (busy) return; // 버튼을 두 번 눌러도 한 번만 저장
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      notice('저장하지 못했어요', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    const ok = await confirm(
      item.status === 'needed' || item.status === 'claimed' ? '요청을 지울까요?' : '이 구매 기록을 지울까요?',
      `${item.name}\n지우면 이력과 재구매 계산에서도 빠져요.`,
      '지우기',
    );
    if (ok) run(() => deleteItem(item.id).then(() => router.back()));
  };

  const rows: [string, string | null | undefined][] = [
    ['분류', item.category?.trim() || '기타'],
    ['수량', item.quantity],
    ['요청', memberName(item.requested_by)],
    ['담당', item.assignee ? memberName(item.assignee) : null],
    ['구매처', item.store],
    ['금액', won(item.price) || null],
    ['주문일', item.ordered_at ? formatDate(item.ordered_at).replace(/ \d\d:\d\d$/, '') : null],
    ['받은 날', receivedEvent ? formatDate(receivedEvent.created_at).replace(/ \d\d:\d\d$/, '') : null],
    ['도착', item.status === 'received' ? null : item.eta],
    ['수령', item.status === 'received' ? `${memberName(item.received_by)}${item.received_note ? ` · ${item.received_note}` : ''}` : null],
    ['링크', item.link],
  ];

  return (
    <KeyboardScroll contentContainerStyle={s.container}>
      <Stack.Screen options={{ title: item.name }} />
      <Pill label={info.label} color={info.color} bg={info.bg} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Pressable onPress={() => setEditingIcon((x) => !x)} accessibilityLabel="아이콘 바꾸기">
          <ItemIcon item={item} size={44} />
        </Pressable>
        <Text style={[s.title, { flex: 1 }]}>{item.name}</Text>
        <Text style={s.change} onPress={() => setEditingIcon((x) => !x)}>{editingIcon ? '닫기' : '아이콘 바꾸기'}</Text>
      </View>
      {editingIcon ? (
        <Card style={{ marginTop: 10 }}>
          <Text style={s.hint}>고르면 바로 저장돼요. 같은 물건의 다른 카드에도 이 아이콘이 나와요.</Text>
          <View style={s.emojiGrid}>
            {ICON_CHOICES.map((e) => (
              <Pressable key={e} style={[s.emojiCell, iconOf(item) === e && { borderColor: C.accent }]}
                onPress={() => run(() => updateIcon(item, e).then(() => setEditingIcon(false)))}>
                <Text style={{ fontSize: 24 }}>{e}</Text>
              </Pressable>
            ))}
          </View>
          <View style={[s.row, { alignItems: 'center', gap: 8, marginTop: 8 }]}>
            <TextInput style={[s.input, { flex: 1 }]} value={iconDraft} onChangeText={setIconDraft}
              placeholder="다른 이모지를 붙여넣기 (예: 🫐)" placeholderTextColor={C.muted} />
            {iconDraft.trim() ? (
              <Text style={s.change} onPress={() => run(() => updateIcon(item, iconDraft).then(() => { setEditingIcon(false); setIconDraft(''); }))}>저장</Text>
            ) : null}
          </View>
          {item.icon ? (
            <Text style={[s.change, { marginTop: 10 }]} onPress={() => run(() => updateIcon(item, null).then(() => setEditingIcon(false)))}>
              이름으로 자동 고르기로 되돌리기
            </Text>
          ) : null}
        </Card>
      ) : null}

      <View style={s.steps}>
        {STATUS_ORDER.map((st, i) => (
          <View key={st} style={{ flex: 1, alignItems: 'center' }}>
            <View style={[s.dot, { backgroundColor: i <= step ? C.accent : C.border }]} />
            <Text style={[s.stepLabel, i === step && { color: C.accent }]}>{STATUS_INFO[st].label}</Text>
          </View>
        ))}
      </View>

      <Card style={{ marginTop: 16 }}>
        {rows.filter(([, v]) => v).map(([k, v]) => (
          <View key={k} style={s.row}>
            <Text style={s.key}>{k}</Text>
            <Text
              style={[s.val, k === '링크' && { color: C.accent, textDecorationLine: 'underline' }]}
              numberOfLines={1}
              onPress={k === '링크' ? () => openLink(v!) : undefined}>
              {v}
            </Text>
            {k === '분류' ? (
              <Text style={s.change} onPress={() => setEditingCat((x) => !x)}>{editingCat ? '닫기' : '바꾸기'}</Text>
            ) : null}
          </View>
        ))}
        {editingCat ? (
          <View style={{ marginTop: 8 }}>
            <CategoryPicker
              value={item.category?.trim() || '기타'}
              options={categoriesOf(items)}
              suggested={guessCategory(item.name)}
              onChange={(c) => {
                // 버튼을 고르면 바로 저장. 직접 입력은 글자를 다 쓴 뒤 "저장"으로
                if (categoriesOf(items).includes(c)) run(() => updateCategory(item, c).then(() => setEditingCat(false)));
                else setCatDraft(c);
              }}
            />
            {catDraft && !categoriesOf(items).includes(catDraft) ? (
              <Text style={[s.change, { marginTop: 8 }]}
                onPress={() => run(() => updateCategory(item, catDraft).then(() => { setEditingCat(false); setCatDraft(''); }))}>
                &quot;{catDraft}&quot;(으)로 저장
              </Text>
            ) : null}
          </View>
        ) : null}
      </Card>

      <Section title="기록" />
      {history.map((h) => (
        <View key={h.id} style={s.event}>
          <View style={[s.eventDot, { backgroundColor: STATUS_INFO[h.status].color }]} />
          <View style={{ flex: 1 }}>
            <Text style={s.val}>
              {memberName(h.actor)} · {STATUS_INFO[h.status].label}{h.note ? ` (${h.note})` : ''}
            </Text>
            <Text style={s.key}>{formatDate(h.created_at)}</Text>
          </View>
        </View>
      ))}

      {(item.status === 'shipping' || editingPlace || receiving) && !orderForm ? (
        <>
          <Section title={item.status === 'received' ? '수령 장소 바꾸기' : '어디서 받았나요?'} />
          <View style={s.wrap}>
            {places.map((p) => (
              <Pill key={p} label={p} outline={place !== p} color={place === p ? C.accent : C.sub}
                bg={place === p ? C.accentBg : undefined} onPress={() => setPlace(p)} />
            ))}
          </View>
          <TextInput
            style={s.input}
            value={places.includes(place) ? '' : place}
            onChangeText={setPlace}
            placeholder="직접 입력 (예: 101동 경비실)"
            placeholderTextColor={C.muted}
          />
        </>
      ) : null}

      {orderForm ? (
        <OrderForm item={item} onDone={() => setOrderForm(false)} onCancel={() => setOrderForm(false)} />
      ) : editingPlace ? (
        <PrimaryButton
          label={busy ? '저장 중…' : '장소 저장'}
          onPress={busy ? () => {} : () => run(() => updatePlace(item, place).then(() => setEditingPlace(false)))}
          style={{ marginTop: 24 }}
        />
      ) : receiving ? (
        <PrimaryButton
          label={busy ? '저장 중…' : '받음으로 저장'}
          onPress={busy ? () => {} : () => run(() => receive(item, place).then(() => setReceiving(false)))}
          style={{ marginTop: 24 }}
        />
      ) : (
        <>
          {/* 필요해요: 누구나 살 수 있다 */}
          {item.status === 'needed' ? (
            <>
              <PrimaryButton label={busy ? '저장 중…' : '내가 살게'} onPress={busy ? () => {} : () => run(() => advance(item))} style={{ marginTop: 24 }} />
              <SecondaryButton label="이미 주문했어요" onPress={() => setOrderForm(true)} style={{ marginTop: 10 }} />
            </>
          ) : null}

          {/* 구매 예정: 산다고 한 사람만 주문/담당 취소 */}
          {item.status === 'claimed' && isMine ? (
            <>
              <PrimaryButton label="주문했어요" onPress={() => setOrderForm(true)} style={{ marginTop: 24 }} />
              <SecondaryButton label="담당 취소" onPress={() => run(() => cancelClaim(item))} style={{ marginTop: 10 }} />
            </>
          ) : null}
          {item.status === 'claimed' && !isMine ? (
            <Text style={s.info}>{memberName(item.assignee)}가 사기로 했어요. 주문하면 알려 드릴게요.</Text>
          ) : null}

          {/* 주문완료: 산 사람만 배송 시작(또는 빠른 배송이면 바로 받기). 다른 가족은 기다림 안내만 */}
          {item.status === 'ordered' && isMine ? (
            <>
              <PrimaryButton label={busy ? '저장 중…' : '배송 시작됐어요'} onPress={busy ? () => {} : () => run(() => advance(item))} style={{ marginTop: 24 }} />
              <SecondaryButton label="배송 없이 바로 받았어요" onPress={() => setReceiving(true)} style={{ marginTop: 10 }} />
            </>
          ) : null}
          {item.status === 'ordered' && !isMine ? (
            <Text style={s.info}>{memberName(item.assignee)}가 주문했어요. 배송이 시작되면 알려 드릴게요.</Text>
          ) : null}
          {/* 배송중: 집에 있는 누구나 받을 수 있다 */}
          {item.status === 'shipping' ? (
            <PrimaryButton label={busy ? '저장 중…' : '내가 받았어요'} onPress={busy ? () => {} : () => run(() => receive(item, place))} style={{ marginTop: 24 }} />
          ) : null}

          {/* 요청한 사람: 주문완료 전까지 다시 요청 / 요청 취소 */}
          {isRequester && (item.status === 'needed' || item.status === 'claimed') ? (
            <>
              <SecondaryButton label="다시 요청 (가족에게 알림)" onPress={() => run(() => rerequest(item))} style={{ marginTop: 10 }} />
              <SecondaryButton label="요청 취소" onPress={remove} style={{ marginTop: 10 }} />
            </>
          ) : null}

          {/* 산 사람, 요청한 사람: 구매 정보 수정 / 삭제 */}
          {/* 구매 정보는 산 사람만 고칠 수 있다 */}
          {isMine && ['ordered', 'shipping', 'received'].includes(item.status) ? (
            <SecondaryButton label="구매 정보 수정 (날짜, 금액, 구매처)" onPress={() => setOrderForm(true)} style={{ marginTop: 10 }} />
          ) : null}
          {item.status === 'received' ? (
            <SecondaryButton
              label="수령 장소 바꾸기"
              onPress={() => {
                setPlace(item.received_note ?? '');
                setEditingPlace(true);
              }}
              style={{ marginTop: 10 }}
            />
          ) : null}
          {/* 기록 삭제는 리더(아빠)만. 요청 단계에서 본인 요청이면 위의 "요청 취소"가 대신 보인다 */}
          {isLeader && !(isRequester && (item.status === 'needed' || item.status === 'claimed')) ? (
            <Text style={s.delete} onPress={remove}>이 기록 삭제</Text>
          ) : null}
        </>
      )}
    </KeyboardScroll>
  );
}

const s = StyleSheet.create({
  container: { padding: 16, paddingBottom: 40 },
  title: { fontSize: 20, fontWeight: '600', color: C.text, marginTop: 8 },
  steps: { flexDirection: 'row', marginTop: 20 },
  dot: { width: 12, height: 12, borderRadius: 6 },
  stepLabel: { fontSize: 11, color: C.muted, marginTop: 6 },
  row: { flexDirection: 'row', paddingVertical: 6 },
  key: { width: 60, fontSize: 13, color: C.muted },
  val: { flex: 1, fontSize: 14, color: C.text },
  change: { fontSize: 13, color: C.accent },
  hint: { fontSize: 13, color: C.muted, lineHeight: 19 },
  emojiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  emojiCell: { width: 42, height: 42, borderRadius: 10, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  event: { flexDirection: 'row', gap: 10, paddingVertical: 8 },
  eventDot: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  delete: { color: C.danger, fontSize: 13, textAlign: 'center', marginTop: 20 },
  info: { fontSize: 14, color: C.sub, textAlign: 'center', marginTop: 24, lineHeight: 21 },
  input: {
    backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: C.text, marginTop: 10,
  },
});
