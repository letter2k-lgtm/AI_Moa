import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { SafeAreaView } from 'react-native-safe-area-context';

import { Pill, PrimaryButton, SecondaryButton, Section } from '@/components/ui';
import { C } from '@/constants/colors';
import { createFamily, joinFamily, reclaimMember } from '@/data/store';
import { confirm } from '@/lib/confirm';

type Mode = 'create' | 'join';

export default function Welcome() {
  const [mode, setMode] = useState<Mode>('create');
  const [myName, setMyName] = useState('');
  const [familyName, setFamilyName] = useState('우리집');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [takeover, setTakeover] = useState('');

  const submit = async () => {
    if (!myName.trim()) return setError('가족 안에서 부를 이름을 입력하세요');
    if (mode === 'create' && !familyName.trim()) return setError('가족 이름을 입력하세요');
    if (mode === 'join' && !code.trim()) return setError('초대 코드를 입력하세요');
    setBusy(true);
    try {
      if (mode === 'create') await createFamily(familyName.trim(), myName.trim());
      else await joinFamily(code.trim(), myName.trim());
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      // 같은 이름이 이미 있으면: 폰을 바꿨거나 앱을 다시 깐 본인일 수 있다
      setTakeover(mode === 'join' && msg.includes('이미') ? myName.trim() : '');
    } finally {
      setBusy(false);
    }
  };

  const takeoverMember = async () => {
    const ok = await confirm(
      `"${takeover}"(으)로 이어받을까요?`,
      `폰을 바꿨거나 앱을 다시 설치한 경우에만 누르세요.\n"${takeover}"의 요청·구매·수령 기록을 이 폰으로 옮겨요. 예전 폰에서는 더 이상 쓸 수 없어요.`,
      '이어받기',
    );
    if (!ok) return;
    setBusy(true);
    try {
      await reclaimMember(code.trim(), takeover);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const input = (value: string, onChange: (t: string) => void, placeholder: string, upper?: boolean) => (
    <TextInput
      style={s.input}
      value={value}
      onChangeText={(t) => {
        onChange(upper ? t.toUpperCase() : t);
        setError('');
        setTakeover('');
      }}
      placeholder={placeholder}
      placeholderTextColor={C.muted}
      autoCapitalize={upper ? 'characters' : 'none'}
    />
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={s.container} keyboardShouldPersistTaps="handled">
          <Text style={s.logo}>AI모아</Text>
          <Text style={s.tagline}>가족의 모든 구매와 택배를 한곳에</Text>

          <View style={s.tabs}>
            <Pill label="새 가족 만들기" outline={mode !== 'create'} color={mode === 'create' ? C.accent : C.sub}
              bg={mode === 'create' ? C.accentBg : undefined} onPress={() => { setMode('create'); setError(''); }} />
            <Pill label="초대 코드로 참여" outline={mode !== 'join'} color={mode === 'join' ? C.accent : C.sub}
              bg={mode === 'join' ? C.accentBg : undefined} onPress={() => { setMode('join'); setError(''); }} />
          </View>

          <Section title="내 이름" />
          {input(myName, setMyName, '아빠')}

          {mode === 'create' ? (
            <>
              <Section title="가족 이름" />
              {input(familyName, setFamilyName, '우리집')}
            </>
          ) : (
            <>
              <Section title="초대 코드" />
              {input(code, setCode, 'MOA-7K2P', true)}
              <Text style={s.hint}>가족 탭에서 초대 코드를 확인할 수 있어요.</Text>
            </>
          )}

          {error ? <Text style={s.error}>{error}</Text> : null}
          {takeover ? (
            <SecondaryButton
              label={`제가 "${takeover}"이에요 (이 폰으로 이어받기)`}
              onPress={busy ? () => {} : takeoverMember}
              style={{ marginTop: 12 }}
            />
          ) : null}

          <PrimaryButton
            label={busy ? '잠시만요…' : mode === 'create' ? '가족 만들기' : '가족에 참여하기'}
            onPress={busy ? () => {} : submit}
            style={{ marginTop: 28 }}
          />
          <Text style={s.team}>made by IDEA:BOX</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { padding: 24, paddingTop: 60 },
  logo: { fontSize: 32, fontWeight: '700', color: C.accent },
  tagline: { fontSize: 15, color: C.sub, marginTop: 6 },
  tabs: { flexDirection: 'row', gap: 8, marginTop: 36 },
  input: {
    backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 12, fontSize: 15, color: C.text,
  },
  hint: { fontSize: 12, color: C.muted, marginTop: 6 },
  error: { color: C.danger, fontSize: 13, marginTop: 12 },
  team: { fontSize: 12, color: C.muted, textAlign: 'center', marginTop: 40, letterSpacing: 1 },
});
