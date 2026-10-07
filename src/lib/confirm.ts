import { Alert, Platform } from 'react-native';

// 알림창 (확인 버튼 하나)
export function notice(title: string, message: string) {
  if (Platform.OS === 'web') {
    window.alert(`${title}\n\n${message}`);
    return;
  }
  Alert.alert(title, message, [{ text: '확인' }]);
}

// 예/아니오 확인창. 웹 미리보기에서는 브라우저 확인창을 쓴다.
export function confirm(title: string, message: string, ok = '계속', cancel = '취소'): Promise<boolean> {
  if (Platform.OS === 'web') return Promise.resolve(window.confirm(`${title}\n\n${message}`));
  return new Promise((resolve) =>
    Alert.alert(title, message, [
      { text: cancel, style: 'cancel', onPress: () => resolve(false) },
      { text: ok, onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) }),
  );
}
