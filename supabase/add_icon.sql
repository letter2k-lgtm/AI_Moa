-- AI모아: 카드마다 아이콘(이모지)을 저장하는 칸 추가
-- Supabase > SQL Editor 에 붙여넣고 Run (여러 번 실행해도 안전, 기존 데이터는 그대로)
-- - 영수증/캡처를 AI가 읽을 때 고른 이모지가 여기에 저장된다
-- - 카드 상세의 "아이콘 바꾸기"로 직접 고른 이모지도 여기에 저장된다
-- - 비어 있으면 앱이 물건 이름으로 아이콘을 고른다 (지금처럼)
alter table public.items add column if not exists icon text;
