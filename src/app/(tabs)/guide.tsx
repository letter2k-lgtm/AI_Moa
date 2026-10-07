import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { C } from '@/constants/colors';

type IconName = keyof typeof MaterialCommunityIcons.glyphMap;

// 누구나 보고 따라 할 수 있는 사용법 (순서대로)
const STEPS: { icon: IconName; title: string; lines: string[] }[] = [
  {
    icon: 'account-group-outline',
    title: '1. 가족 만들기 · 참여하기',
    lines: [
      '처음 쓰는 사람: "새 가족 만들기"에 내 이름과 가족 이름을 넣으면 끝이에요. 비밀번호는 없어요.',
      '가족 탭 → "초대 코드 + 설치 링크 보내기"로 카톡에 보내세요.',
      '받은 사람: 링크로 앱을 설치하고 "초대 코드로 참여"에 코드를 넣으세요.',
      '같은 이름은 쓸 수 없어요. 폰을 바꿨다면 "제가 ○○이에요 (이 폰으로 이어받기)"를 누르세요.',
    ],
  },
  {
    icon: 'plus-circle-outline',
    title: '2. 필요한 물건 요청하기',
    lines: [
      '보드 오른쪽 아래 파란 + 버튼을 누르세요.',
      '직접 입력: 물건 이름, 분류, 수량, 언제 필요한지, 누가 살지 고르기',
      '분류: 생활용품·식품·학용품·기타 중 고르거나 "+ 직접 입력"으로 새 분류(예: 반려동물)를 만들어요. 꼭 골라야 해요. 만든 분류는 다음부터 목록에 나오고, 이력에서 분류별로 볼 수 있어요.',
      '수량: 1개·2개·3개·한 박스 중 고르거나 "+ 직접 입력"으로 5kg, 2묶음처럼 적어요.',
      '여러 개 한 번에: "+ 물건 추가"로 국어노트, 연필, 문제집처럼 같이 요청해요. 물건마다 카드가 따로 생겨서 구매 주기도 따로 계산돼요. 영수증 한 장에 여러 개를 산 경우도 상품마다 따로 기록돼요.',
      '분류가 잘못 들어갔으면 카드 상세의 "분류 · 바꾸기"에서 고칠 수 있어요. 영수증으로 등록할 때도 상품마다 분류를 고를 수 있어요.',
      '아이콘: 영수증·캡처는 AI가 상품에 맞는 아이콘을 골라요. 직접 적은 요청은 이름으로 골라요. 안 맞으면 카드 상세에서 아이콘을 눌러 바꾸면, 같은 물건의 다른 카드에도 그 아이콘이 나와요.',
      '링크: 쇼핑앱에서 "공유하기 → 복사"한 내용을 붙이면 상품명이 자동으로 들어가요.',
      '최근에 산 물건이면 "또 살까요?"라고 물어봐요. 지난번 최저가도 알려 줘요.',
    ],
  },
  {
    icon: 'hand-back-right-outline',
    title: '3. "내가 살게" 누르기',
    lines: [
      '가족 요청을 내가 사려면 카드의 "내가 살게"를 누르세요. 다른 가족에게 바로 알려져요.',
      '사기로 한 사람만 "주문했어요", "담당 취소"를 볼 수 있어요.',
      '요청한 사람은 "다시 요청"(가족에게 알림)과 "요청 취소"(주문 전까지)를 할 수 있어요.',
    ],
  },
  {
    icon: 'camera-outline',
    title: '4. 주문했으면 구매 정보 넣기',
    lines: [
      '캡처/영수증: 쇼핑몰 주문 화면을 캡처하거나 영수증을 찍으면 AI가 구매처, 금액, 날짜를 읽어요.',
      '사진을 고른 뒤 자르기 화면에서 이름·주소는 빼고 상품 부분만 남기세요.',
      '직접 입력: 구매처, 금액(필수), 주문일을 넣으세요.',
      '지난달 영수증도 넣을 수 있어요. 그 날짜로 기록돼서 구매 주기 계산에 쓰여요.',
    ],
  },
  {
    icon: 'package-variant-closed',
    title: '5. 배송 · 받기',
    lines: [
      '산 사람이 "배송 시작됐어요"를 누르면 배송중이 돼요.',
      '배송중이 되면 집에 있는 누구나 "내가 받았어요"를 누를 수 있어요.',
      '다음 날 바로 오는 배송이라 배송 시작을 못 눌렀다면, 산 사람이 "배송 없이 바로 받았어요"를 누르세요.',
      '버튼 색: 파란색은 다음 할 일, 흰색은 그 밖에 할 수 있는 일이에요. 둘 다 누를 수 있어요.',
      '받은 장소(현관 앞, 거실 등)를 고르면 가족이 어디 있는지 찾기 쉬워요.',
    ],
  },
  {
    icon: 'view-dashboard-outline',
    title: '6. 보드 · 이력 보기',
    lines: [
      '보드: 필요해요 → 진행 중 → 이번 달 받은 물건. ◀ ▶로 지난달도 볼 수 있어요.',
      '카드 보는 법: 왼쪽 그림은 물건 종류, 색 동그라미는 가족(지금 맡은 사람), 아래 막대는 요청 → 담당 → 주문 → 배송 → 받음 중 어디까지 왔는지예요.',
      '이력: 달별 구매 금액과 카테고리별 금액을 보여 줘요.',
      '이력에서 물건을 검색하면 최저가, 평균가, 최근가를 비교해 줘요.',
    ],
  },
  {
    icon: 'calendar-refresh-outline',
    title: '7. 재구매 알림',
    lines: [
      '같은 물건을 두 번 이상 사면 주문한 날끼리 평균 구매 주기를 계산해요. (예: 생수 14일마다) 살 때마다 주기를 다시 계산해요.',
      '살 때가 되면 보드 맨 위 빨간 배너와 폰 알림으로 알려 줘요.',
      '"가족에게 요청하기"를 누르면 바로 요청 카드가 생겨요.',
      '아직 남았으면 "아직 남았어요 (미루기)": 기본은 주기의 절반 뒤, 날짜(11/25)나 일수(15일)를 직접 넣을 수도 있어요. 그 사이에 새로 사면 미루기는 저절로 끝나요.',
      '더 안 사는 물건은 "이제 안 사요": 알림과 배너에서 빠지고, 재구매 탭 맨 아래에서 다시 켤 수 있어요. 가족 모두에게 같이 적용돼요.',
    ],
  },
  {
    icon: 'bell-outline',
    title: '8. 알림 종류 (안드로이드)',
    lines: [
      '가족 알림: 누가 요청, 담당, 주문, 배송, 받기를 하면 알려 줘요.',
      '"오늘 필요" 요청 알림: 아무도 맡지 않으면 하루가 될 때까지 3시간마다 알려 줘요 (밤 10시~아침 8시는 쉬어요). "이번 주"로 요청하면 하루 지연 알림만 와요.',
      '하루 지연 알림: 같은 단계로 24시간 넘게 멈춰 있으면 알려 줘요.',
      '도착 예정일 알림: 주문 정보에 도착 예정일이 있으면 그날 오후 1시까지 배송 시작·받음 표시가 없을 때 알려 줘요.',
      '재구매 알림: 살 때가 된 날 아침 9시에 알려 줘요.',
      '처음 열 때 "알림 허용"을 꼭 눌러 주세요.',
    ],
  },
  {
    icon: 'chart-box-outline',
    title: '9. 우리 가족 효과 보기',
    lines: [
      '가족 탭 맨 위 초록 문장: 이번 달 AI모아가 막은 중복 구매와 아낀 돈을 한 줄로 보여 줘요.',
      '중복 구매 막음: "또 살까요?"에서 취소한 횟수와 그만큼 아낀 금액',
      '주문까지 걸린 시간: 요청을 올린 때부터 주문완료가 될 때까지 걸린 평균 시간이에요. 택배 기간은 빠져서 가족이 얼마나 빨리 처리했는지 보여 줘요. 짧을수록 좋아요.',
      '실사용 기록: 위에서 고른 기간(기본 이번 달)의 가족별 요청·구매 수, 전체 요청·구매 수, 사용 금액을 보여 줘요. 여러 달을 고르면 달별 금액도 나와요. 시연 데이터는 빼고 실제 기록만 세요.',
      '가족 탭은 예측 적중률(전체 기록)만 빼고 모두 위에서 고른 기간 기준이에요. 가족별 요청·구매 수는 실사용 기록에서 볼 수 있어요.',
      '구매 주기 예측 적중률: 같은 물건을 3번 이상 사면, 재구매 알림이 예측한 날과 실제로 주문한 날을 비교해요. 주기의 20%(최소 2일) 안이면 적중이에요. 예: 14일마다 사는 생수는 예측일 ±2.8일 안에 주문하면 적중 (택배가 늦게 와도 괜찮아요). 기간과 상관없이 전체 기록으로 계산해요.',
      '끝까지 처리된 요청: 그달 요청 중 주문완료(또는 배송중, 받았어요)까지 간 요청 (예: 총 요청 10건 중 9건, 90%). 요청이 빠지지 않았다는 뜻이에요. 지금 하루 넘게 담당자 없는 요청이 있으면 칸이 빨개져요. 높을수록 좋아요.',
    ],
  },
  {
    icon: 'cellphone',
    title: '10. 설치 · 업데이트',
    lines: [
      '안드로이드: 초대 메시지의 설치 링크(APK)로 설치해요.',
      '아이폰: 사파리에서 ai-moa.expo.app을 열고 공유 버튼(□↑) → "홈 화면에 추가". 항상 홈 화면 아이콘으로 여세요.',
      '화면 위에 "새 버전이 준비됐어요"가 뜨면 "지금 적용"을 누르세요.',
    ],
  },
];

