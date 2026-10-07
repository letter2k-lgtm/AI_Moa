import { Linking } from 'react-native';

// 쇼핑몰 링크에서 상품명을 가져온다. 쇼핑몰이 막으면 조용히 실패하고 직접 입력하게 둔다.
export async function fetchLinkTitle(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36' },
    });
    if (!res.ok) return null;
    const html = (await res.text()).slice(0, 200_000);
    const raw =
      html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1] ??
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i)?.[1] ??
      html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1];
    if (!raw) return null;
    const title = decode(raw)
      .replace(/\s*[-|:]\s*(쿠팡|Coupang|네이버|NAVER|11번가|G마켓|옥션|SSG|위메프|티몬|YES24|교보문고).*$/i, '')
      .trim();
    return title.length >= 2 ? title.slice(0, 80) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const decode = (s: string) =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));

// 붙여넣은 글에서 링크만 뽑는다 (쇼핑앱 "공유하기"는 상품명과 링크를 같이 복사함)
export const extractUrl = (text: string) => text.match(/https?:\/\/\S+/)?.[0] ?? null;

export const openLink = (url: string) => Linking.openURL(url.startsWith('http') ? url : `https://${url}`).catch(() => {});
