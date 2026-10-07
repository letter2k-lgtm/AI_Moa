-- AI모아: 한 가족 안에서 같은 이름으로 참여하지 못하게 막기
-- Supabase > SQL Editor 에 전체를 붙여넣고 Run (한 번만)

-- 1) 지금 같은 이름이 두 번 있는 경우 정리: 먼저 들어온 쪽(사파리 등)을 지운다
delete from public.members m
using public.members newer
where m.family_id = newer.family_id
  and m.name = newer.name
  and m.created_at < newer.created_at;

-- 2) 초대 코드로 참여할 때 같은 이름이 있으면 거절
create or replace function public.join_family(p_code text, p_member_name text)
returns public.families
language plpgsql security definer set search_path = public
as $$
declare
  fam public.families;
begin
  if auth.uid() is null then raise exception '로그인이 필요해요'; end if;
  select * into fam from public.families where invite_code = upper(trim(p_code));
  if fam.id is null then raise exception '초대 코드를 찾을 수 없어요'; end if;
  if exists (
    select 1 from public.members
    where family_id = fam.id and name = trim(p_member_name) and id <> auth.uid()
  ) then
    raise exception '이미 "%"(이)라는 구성원이 있어요. 다른 이름으로 참여해 주세요 (예: %2, 첫째)', trim(p_member_name), trim(p_member_name);
  end if;
  insert into public.members (id, family_id, name) values (auth.uid(), fam.id, trim(p_member_name))
    on conflict (id) do update set family_id = excluded.family_id, name = excluded.name, role = '구성원';
  return fam;
end $$;

revoke execute on function public.join_family(text, text) from public, anon;
grant execute on function public.join_family(text, text) to authenticated;

-- 3) 앞으로 같은 이름이 생기지 않도록 데이터베이스에서도 막기
create unique index if not exists members_family_name_unique on public.members (family_id, name);