const FAQ: { q: string; a: string }[] = [
  { q: '폰을 바꿨는데 가족에 다시 들어가려면?', a: '초대 코드로 참여 → 원래 이름 입력 → "제가 ○○이에요 (이 폰으로 이어받기)"를 누르면 예전 기록을 그대로 이어받아요.' },
  { q: 'AI가 금액이나 날짜를 잘못 읽었어요.', a: '저장하기 전에 칸을 눌러서 고칠 수 있어요. 저장한 뒤에는 산 사람이 카드 → "구매 정보 수정"에서 고칠 수 있어요.' },
  { q: '잘못 등록한 기록을 지우려면?', a: '요청 단계면 요청한 사람이 "요청 취소"를 누르세요. 그 밖의 기록은 가족을 만든 사람(리더)만 카드 맨 아래 "이 기록 삭제"로 지울 수 있어요.' },
  { q: '알림이 안 와요.', a: '폰 설정 → 애플리케이션 → AI모아 → 알림을 켜 주세요. 아이폰(웹)은 폰 알림이 오지 않아요.' },
];

export default function GuideScreen() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <ScrollView contentContainerStyle={s.container}>
      <View style={s.hero}>
        <Text style={s.heroTitle}>AI모아 사용법</Text>
        <Text style={s.heroBody}>
          가족이 각자 산 물건과 택배를 한곳에 모아서{'\n'}중복 구매는 막고, 떨어질 때는 미리 알려 줘요.
        </Text>
        <Text style={s.flow}>요청 → 내가 살게 → 주문 → 배송 → 받기</Text>
      </View>

      {STEPS.map((step, i) => {
        const isOpen = open === i;
        return (
          <View key={step.title} style={s.card}>
            <Pressable style={s.head} onPress={() => setOpen(isOpen ? null : i)} accessibilityRole="button">
              <MaterialCommunityIcons name={step.icon} size={22} color={C.accent} />
              <Text style={s.title}>{step.title}</Text>
              <MaterialCommunityIcons name={isOpen ? 'chevron-up' : 'chevron-down'} size={22} color={C.muted} />
            </Pressable>
            {isOpen
              ? step.lines.map((line) => (
                  <View key={line} style={s.lineRow}>
                    <Text style={s.dot}>·</Text>
                    <Text style={s.line}>{line}</Text>
                  </View>
                ))
              : null}
          </View>
        );
      })}

      <Text style={s.faqTitle}>자주 묻는 질문</Text>
      {FAQ.map((f) => (
        <View key={f.q} style={s.card}>
          <Text style={s.q}>Q. {f.q}</Text>
          <Text style={s.a}>{f.a}</Text>
        </View>
      ))}

      <Text style={s.footer}>made by IDEA:BOX</Text>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { padding: 16, paddingBottom: 40 },
  hero: { backgroundColor: C.accentBg, borderRadius: 12, padding: 16, marginBottom: 12 },
  heroTitle: { fontSize: 18, fontWeight: '700', color: C.accent },
  heroBody: { fontSize: 14, color: C.text, marginTop: 6, lineHeight: 21 },
  flow: { fontSize: 13, color: C.accent, marginTop: 10, fontWeight: '600' },
  card: { backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 14, marginBottom: 8 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { flex: 1, fontSize: 15, fontWeight: '600', color: C.text },
  lineRow: { flexDirection: 'row', gap: 6, marginTop: 8 },
  dot: { fontSize: 14, color: C.muted, lineHeight: 21 },
  line: { flex: 1, fontSize: 14, color: C.sub, lineHeight: 21 },
  faqTitle: { fontSize: 15, fontWeight: '600', color: C.text, marginTop: 16, marginBottom: 8 },
  q: { fontSize: 14, fontWeight: '600', color: C.text },
  a: { fontSize: 14, color: C.sub, marginTop: 6, lineHeight: 21 },
  footer: { fontSize: 12, color: C.muted, textAlign: 'center', marginTop: 20 },
});
