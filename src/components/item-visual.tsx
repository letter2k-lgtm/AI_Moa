import { StyleSheet, Text, View } from 'react-native';

import { C } from '@/constants/colors';
import { learnedIcon, memberColor, memberName, STATUS_INFO, STATUS_ORDER, type Item } from '@/data/store';

// 카드를 한눈에 알아보게 하는 그림들: 물건 아이콘, 진행 단계 막대, 가족별 색 동그라미

// 물건마다 하나씩. "=배"처럼 = 이 붙은 한 글자는 단어 전체가 그 글자일 때만 (택배 ≠ 배, 선물 ≠ 물),
// = 없는 한 글자는 단어 끝에 있으면 (감귤·하우스귤 = 귤, 찹쌀 = 쌀, 두통약 = 약)
const EMOJI: Record<string, string> = {
  // 과일
  귤: '🍊', 감귤: '🍊', 한라봉: '🍊', 천혜향: '🍊', 오렌지: '🍊', 사과: '🍎', 풋사과: '🍏', '=배': '🍐', 바나나: '🍌',
  포도: '🍇', 샤인머스캣: '🍇', 딸기: '🍓', 블루베리: '🫐', 체리: '🍒', 수박: '🍉', 참외: '🍈', 멜론: '🍈',
  복숭아: '🍑', 레몬: '🍋', 키위: '🥝', 파인애플: '🍍', 망고: '🥭', '=감': '🍑', 곶감: '🍑', 아보카도: '🥑',
  // 채소
  토마토: '🍅', 감자: '🥔', 고구마: '🍠', 당근: '🥕', 양파: '🧅', 마늘: '🧄', 대파: '🥬', 양배추: '🥬', 배추: '🥬',
  상추: '🥬', 시금치: '🥬', 브로콜리: '🥦', 오이: '🥒', 가지: '🍆', 고추: '🌶️', 파프리카: '🫑', 옥수수: '🌽',
  버섯: '🍄', 콩나물: '🌱', 두부: '🧈', 김치: '🥬',
  // 고기·생선
  고기: '🥩', 소고기: '🥩', 한우: '🥩', 돼지고기: '🥩', 삼겹살: '🥓', 베이컨: '🥓', 햄: '🍖', 소시지: '🌭',
  닭: '🍗', 닭가슴살: '🍗', 치킨: '🍗', 생선: '🐟', 고등어: '🐟', 연어: '🍣', 참치: '🐟', 새우: '🦐', 오징어: '🦑',
  조개: '🦪', '=김': '🍙', 어묵: '🍢',
  // 밥·면·빵·간식
  쌀: '🍚', 햇반: '🍚', 즉석밥: '🍚', 라면: '🍜', 국수: '🍜', 파스타: '🍝', 스파게티: '🍝', 떡: '🍡', 만두: '🥟',
  빵: '🍞', 식빵: '🍞', 베이글: '🥯', 크루아상: '🥐', 케이크: '🍰', 피자: '🍕', 시리얼: '🥣', 과자: '🍪',
  쿠키: '🍪', 초콜릿: '🍫', 사탕: '🍬', 젤리: '🍬', 아이스크림: '🍦', 팝콘: '🍿', 견과: '🥜', 땅콩: '🥜',
  // 유제품·달걀·양념
  우유: '🥛', 두유: '🥛', 요거트: '🥣', 그릭요거트: '🥣', 요구르트: '🥛', 가루: '🌾', 밀가루: '🌾', 찹쌀가루: '🌾',
  부침가루: '🌾', 튀김가루: '🌾', 전분: '🌾', 오트밀: '🥣', 그래놀라: '🥣', 치즈: '🧀', 버터: '🧈', 계란: '🥚', 달걀: '🥚', 메추리알: '🥚',
  올리브유: '🫒', 식용유: '🫗', 참기름: '🫗', 들기름: '🫗', 간장: '🫗', 소금: '🧂', 설탕: '🧂', 후추: '🧂',
  꿀: '🍯', 잼: '🍯', 케첩: '🍅', 마요네즈: '🥚',
  // 음료
  생수: '💧', 삼다수: '💧', 아이시스: '💧', 백산수: '💧', 에비앙: '💧', 샘물: '💧', 평창수: '💧', '=물': '💧',
  커피: '☕', 캡슐: '☕', 원두: '☕', '=차': '🍵', 녹차: '🍵', 보리차: '🍵', 주스: '🧃', 음료: '🧃', 콜라: '🥤',
  사이다: '🥤', 탄산수: '🥤', 맥주: '🍺', 와인: '🍷', 소주: '🍶', 막걸리: '🍶',
  // 반려동물
  고양이: '🐱', 츄르: '🐱', 모래: '🐱', 캣타워: '🐱', 강아지: '🐶', 애견: '🐶', 반려견: '🐶', 배변패드: '🐶',
  사료: '🐾', 간식: '🍪',
  // 생활용품
  휴지: '🧻', 화장지: '🧻', 두루마리: '🧻', 키친타올: '🧻', 키친타월: '🧻', 티슈: '🧻', 물티슈: '🧻', 휴지통: '🗑️',
  쓰레기봉투: '🗑️', 종량제: '🗑️', 비닐: '🛍️', 지퍼백: '🛍️', '=랩': '🛍️', 호일: '🛍️',
  세제: '🧴', 섬유유연제: '🧴', 샴푸: '🧴', 린스: '🧴', 컨디셔너: '🧴', 바디워시: '🧴', 로션: '🧴', 선크림: '🧴',
  치약: '🪥', 칫솔: '🪥', 비누: '🧼', 손세정제: '🧼', 수세미: '🧽', 스펀지: '🧽', 고무장갑: '🧤', 행주: '🧽',
  수건: '🛁', 타월: '🛁', 면도기: '🪒', 기저귀: '👶', 생리대: '🩸', 마스크: '😷', 파스: '🩹', 밴드: '🩹', 약: '💊',
  영양제: '💊', 비타민: '💊', 건전지: '🔋', 배터리: '🔋', 충전기: '🔌', 멀티탭: '🔌', 케이블: '🔌', 전구: '💡',
  형광등: '💡', 부탄가스: '🔥', 가스: '🔥', 양초: '🕯️', 우산: '☂️', 슬리퍼: '🩴', 양말: '🧦', 옷걸이: '👕',
  컵: '🥤', 종이컵: '🥤', 접시: '🍽️', 그릇: '🥣', 냄비: '🍲', 프라이팬: '🍳', 젓가락: '🥢', 숟가락: '🥄',
  // 전자·기타
  키보드: '⌨️', 마우스: '🖱️', 이어폰: '🎧', 헤드폰: '🎧', 노트북: '💻', 휴대폰: '📱', 핸드폰: '📱', 시계: '⌚',
  카메라: '📷', 모니터: '🖥️', 프린터: '🖨️', 공구: '🧰', 드라이버: '🪛', 텐트: '⛺', 장난감: '🧸', 레고: '🧱',
  화분: '🪴', 꽃: '💐', 선물: '🎁', 의자: '🪑', 모자: '🧢', 신발: '👟', 운동화: '👟', 옷: '👕', 티셔츠: '👕',
  // 학용품
  볼펜: '🖊️', 연필: '✏️', 색연필: '🖍️', 크레파스: '🖍️', 사인펜: '🖊️', 형광펜: '🖍️', 노트: '📒', 공책: '📒',
  스케치북: '🎨', 물감: '🎨', 문제집: '📚', '=책': '📕', 교재: '📚', 지우개: '🧽', '=풀': '📎', 테이프: '📎',
  가위: '✂️', '=자': '📏', 파일: '📁', 복사용지: '📄', 용지: '📄', 종이: '📄', 가방: '🎒', 필통: '✏️',
};

