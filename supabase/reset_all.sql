-- AI모아 전체 초기화: 모든 가족, 구성원, 요청 카드, 기록을 지운다 (되돌릴 수 없음)
-- 실행 후 각 폰에서 앱을 껐다 켜면 "새 가족 만들기 / 초대 코드로 참여" 화면부터 다시 시작한다.
-- 테이블 구조와 보안 규칙, 서버 함수는 그대로 남는다.

truncate table public.item_events, public.items, public.members, public.families restart identity cascade;
