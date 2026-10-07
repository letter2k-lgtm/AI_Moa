import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { Pill } from '@/components/ui';
import { C } from '@/constants/colors';

// 분류 고르기: 기본 분류 + 가족이 만든 분류 + "+ 직접 입력".
// value 가 목록에 없으면 직접 입력한 분류로 본다. 직접 입력 중 비어 있으면 onChange('')
export default function CategoryPicker({
  value, onChange, options, suggested, error,
}: { value: string; onChange: (c: string) => void; options: string[]; suggested?: string | null; error?: boolean }) {
  const [customOn, setCustomOn] = useState(!!value && !options.includes(value));
  const [customText, setCustomText] = useState(!!value && !options.includes(value) ? value : '');

  return (
    <View>
      <View style={s.wrap}>
        {options.map((c) => {
          const on = !customOn && value === c;
          return (
            <Pill key={c} label={c} outline={!on} color={on ? C.accent : c === suggested ? C.text : C.sub}
              bg={on ? C.accentBg : undefined}
              onPress={() => {
                setCustomOn(false);
                onChange(c);
              }} />
          );
        })}
        <Pill label="+ 직접 입력" outline={!customOn} color={customOn ? C.accent : C.sub}
          bg={customOn ? C.accentBg : undefined}
          onPress={() => {
            setCustomOn(true);
            onChange(customText.trim());
          }} />
      </View>
      {customOn ? (
        <TextInput
          style={[s.input, error ? { borderColor: C.danger } : null]}
          value={customText}
          onChangeText={(t) => {
            const v = t.slice(0, 12);
            setCustomText(v);
            onChange(v.trim());
          }}
          placeholder="예: 반려동물, 캠핑, 화장품"
          placeholderTextColor={C.muted}
          autoFocus
        />
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  input: {
    backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: C.text, marginTop: 8,
  },
});