const CATEGORY_EMOJI: Record<string, string> = { 생활용품: '🏠', 식품: '🍽️', 학용품: '📒', 기타: '📦' };

// 한국어는 단어 끝이 실제 물건이라, 이름에서 가장 뒤에 나오는 물건 이름을 고른다
// (딸기우유 → 🥛, 우유식빵 → 🍞, 고양이 간식 츄르 → 🐱). 같은 자리에서 끝나면 더 긴 이름 (부탄가스 > 가스).
export function itemEmoji(name: string, category?: string | null) {
  const clean = name.replace(/​/g, '');
  let best: { end: number; len: number; emoji: string } | null = null;
  const consider = (end: number, len: number, emoji: string) => {
    if (!best || end > best.end || (end === best.end && len > best.len)) best = { end, len, emoji };
  };
  // 단어마다 이름 안의 위치를 알아 둔다
  const words: { w: string; end: number }[] = [];
  for (const m of clean.matchAll(/[^\s,()/[\]]+/g)) words.push({ w: m[0], end: m.index + m[0].length });

  for (const [rawKey, emoji] of Object.entries(EMOJI)) {
    const exact = rawKey.startsWith('=');
    const key = exact ? rawKey.slice(1) : rawKey;
    if (key.length >= 2) {
      const at = clean.lastIndexOf(key);
      if (at >= 0) consider(at + key.length, key.length, emoji);
    } else {
      for (const { w, end } of words) {
        // "귤5kg", "제주귤3kg"처럼 숫자·단위가 붙어 있으면 숫자 앞까지만 본다
        const core = w.replace(/\d.*$/, '');
        if (exact ? core === key : core.endsWith(key)) consider(end - (w.length - core.length), 1, emoji);
      }
    }
  }
  return (best as { emoji: string } | null)?.emoji ?? CATEGORY_EMOJI[category ?? '기타'] ?? '📦';
}

