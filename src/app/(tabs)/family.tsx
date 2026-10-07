import Constants from 'expo-constants';
import { useFocusEffect } from 'expo-router';
import * as Updates from 'expo-updates';
import { useCallback } from 'react';
import { Platform, ScrollView, Share, StyleSheet, Text, View } from 'react-native';

import { MemberDot } from '@/components/item-visual';
import ReportCard from '@/components/report-card';
import UsageCard from '@/components/usage-card';
import { Card, Pill, SecondaryButton, Section } from '@/components/ui';
import { C } from '@/constants/colors';
import { formatDate, refreshNow, useStore } from '@/data/store';

// 가족에게 보낼 안드로이드 설치 파일 (EAS 빌드 #3). 새 APK를 만들면 이 주소를 바꾼다.
const APK_URL = 'https://expo.dev/artifacts/eas/hn2TRay10lw1Lz1JwsIZspUrn9C69ZLqNszVRR1tXJ4.apk';
// 아이폰은 앱 설치 파일 대신 웹 버전 (EAS Hosting). 사파리에서 "홈 화면에 추가"로 앱처럼 쓴다.
const WEB_URL = 'https://ai-moa.expo.app';

const INSTALL_GUIDE =
  `▶ 안드로이드\n${APK_URL}\n` +
  `링크를 눌러 다운로드한 뒤 열어서 설치하세요. "출처를 알 수 없는 앱" 허용이 나오면 허용을 눌러 주세요.\n\n` +
  `▶ 아이폰\n${WEB_URL}\n` +
  `사파리로 열고 아래 공유 버튼(□↑) → "홈 화면에 추가"를 누르면 앱처럼 쓸 수 있어요.`;

export default function FamilyScreen() {
  const { family, members, me } = useStore();
  // 가족 탭을 열 때마다 최신 기록으로 (다른 가족이 막 바꾼 효과 숫자가 바로 보이게)
  useFocusEffect(useCallback(() => refreshNow(), []));
  if (!family) return null;

  const share = () =>
    Share.share({
      message:
        `AI모아에서 우리 가족 구매 보드에 참여해 주세요.\n\n` +
        `1) 앱 설치\n${INSTALL_GUIDE}\n\n` +
        `2) 앱을 열고 "초대 코드로 참여"에 아래 코드를 입력하세요.\n초대 코드: ${family.invite_code}`,
    });

  const shareApk = () =>
    Share.share({
      message: `AI모아 설치 링크\n\n${INSTALL_GUIDE}`,
    });

  return (
    <ScrollView contentContainerStyle={s.container}>
      <ReportCard />
      <UsageCard />
      <Card>
        <Text style={s.group}>{family.name}</Text>
        <Text style={s.meta}>구성원 {members.length}명</Text>
        <View style={s.codeBox}>
          <Text style={s.meta}>초대 코드</Text>
          <Text style={s.code} selectable>{family.invite_code}</Text>
        </View>
        <SecondaryButton label="초대 코드 + 설치 링크 보내기" onPress={share} style={{ marginTop: 10 }} />
        <SecondaryButton label="설치 링크만 보내기" onPress={shareApk} style={{ marginTop: 8 }} />
      </Card>

      {/* 가입한 구성원 (리더 포함). 요청·구매 수는 실사용 기록 카드에 있다 */}
      <Section title="구성원" right={`${members.length}명`} />
      {members.map((m) => (
        <Card key={m.id}>
          <View style={s.row}>
            <MemberDot id={m.id} size={40} />
            <Text style={[s.name, { flex: 1 }]}>{m.name}{m.id === me?.id ? ' (나)' : ''}</Text>
            <Pill label={m.role} outline />
          </View>
        </Card>
      ))}

      <Text style={s.footer}>AI모아 v{Constants.expoConfig?.version ?? '1.0.0'} · made by IDEA:BOX</Text>
      <Text style={[s.footer, { marginTop: 4 }]}>
        {/* 원격 업데이트가 적용됐는지 확인용. v1.0.0 은 설치 파일 버전이라 원격 업데이트로는 바뀌지 않는다 */}
        {Platform.OS === 'web'
          ? '웹 버전 · 열 때마다 최신으로 적용'
          : `최근 업데이트: ${Updates.createdAt ? formatDate(Updates.createdAt.toISOString()) : '설치한 그대로'}`}
      </Text>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { padding: 16, paddingBottom: 40 },
  group: { fontSize: 18, fontWeight: '600', color: C.text },
  meta: { fontSize: 12, color: C.muted, marginTop: 3 },
  codeBox: { backgroundColor: C.bg, borderRadius: 10, padding: 12, marginTop: 12, alignItems: 'center' },
  code: { fontSize: 22, fontWeight: '600', letterSpacing: 2, color: C.text, marginTop: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  name: { fontSize: 15, color: C.text },
  footer: { fontSize: 12, color: C.muted, textAlign: 'center', marginTop: 28, letterSpacing: 0.5 },
});
