import { Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { C } from '@/constants/colors';

export function Pill({
  label, color = C.sub, bg, outline, onPress, style,
}: { label: string; color?: string; bg?: string; outline?: boolean; onPress?: () => void; style?: ViewStyle }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={[
        s.pill,
        bg ? { backgroundColor: bg } : null,
        outline ? { borderWidth: 1, borderColor: C.border } : null,
        style,
      ]}>
      <Text style={[s.pillText, { color }]}>{label}</Text>
    </Pressable>
  );
}

export function Card({ children, onPress, style }: { children: React.ReactNode; onPress?: () => void; style?: ViewStyle }) {
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={({ pressed }) => [s.card, pressed && { opacity: 0.7 }, style]}>
      {children}
    </Pressable>
  );
}

export function Notice({ text, color, bg, icon }: { text: string; color: string; bg: string; icon?: React.ReactNode }) {
  return (
    <View style={[s.notice, { backgroundColor: bg }]}>
      {icon}
      <Text style={{ color, fontSize: 13, flex: 1, lineHeight: 19 }}>{text}</Text>
    </View>
  );
}

export function PrimaryButton({ label, onPress, style }: { label: string; onPress: () => void; style?: ViewStyle }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.primary, pressed && { opacity: 0.8 }, style]}>
      <Text style={{ color: '#fff', fontSize: 15, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

export function SecondaryButton({ label, onPress, style }: { label: string; onPress: () => void; style?: ViewStyle }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.secondary, pressed && { opacity: 0.7 }, style]}>
      <Text style={{ color: C.text, fontSize: 15 }}>{label}</Text>
    </Pressable>
  );
}

export function Section({ title, right }: { title: string; right?: string }) {
  return (
    <View style={s.section}>
      <Text style={s.sectionText}>{title}</Text>
      {right ? <Text style={s.sectionText}>{right}</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, alignSelf: 'flex-start' },
  pillText: { fontSize: 12 },
  card: {
    backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border,
    paddingHorizontal: 14, paddingVertical: 12, marginBottom: 8,
  },
  notice: { flexDirection: 'row', gap: 8, borderRadius: 10, padding: 12, marginTop: 10, alignItems: 'flex-start' },
  primary: { backgroundColor: C.accent, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  secondary: { borderWidth: 1, borderColor: C.border, backgroundColor: C.card, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  section: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 18, marginBottom: 8 },
  sectionText: { fontSize: 13, color: C.sub },
});
