import { useEffect, useRef, useState } from 'react';
import { Dimensions, Keyboard, Platform, ScrollView, TextInput, type ScrollViewProps } from 'react-native';

// 입력칸이 많은 화면용 ScrollView: 키보드가 올라오면
// 1) 아래에 키보드 높이만큼 여백을 만들고 2) 지금 누른 입력칸이 키보드에 가려지면 그만큼 위로 스크롤한다.
// (안드로이드 edge-to-edge 에서는 화면이 저절로 줄어들지 않아서 직접 맞춘다. 네이티브 모듈 없이 동작)
export default function KeyboardScroll({ children, contentContainerStyle, ...rest }: ScrollViewProps) {
  const ref = useRef<ScrollView>(null);
  const offset = useRef(0);
  const [kb, setKb] = useState(0);

  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvt, (e) => {
      const height = e.endCoordinates.height;
      setKb(height);
      // 여백이 생긴 뒤에 누른 칸 위치를 재서 가려졌으면 올린다
      setTimeout(() => {
        const input = TextInput.State.currentlyFocusedInput();
        input?.measureInWindow?.((_x, y, _w, h) => {
          const visibleBottom = Dimensions.get('window').height - height - 16;
          const hidden = y + h - visibleBottom;
          if (hidden > 0) ref.current?.scrollTo({ y: offset.current + hidden + 24, animated: true });
        });
      }, 80);
    });
    const hide = Keyboard.addListener(hideEvt, () => setKb(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return (
    <ScrollView
      ref={ref}
      keyboardShouldPersistTaps="handled"
      onScroll={(e) => {
        offset.current = e.nativeEvent.contentOffset.y;
      }}
      scrollEventThrottle={32}
      {...rest}
      contentContainerStyle={[contentContainerStyle, kb ? { paddingBottom: kb + 40 } : null]}>
      {children}
    </ScrollView>
  );
}
