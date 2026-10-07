// AI모아: 주문 캡처 / 영수증 이미지를 Gemini로 읽어 구매 정보(JSON)로 돌려준다.
// Supabase 대시보드 > Edge Functions 에 이름 "parse-receipt" 로 배포.
// 필요한 Secret: GEMINI_API_KEY  (선택: GEMINI_MODEL)
// AI 공급자를 바꾸려면 이 파일만 고치면 된다.

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// 무료 등급 모델. 첫 번째가 바쁘거나 한도에 걸리면 다음 모델로 다시 시도한다.
const MODELS = [Deno.env.get('GEMINI_MODEL') ?? 'gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite'];

const PROMPT = `이 이미지는 한국 온라인 쇼핑몰의 주문/결제 화면 캡처이거나 오프라인 매장 영수증이다.
구매한 상품 정보를 추출해라.
- store: 쇼핑몰 또는 매장 이름 (예: 쿠팡, 네이버, 11번가, 이마트, 다이소). 모르면 "알 수 없음"
- order_date: 주문/구매/결제 날짜 YYYY-MM-DD. 연도가 없으면 올해(또는 가장 최근의 그 날짜). 없으면 빈 문자열
- items: 상품마다 하나씩
  - name: 상품명. 브랜드와 핵심 규격(용량, 개수)만 남기고 짧게 (예: "잘풀리는집 두루마리 휴지 30롤")
  - quantity: 수량 (숫자, 없으면 1)
  - price: 그 상품의 결제 금액(원, 숫자). 할인 후 금액 우선. 모르면 0
  - category: 생활용품, 식품, 학용품, 기타 중 하나
  - emoji: 그 상품을 가장 잘 나타내는 이모지 1개 (예: 귤 🍊, 찹쌀가루 🌾, 그릭요거트 🥣, 휴지 🧻, 연필 ✏️). 상품 자체의 모양을 우선
- total: 총 결제 금액(원, 숫자). 모르면 0
- eta: 배송 도착 예정 문구를 짧게 (예: "10/5(일) 도착 예정", "내일 도착"). 영수증이거나 없으면 빈 문자열
- delivered_date: 물건을 받은 날짜 YYYY-MM-DD. 오프라인 영수증이면 구매일과 같음. 화면에 없으면 빈 문자열
  "9/28(일) 도착완료", "09.28 배송완료", "도착 9월 28일", "28일(일) 도착", "배송완료 · 9/28" 처럼 쓰인 날짜도 모두 찾아라.
  연도가 없으면 주문일의 연도를 쓰고, 그 결과가 주문일보다 이르면 다음 해로 해라.
- delivery_status: 지금 배송 상태
  - "delivered": 오프라인 매장 영수증(이미 받은 물건), 또는 화면에 배송완료/도착완료/수령완료/구매확정이 보임
  - "shipping": 배송중/배송 시작/출고 완료/배송 출발
  - "ordered": 결제완료/주문완료/상품준비중, 또는 알 수 없음
배송비, 쿠폰, 포인트는 상품에 넣지 마라. 상품이 안 보이면 items 를 빈 배열로.
이름, 주소, 전화번호 같은 개인정보는 절대 출력하지 마라.`;

const SCHEMA = {
  type: 'object',
  properties: {
    store: { type: 'string' },
    order_date: { type: 'string' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          quantity: { type: 'integer' },
          price: { type: 'integer' },
          category: { type: 'string', enum: ['생활용품', '식품', '학용품', '기타'] },
          emoji: { type: 'string' },
        },
        required: ['name', 'quantity', 'price', 'category', 'emoji'],
      },
    },
    total: { type: 'integer' },
    eta: { type: 'string' },
    delivery_status: { type: 'string', enum: ['ordered', 'shipping', 'delivered'] },
    delivered_date: { type: 'string' },
  },
  required: ['store', 'order_date', 'items', 'total', 'eta', 'delivery_status', 'delivered_date'],
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

// 응답에서 모델이 쓴 글자만 모은다
function extractText(data: Record<string, unknown>): string {
  if (typeof data.output_text === 'string') return data.output_text;
  const steps = (data.steps ?? data.outputs ?? []) as { type?: string; text?: string; content?: { type?: string; text?: string }[] }[];
  return steps
    .flatMap((s) => (s.content ? s.content : [s]))
    .filter((c) => c.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text)
    .join('');
}

async function callGemini(model: string, image: string, mimeType: string, key: string) {
  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      model,
      store: false,
      input: [
        { type: 'text', text: PROMPT },
        { type: 'image', data: image, mime_type: mimeType },
      ],
      response_format: { type: 'text', mime_type: 'application/json', schema: SCHEMA },
      generation_config: { thinking_level: 'low' },
    }),
  });
  if (!res.ok) return { ok: false as const, status: res.status, detail: (await res.text()).slice(0, 500) };
  const text = extractText(await res.json()).replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
  return { ok: true as const, result: JSON.parse(text) };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST만 지원해요' }, 405);

  const key = Deno.env.get('GEMINI_API_KEY');
  if (!key) return json({ error: '서버에 GEMINI_API_KEY 가 설정되지 않았어요' }, 500);

  let image: string, mimeType: string;
  try {
    ({ image, mimeType = 'image/jpeg' } = await req.json());
  } catch {
    return json({ error: '요청 형식이 잘못됐어요' }, 400);
  }
  if (!image) return json({ error: '이미지가 없어요' }, 400);
  if (image.length > 8_000_000) return json({ error: '이미지가 너무 커요. 상품 부분만 잘라서 올려 주세요' }, 413);

  let last = '';
  for (const model of MODELS) {
    try {
      const r = await callGemini(model, image, mimeType, key);
      if (r.ok) return json({ ...r.result, model });
      last = `${model}: ${r.status} ${r.detail}`;
      // 한도 초과(429)나 서버 혼잡(5xx), 모델 없음(404)이면 다음 모델로
      if (![404, 429, 500, 503].includes(r.status)) break;
    } catch (e) {
      last = `${model}: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  console.error(last);
  return json({ error: 'AI가 이미지를 읽지 못했어요. 잠시 후 다시 시도해 주세요', detail: last }, 502);
});
