import * as ImagePicker from 'expo-image-picker';

import { setPendingImage } from '@/data/store';

// 주문 캡처/영수증 사진을 골라 AI 분석 화면으로 넘길 준비를 한다.
// 성공하면 'ok', 취소하면 'canceled', 문제가 있으면 한국어 오류 문구를 돌려준다.
export async function pickReceiptImage(source: 'camera' | 'library'): Promise<'ok' | 'canceled' | string> {
  const perm =
    source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return source === 'camera' ? '카메라 권한을 허용해 주세요' : '사진 접근 권한을 허용해 주세요';

  const options: ImagePicker.ImagePickerOptions = {
    mediaTypes: ['images'],
    allowsEditing: true, // 주소, 이름 부분을 잘라낼 수 있게
    quality: 0.6,
    base64: true,
  };
  const result =
    source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
  const asset = result.canceled ? undefined : result.assets[0];
  if (!asset) return 'canceled';
  if (!asset.base64) return '사진을 읽지 못했어요. 다른 사진을 골라 주세요';
  setPendingImage({ uri: asset.uri, base64: asset.base64, mimeType: asset.mimeType ?? 'image/jpeg' });
  return 'ok';
}
