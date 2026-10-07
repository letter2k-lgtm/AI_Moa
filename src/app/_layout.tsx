import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '@/components/ui';
import UpdateBanner from '@/components/update-banner';
import Welcome from '@/components/welcome';
import { C } from '@/constants/colors';
import { start, useStore } from '@/data/store';
import { isSupabaseConfigured } from '@/lib/supabase';

function Gate({ children }: { children: React.ReactNode }) {
  const { phase, error } = useStore();

  useEffect(() => {
    if (isSupabaseConfigured) start();
  }, []);

  if (!isSupabaseConfigured) {
    return (
      <View style={s.center}>
        <Text style={s.title}>서버 연결 설정이 필요해요</Text>
        <Text style={s.body}>ai-moa 폴더의 .env.local 파일에 Supabase 주소와 키를 넣고 앱을 다시 실행하세요.</Text>
      </View>
    );
  }
  if (phase === 'loading') {
    return (
      <View style={s.center}>
        <ActivityIndicator color={C.accent} size="large" />
      </View>
    );
  }
  if (phase === 'error') {
    return (
      <View style={s.center}>
        <Text style={s.title}>서버에 연결하지 못했어요</Text>
        <Text style={s.body}>{error}</Text>
        <PrimaryButton label="다시 시도" onPress={start} style={{ marginTop: 20, alignSelf: 'stretch' }} />
      </View>
    );
  }
  if (phase === 'onboarding') return <Welcome />;
  return children;
}

export default function RootLayout() {
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <StatusBar style="dark" />
      <UpdateBanner />
      <Gate>
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: C.bg },
            headerShadowVisible: false,
            headerTintColor: C.text,
            contentStyle: { backgroundColor: C.bg },
            headerBackButtonDisplayMode: 'minimal',
          }}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="new-request" options={{ title: '새 요청', presentation: 'modal' }} />
          <Stack.Screen name="ai-result" options={{ title: 'AI가 읽었어요' }} />
          <Stack.Screen name="item/[id]" options={{ title: '상세' }} />
        </Stack>
      </Gate>
    </View>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, backgroundColor: C.bg },
  title: { fontSize: 18, fontWeight: '600', color: C.text, textAlign: 'center' },
  body: { fontSize: 14, color: C.sub, textAlign: 'center', marginTop: 8, lineHeight: 21 },
});
