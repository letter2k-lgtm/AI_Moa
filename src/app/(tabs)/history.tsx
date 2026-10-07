import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { ItemIcon, MemberDot } from '@/components/item-visual';
import { inPeriod, PeriodBar, periodLabel, usePeriod } from '@/components/period';
import { Card, Pill, Section } from '@/components/ui';
import { C } from '@/constants/colors';
import {
  addItem, categoriesOf, findOpenRequest, logPrevented, memberName, priceLabel, priceStats, purchasesOf, sameProduct,
  shortDate, STATUS_INFO, useItems, won, type Item,
} from '@/data/store';
import { confirm, notice } from '@/lib/confirm';
import { openLink } from '@/lib/link';

export default function HistoryScreen() {
  const items = useItems();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('전체');
  // 기본 분류 + 가족이 직접 만든 분류. 분류가 비어 있는 옛 기록은 "기타"로 본다
  const categories = categoriesOf(items);
  const FILTERS = ['전체', ...categories];
  const catOf = (p: Item) => p.category?.trim() || '기타';
  const period = usePeriod();

  const q = query.trim();
  const all = purchasesOf(items);
  // 검색할 때는 전체 기간, 아니면 고른 기간만 (주문일 기준)
  const inMonth = (p: Item) => inPeriod(period, p.ordered_at ?? p.created_at);
  const list = all.filter(
    (p) =>
      (category === '전체' || catOf(p) === category) &&
      (q ? p.name.includes(q) || sameProduct(q, p.name) : inMonth(p)),
  );

  // 이번 달 요약 (카테고리 필터와 상관없이 그 달 전체)
  const monthAll = all.filter(inMonth);
  const total = monthAll.reduce((sum, p) => sum + (p.price ?? 0), 0);
  const byCategory = categories.map((c) => ({
    c,
    sum: monthAll.filter((p) => catOf(p) === c).reduce((s2, p) => s2 + (p.price ?? 0), 0),
  }))
    .filter((x) => x.sum > 0)
    .sort((a, b) => b.sum - a.sum);

  const stats = q ? priceStats(q, items) : null;

  const rebuy = async (name: string, link: string | null, cat: string | null) => {
    const open = findOpenRequest(name, items);
    if (
      open &&
      !(await confirm('이미 진행 중이에요', `"${open.name}"이(가) ${STATUS_INFO[open.status].label} 상태예요.\n그래도 다시 요청할까요?`, '요청하기'))
    ) {
      logPrevented(name, items);
      return;
    }
    addItem({ name, quantity: '1개', urgent: false, link: link ?? undefined, category: cat })
      .then(() => router.navigate('/'))
      .catch((e) => notice('저장하지 못했어요', e instanceof Error ? e.message : String(e)));
  };

  return (
    <ScrollView contentContainerStyle={s.container} keyboardShouldPersistTaps="handled">
      <View style={s.search}>
        <MaterialCommunityIcons name="magnify" size={20} color={C.muted} />
        <TextInput
          style={{ flex: 1, fontSize: 15, color: C.text, paddingVertical: 10 }}
          value={query}
          onChangeText={setQuery}
          placeholder="물건 검색 (전체 기간)"
          placeholderTextColor={C.muted}
        />
      </View>

      {!q ? (
        <>
          <View style={{ marginTop: 12 }}>
            <PeriodBar />
          </View>

          <Card>
            <View style={s.row}>
              <Text style={s.sumLabel}>{periodLabel(period)} 구매</Text>
              <Text style={s.sumLabel}>{monthAll.length}건</Text>
            </View>
            <Text style={s.total}>{won(total) || '0원'}</Text>
            {byCategory.map((x) => (
              <View key={x.c} style={s.catRow}>
                <Text style={s.catName}>{x.c}</Text>
                <View style={s.barTrack}>
                  <View style={[s.bar, { width: `${Math.max(4, Math.round((x.sum / total) * 100))}%` }]} />
                </View>
                <Text style={s.catSum}>{won(x.sum)}</Text>
              </View>
            ))}
          </Card>
        </>
      ) : null}

      <View style={s.wrap}>
        {FILTERS.map((c) => (
          <Pill key={c} label={c} outline={category !== c} color={category === c ? C.accent : C.sub}
            bg={category === c ? C.accentBg : undefined} onPress={() => setCategory(c)} />
        ))}
      </View>

      {stats ? (
        <Card style={{ marginTop: 12 }}>
          <Text style={s.sumLabel}>“{q}” 가격 비교 · {stats.count}번 구매</Text>
          <View style={s.priceRow}>
            <Text style={s.priceKey}>최저가</Text>
            <Text style={[s.priceVal, { color: C.success }]}>{priceLabel(stats.min)}</Text>
          </View>
          <View style={s.priceRow}>
            <Text style={s.priceKey}>평균가</Text>
            <Text style={s.priceVal}>{won(stats.avg)}</Text>
          </View>
          <View style={s.priceRow}>
            <Text style={s.priceKey}>최근가</Text>
            <Text style={s.priceVal}>{priceLabel(stats.latest)}</Text>
          </View>
          {stats.latest.price! > stats.min.price! ? (
            <Text style={s.save}>
              최저가로 사면 {won(stats.latest.price! - stats.min.price!)} 아낄 수 있어요
            </Text>
          ) : null}
        </Card>
      ) : null}

      <Section title={q ? `"${q}" 전체 기간 검색` : `${periodLabel(period)} 구매 기록`} right={`${list.length}건`} />
      {list.map((p) => (
        <Card key={p.id} onPress={() => router.push(`/item/${p.id}`)}>
          <View style={[s.row, { alignItems: 'center' }]}>
            <ItemIcon item={p} size={32} />
            <Text style={[s.name, { flex: 1, marginHorizontal: 8 }]}>{p.name}</Text>
            <Text style={[s.name, !p.price && { color: C.muted }]}>{won(p.price) || '금액 미입력'}</Text>
          </View>
          <View style={s.metaRow}>
            <MemberDot id={p.assignee} size={16} />
            <Text style={[s.meta, { flex: 1, marginTop: 0 }]}>
              {[shortDate(p.ordered_at ?? p.created_at), p.store, memberName(p.assignee), STATUS_INFO[p.status].label]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 16 }}>
            <Text style={s.rebuy} onPress={() => rebuy(p.name, p.link, p.category)}>다시 사기</Text>
            {p.link ? <Text style={s.rebuy} onPress={() => openLink(p.link!)}>구매 링크 열기</Text> : null}
          </View>
        </Card>
      ))}
      {!list.length ? (
        <Text style={s.meta}>
          {q ? '검색 결과가 없어요.' : '이 기간에는 구매 기록이 없어요. ◀ 버튼이나 기간을 눌러 다른 기간을 볼 수 있어요.'}
        </Text>
      ) : null}

    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { padding: 16, paddingBottom: 40 },
  search: {
    flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.card,
    borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 12,
  },
  sumLabel: { fontSize: 13, color: C.sub },
  total: { fontSize: 24, fontWeight: '700', color: C.text, marginTop: 2, marginBottom: 6 },
  catRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  catName: { width: 56, fontSize: 12, color: C.sub },
  barTrack: { flex: 1, height: 8, backgroundColor: C.bg, borderRadius: 4, overflow: 'hidden' },
  bar: { height: 8, backgroundColor: C.accent, borderRadius: 4 },
  catSum: { width: 72, fontSize: 12, color: C.text, textAlign: 'right' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  priceRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  priceKey: { width: 56, fontSize: 13, color: C.muted },
  priceVal: { flex: 1, fontSize: 15, color: C.text, fontWeight: '500' },
  save: { fontSize: 13, color: C.success, marginTop: 10 },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  name: { fontSize: 15, color: C.text },
  meta: { fontSize: 12, color: C.muted, marginTop: 3, lineHeight: 18 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  rebuy: { fontSize: 13, color: C.accent, marginTop: 6 },
});
