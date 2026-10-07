import * as Updates from 'expo-updates';
import { useEffect } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { C } from '@/constants/colors';

// 원격 업데이트가 있으면 내려받아 두고 "지금 적용" 버튼을 보여준다.
// (기본 동작은 앱을 두 번 껐다 켜야 적용돼서 헷갈리기 쉬움)
export default function UpdateBanner() {
  const { isUpdatePending } = Updates.useUpdates();
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (!Updates.isEnabled) return;
    const check = () =>
      Updates.checkForUpdateAsync()
        .then((r) => (r.isAvailable ? Updates.fetchUpdateAsync() : null))
        .catch(() => {});
    check();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') check();
    });
    return () => sub.remove();
  }, []);

  if (!isUpdatePending) return null;

  return (
    <View style={[s.bar, { paddingTop: insets.top + 8 }]}>
      <Text style={s.text}>새 버전이 준비됐어요</Text>
      <Pressable style={s.button} onPress={() => Updates.reloadAsync().catch(() => {})}>
        <Text style={s.buttonText}>지금 적용</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  bar: {
    backgroundColor: C.accent, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingBottom: 10,
  },
  text: { color: '#fff', fontSize: 14, fontWeight: '600' },
  button: { backgroundColor: '#fff', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  buttonText: { color: C.accent, fontSize: 13, fontWeight: '600' },
});