// 아이콘 고르는 순서: 이 카드에 정해 둔 것(AI·직접) → 같은 물건 다른 카드에 정해 둔 것 → 이름으로 추측
export const iconOf = (item: Pick<Item, 'name' | 'category' | 'icon'>) =>
  item.icon || learnedIcon(item.name) || itemEmoji(item.name, item.category);

export function ItemIcon({ item, size = 40 }: { item: Pick<Item, 'name' | 'category' | 'icon'>; size?: number }) {
  return (
    <View style={[s.icon, { width: size, height: size, borderRadius: size / 4 }]}>
      <Text style={{ fontSize: size * 0.55 }}>{iconOf(item)}</Text>
    </View>
  );
}

const STEP_LABELS = ['요청', '담당', '주문', '배송', '받음'];

// ●●●○○ 요청 → 담당 → 주문 → 배송 → 받음. 지나온 단계는 지금 단계 색으로 채운다.
export function ProgressSteps({ status, showLabels = false }: { status: Item['status']; showLabels?: boolean }) {
  const now = STATUS_ORDER.indexOf(status);
  const color = STATUS_INFO[status].color;
  return (
    <View style={{ marginTop: 6 }}>
      <View style={s.steps}>
        {STEP_LABELS.map((l, i) => (
          <View key={l} style={[s.step, { backgroundColor: i <= now ? color : C.border }]} />
        ))}
      </View>
      {showLabels ? (
        <View style={s.steps}>
          {STEP_LABELS.map((l, i) => (
            <Text key={l} style={[s.stepLabel, i === now && { color, fontWeight: '600' }]}>{l}</Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

// 가족별 색 동그라미 + 이름 첫 글자
export function MemberDot({ id, size = 18 }: { id?: string | null; size?: number }) {
  const name = memberName(id);
  return (
    <View style={[s.dot, { width: size, height: size, borderRadius: size / 2, backgroundColor: memberColor(id) }]}>
      <Text style={{ color: '#fff', fontSize: size * 0.55, fontWeight: '700' }}>{id ? name[0] : '?'}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  icon: { backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' },
  steps: { flexDirection: 'row', gap: 3 },
  step: { flex: 1, height: 4, borderRadius: 2 },
  stepLabel: { flex: 1, fontSize: 10, color: C.muted, textAlign: 'center', marginTop: 2 },
  dot: { alignItems: 'center', justifyContent: 'center' },
});
