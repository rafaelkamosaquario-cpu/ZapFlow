-- Camada 3 — Hardening pós-advisor.
-- O security advisor do próprio Supabase sinalizou, logo após a migration 5,
-- que as funções SECURITY DEFINER estavam expostas como RPC público
-- (chamáveis por anon/authenticated via /rest/v1/rpc/<funcao>) e que a
-- extensão btree_gist ficou no schema public. Esta migration corrige os dois
-- avisos.

-- handle_new_user só deve rodar via trigger on_auth_user_created — nunca
-- deve ser chamável diretamente por ninguém.
revoke execute on function public.handle_new_user() from public;
revoke execute on function public.handle_new_user() from anon;
revoke execute on function public.handle_new_user() from authenticated;

-- is_company_member / has_company_role / default_company_id só precisam ser
-- executáveis por usuários autenticados (é como as policies de RLS as
-- chamam); anon nunca deve poder chamá-las via RPC direto.
revoke execute on function public.is_company_member(uuid) from public;
revoke execute on function public.is_company_member(uuid) from anon;
grant execute on function public.is_company_member(uuid) to authenticated;

revoke execute on function public.has_company_role(uuid, public.company_member_role[]) from public;
revoke execute on function public.has_company_role(uuid, public.company_member_role[]) from anon;
grant execute on function public.has_company_role(uuid, public.company_member_role[]) to authenticated;

revoke execute on function public.default_company_id() from public;
revoke execute on function public.default_company_id() from anon;
grant execute on function public.default_company_id() to authenticated;

-- move a extensão btree_gist para fora do schema public, como recomendado
-- pelo linter de segurança do Supabase.
alter extension btree_gist set schema extensions;
