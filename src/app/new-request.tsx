import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import KeyboardScroll from '@/components/keyboard-scroll';

import CategoryPicker from '@/components/category-picker';
import { Notice, Pill, PrimaryButton, SecondaryButton, Section } from '@/components/ui';
import { C } from '@/constants/colors';
import {
  addItem, categoriesOf, duplicateWarning, findOpenRequest, findPastPurchase, guessCategory, logPrevented, memberName, priceLabel,
  priceStats, shortDate, STATUS_INFO, timeAgo, useStore, won,
} from '@/data/store';
import { confirm, notice } from '@/lib/confirm';
import { pickReceiptImage } from '@/lib/capture';
import { extractUrl, fetchLinkTitle } from '@/lib/link';

type Mode = 'text' | 'capture' | 'link';

const MODES: { key: Mode; label: string; icon: keyof typeof MaterialCommunityIcons.glyphMap }[] = [
  { key: 'text', label: '직접 입력', icon: 'pencil-outline' },
  { key: 'capture', label: '캡처/영수증', icon: 'camera-outline' },
  { key: 'link', label: '링크', icon: 'link-variant' },
];

export default function NewRequestScreen() {
  const [mode, setMode] = useState<Mode>('text');
  const [name, setName] = useState('');
  const [link, setLink] = useState('');
  const [quantity, setQuantity] = useState('1개');
  const [urgent, setUrgent] = useState(false);
  const [assignee, setAssignee] = useState<string | undefined>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const { items, members } = useStore();
  // 분류: 고른 것 또는 직접 입력. 비어 있으면 보내기 전에 알려 준다
  const [category, setCategory] = useState('');
  const [catError, setCatError] = useState('');
  const categories = categoriesOf(items);
  const suggested = name.trim() ? guessCategory(name.trim()) : null;
  // 수량: 버튼 또는 직접 입력
  const [qtyCustomOn, setQtyCustomOn] = useState(false);
  const [qtyText, setQtyText] = useState('');
  const finalQuantity = qtyCustomOn ? qtyText.trim() : quantity;
  // 한 번에 여러 개 요청 (예: 국어노트, 연필, 문제집). 물건마다 카드가 따로 생겨서 구매 주기도 따로 잡힌다.
  // 분류·언제·누가는 함께 쓰고, 수량은 줄마다 적을 수 있다 (비우면 아래 수량)
  const [extras, setExtras] = useState<{ name: string; qty: string }[]>([]);
  const updateExtra = (i: number, patch: Partial<{ name: string; qty: string }>) =>
    setExtras((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  const past = findPastPurchase(name.trim(), items);
  const open = findOpenRequest(name.trim(), items);
  const stats = priceStats(name.trim(), items);
  const [linkInfo, setLinkInfo] = useState('');

  // 공유하기로 복사한 글에는 "상품명 + 링크"가 같이 들어 있다. 링크는 따로 저장하고 상품명은 자동으로 채운다.
  const onLinkChange = async (text: string) => {
    const url = extractUrl(text);
    if (!url) {
      setLink(text);
      return;
    }
    setLink(url);
    const shared = text
      .replace(url, '')
      .replace(/^\s*\[[^\]]*\]\s*/, '') // "[쿠팡]" 같은 앞머리 제거
      .replace(/\s+/g, ' ')
      .trim();
    if (shared.length >= 2 && !name.trim()) {
      setName(shared.slice(0, 80));
      return;
    }
    if (name.trim()) return;
    setLinkInfo('상품명을 가져오는 중…');
    const title = await fetchLinkTitle(url);
    if (title) setName((n) => n || title);
    setLinkInfo(title ? '' : '상품명을 가져오지 못했어요. 아래에 직접 입력해 주세요.');
  };

  // 보내기를 빠르게 두 번 눌러도 확인창·요청이 한 번만
  const sending = useRef(false);
  const submit = async () => {
    if (sending.current) return;
    sending.current = true;
    try {
      await doSubmit();
    } finally {
      sending.current = false;
    }
  };

  const doSubmit = async () => {
    if (!name.trim()) {
      setError('물건 이름을 입력하세요');
      return;
    }
    if (!category) {
      setCatError('분류를 골라 주세요');
      notice('분류를 골라 주세요', '생활용품, 식품 같은 분류를 고르거나 "+ 직접 입력"으로 분류 이름을 적어 주세요.\n구매 이력에서 분류별로 볼 때 쓰여요.');
      return;
    }
    if (!finalQuantity) {
      notice('수량을 적어 주세요', '"직접 입력"을 골랐어요. 수량(예: 5kg, 2묶음)을 적어 주세요.');
      return;
    }
    // 요청할 물건 목록 (같은 이름은 한 번만)
    let list = [
      { name: name.trim(), quantity: finalQuantity },
      ...(mode === 'text' ? extras : [])
        .filter((x) => x.name.trim())
        .map((x) => ({ name: x.name.trim(), quantity: x.qty.trim() || finalQuantity })),
    ].filter((x, i, all) => all.findIndex((y) => y.name === x.name) === i);

    // 화면의 경고를 못 보고 지나치는 경우가 많아서 보내기 전에 한 번 더 묻는다
    if (list.length === 1) {
      const dup = duplicateWarning(name.trim(), items);
      const priceTip = stats && stats.count > 1 ? `\n(최저가는 ${priceLabel(stats.min)}였어요)` : '';
      if (dup && !(await confirm('최근에 산 물건이에요', `${dup}${priceTip}\n\n또 살까요?`, '요청하기', '안 살래요'))) {
        logPrevented(name.trim(), items); // 중복 구매를 막은 기록 → 효과 리포트
        return;
      }
    } else {
      // 여러 개: 최근에 산 물건만 빼고 요청할 수 있게
      const dups = list.filter((x) => duplicateWarning(x.name, items));
      if (dups.length) {
        const keep = await confirm(
          '최근에 산 물건이 있어요',
          `${dups.map((x) => `· ${duplicateWarning(x.name, items)}`).join('\n')}\n\n이 물건도 같이 요청할까요?\n"빼고 요청"을 누르면 나머지만 요청해요.`,
          '모두 요청',
          '빼고 요청',
        );
        if (!keep) {
          logPrevented(dups.map((x) => x.name), items); // 중복 구매를 막은 기록 → 효과 리포트
          list = list.filter((x) => !dups.includes(x));
          if (!list.length) return;
        }
      }
    }

    setBusy(true);
    try {
      // 물건마다 카드를 따로 만든다 (링크는 첫 번째 물건에만)
      for (const [i, x] of list.entries()) {
        await addItem({
          name: x.name, quantity: x.quantity, urgent, assignee, category,
          link: i === 0 && x.name === name.trim() ? link.trim() || undefined : undefined,
        });
      }
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <KeyboardScroll contentContainerStyle={s.container}>
      <View style={s.modes}>
        {MODES.map((m) => {
          const on = mode === m.key;
          return (
            <Pressable
              key={m.key}
              onPress={() => setMode(m.key)}
              style={[s.mode, on && { borderColor: C.accent, borderWidth: 2 }]}>
              <MaterialCommunityIcons name={m.icon} size={24} color={on ? C.accent : C.text} />
              <Text style={{ fontSize: 12, marginTop: 4, color: on ? C.accent : C.text }}>{m.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {mode === 'capture' ? (
        <CapturePanel />
      ) : (
      <>
      {mode === 'link' ? (
        <>
          <Section title="쇼핑몰 링크" />
          <TextInput
            style={s.input}
            value={link}
            onChangeText={onLinkChange}
            placeholder="쇼핑앱에서 공유하기 → 복사한 내용을 붙여넣기"
            placeholderTextColor={C.muted}
            autoCapitalize="none"
            multiline
          />
          {linkInfo ? <Text style={{ fontSize: 12, color: C.muted, marginTop: 6 }}>{linkInfo}</Text> : null}
        </>
      ) : null}

      <Section title="물건 이름" />
      <TextInput
        style={[s.input, error ? { borderColor: C.danger } : null]}
        value={name}
        onChangeText={(t) => {
          setName(t);
          setError('');
        }}
        placeholder="두루마리 휴지"
        placeholderTextColor={C.muted}
      />
      {error ? <Text style={{ color: C.danger, fontSize: 13, marginTop: 6 }}>{error}</Text> : null}

      {open ? (
        <Notice
          color={C.danger}
          bg={C.dangerBg}
          icon={<MaterialCommunityIcons name="alert-circle-outline" size={18} color={C.danger} />}
          text={
            open.status === 'needed'
              ? `이미 ${memberName(open.requested_by)}가 "${open.name}"을(를) 요청해 뒀어요 (${timeAgo(open.created_at)}). 또 요청할까요?`
              : `"${open.name}"은(는) 이미 ${memberName(open.assignee)}가 ${STATUS_INFO[open.status].label} 상태예요. 중복 구매에 주의하세요.`
          }
        />
      ) : null}
      {past ? (
        <Notice
          color={C.warning}
          bg={C.warningBg}
          icon={<MaterialCommunityIcons name="alert-outline" size={18} color={C.warning} />}
          text={`${shortDate(past.ordered_at ?? past.created_at)}에 ${memberName(past.assignee)}가 ${past.store ? `${past.store}에서 ` : ''}샀어요 (${[past.name, won(past.price)].filter(Boolean).join(', ')}). 아직 남았나요?`}
        />
      ) : null}
      {stats ? (
        <Notice
          color={C.success}
          bg={C.successBg}
          icon={<MaterialCommunityIcons name="tag-outline" size={18} color={C.success} />}
          text={
            stats.count > 1
              ? `지난 구매 최저가는 ${priceLabel(stats.min)}, 최근에는 ${priceLabel(stats.latest)}에 샀어요.`
              : `지난번에 ${priceLabel(stats.latest)}에 샀어요.`
          }
        />
      ) : null}

      {/* 같이 요청할 물건 (직접 입력에서만) */}
      {mode === 'text' ? (
        <>
          {extras.map((x, i) => {
            const warn = x.name.trim() ? duplicateWarning(x.name.trim(), items) : null;
            return (
              <View key={i} style={{ marginTop: 8 }}>
                <View style={s.extraRow}>
                  <TextInput
                    style={[s.input, { flex: 1 }]}
                    value={x.name}
                    onChangeText={(t) => updateExtra(i, { name: t })}
                    placeholder={['연필', '문제집', '지우개'][i % 3]}
                    placeholderTextColor={C.muted}
                    autoFocus={!x.name}
                  />
                  <TextInput
                    style={[s.input, { width: 76 }]}
                    value={x.qty}
                    onChangeText={(t) => updateExtra(i, { qty: t.slice(0, 15) })}
                    placeholder="수량"
                    placeholderTextColor={C.muted}
                  />
                  <Pressable onPress={() => setExtras((xs) => xs.filter((_, j) => j !== i))} hitSlop={8} accessibilityLabel="이 물건 빼기">
                    <MaterialCommunityIcons name="close-circle-outline" size={22} color={C.muted} />
                  </Pressable>
                </View>
                {warn ? <Text style={s.extraWarn}>⚠ {warn}</Text> : null}
              </View>
            );
          })}
          <Pressable onPress={() => setExtras((xs) => [...xs, { name: '', qty: '' }])} style={s.addMore}>
            <MaterialCommunityIcons name="plus" size={16} color={C.accent} />
            <Text style={{ color: C.accent, fontSize: 14 }}>
              물건 추가{extras.length ? ` (지금 ${extras.length + 1}개)` : ' (한 번에 여러 개 요청)'}
            </Text>
          </Pressable>
          {extras.length ? (
            <Text style={s.extraHint}>물건마다 카드가 따로 생겨요. 분류·언제·누가는 함께 적용되고, 수량을 비우면 아래 수량이 들어가요.</Text>
          ) : null}
        </>
      ) : null}

      <Section title="분류" right={suggested && !category ? `이름으로 보면 "${suggested}" 같아요` : undefined} />
      <CategoryPicker
        value={category}
        options={categories}
        suggested={suggested}
        error={!!catError}
        onChange={(c) => {
          setCategory(c);
          setCatError('');
        }}
      />
      {catError ? <Text style={{ color: C.danger, fontSize: 13, marginTop: 6 }}>{catError}</Text> : null}

      <Section title="수량" />
      <View style={s.wrap}>
        {['1개', '2개', '3개', '한 박스'].map((q) => {
          const on = !qtyCustomOn && quantity === q;
          return (
            <Pill key={q} label={q} outline={!on} color={on ? C.accent : C.sub}
              bg={on ? C.accentBg : undefined}
              onPress={() => {
                setQuantity(q);
                setQtyCustomOn(false);
              }} />
          );
        })}
        <Pill label="+ 직접 입력" outline={!qtyCustomOn} color={qtyCustomOn ? C.accent : C.sub}
          bg={qtyCustomOn ? C.accentBg : undefined} onPress={() => setQtyCustomOn(true)} />
      </View>
      {qtyCustomOn ? (
        <TextInput
          style={[s.input, { marginTop: 8 }]}
          value={qtyText}
          onChangeText={(t) => setQtyText(t.slice(0, 15))}
          placeholder="예: 5kg, 2묶음, 10개"
          placeholderTextColor={C.muted}
          autoFocus
        />
      ) : null}

      <Section title="언제 필요해요?" />
      <View style={s.wrap}>
        <Pill label="오늘 필요" outline={!urgent} color={urgent ? C.danger : C.sub}
          bg={urgent ? C.dangerBg : undefined} onPress={() => setUrgent(true)} />
        <Pill label="이번 주" outline={urgent} color={!urgent ? C.accent : C.sub}
          bg={!urgent ? C.accentBg : undefined} onPress={() => setUrgent(false)} />
      </View>

      <Section title="누가 살까요?" />
      <View style={s.wrap}>
        {[undefined, ...members.map((m) => m.id)].map((id) => {
          const on = assignee === id;
          return (
            <Pill key={id ?? 'any'} label={memberName(id)} outline={!on} color={on ? C.accent : C.sub}
              bg={on ? C.accentBg : undefined} onPress={() => setAssignee(id)} />
          );
        })}
      </View>

      <PrimaryButton
        label={busy ? '보내는 중…' : mode === 'text' && extras.some((x) => x.name.trim())
          ? `${1 + extras.filter((x) => x.name.trim()).length}개 한 번에 요청 보내기`
          : '가족에게 요청 보내기'}
        onPress={busy ? () => {} : submit}
        style={{ marginTop: 28 }}
      />
      </>
      )}
    </KeyboardScroll>
  );
}

// 주문 화면 캡처나 영수증 사진을 골라 AI 분석 화면으로 보낸다
function CapturePanel() {
  const [error, setError] = useState('');

  const pick = async (source: 'camera' | 'library') => {
    setError('');
    const r = await pickReceiptImage(source);
    if (r === 'ok') router.push('/ai-result');
    else if (r !== 'canceled') setError(r);
  };

  return (
    <View style={{ marginTop: 20 }}>
      <Text style={s.captureTitle}>주문 화면을 캡처했거나 영수증이 있나요?</Text>
      <Text style={s.captureBody}>
        AI가 구매처, 상품, 금액을 읽어서 가족 요청과 자동으로 연결해요.
      </Text>
      <PrimaryButton label="앨범에서 캡처 고르기" onPress={() => pick('library')} style={{ marginTop: 20 }} />
      <SecondaryButton label="영수증 사진 찍기" onPress={() => pick('camera')} style={{ marginTop: 10 }} />
      <Notice
        color={C.sub}
        bg="#ECEAE4"
        icon={<MaterialCommunityIcons name="shield-lock-outline" size={18} color={C.sub} />}
        text="사진을 고른 뒤 나오는 자르기 화면에서 이름, 주소, 전화번호 부분은 빼고 상품 부분만 남겨 주세요."
      />
      {error ? <Text style={{ color: C.danger, fontSize: 13, marginTop: 10 }}>{error}</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  captureTitle: { fontSize: 17, fontWeight: '600', color: C.text },
  captureBody: { fontSize: 14, color: C.sub, marginTop: 6, lineHeight: 21 },
  container: { padding: 16, paddingBottom: 40 },
  modes: { flexDirection: 'row', gap: 8 },
  mode: {
    flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 12,
    borderWidth: 1, borderColor: C.border, backgroundColor: C.card,
  },
  input: {
    backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 12, fontSize: 15, color: C.text,
  },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  extraRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  extraWarn: { fontSize: 12, color: C.warning, marginTop: 4 },
  extraHint: { fontSize: 12, color: C.muted, marginTop: 4 },
  addMore: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 10, alignSelf: 'flex-start', paddingVertical: 4 },
});
