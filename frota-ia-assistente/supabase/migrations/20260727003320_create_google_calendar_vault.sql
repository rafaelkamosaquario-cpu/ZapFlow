-- Camada 4 — Módulo Google Calendar: armazenamento seguro do refresh token.
--
-- Reaproveita google_integrations/calendar_action_logs da Camada 3 (nenhuma
-- tabela nova). Usa a extensão supabase_vault, já habilitada no projeto,
-- como mecanismo de criptografia — não é criptografia caseira.
--
-- Só o refresh token é persistido (sempre trocado por um access token novo
-- na hora de cada chamada à API do Calendar). O access token em si nunca é
-- gravado em lugar nenhum, nem no Vault.
--
-- As 3 funções abaixo são o único ponto de acesso ao segredo. São
-- SECURITY DEFINER, search_path fixo, e o EXECUTE é liberado somente para
-- service_role — nem anon nem authenticated podem chamá-las, então o
-- token só é alcançável a partir do backend (nunca do navegador).

alter table public.google_integrations
  add column refresh_token_secret_id uuid references vault.secrets (id) on delete set null;

comment on column public.google_integrations.refresh_token_secret_id is
  'Referência ao segredo no Supabase Vault (vault.secrets) que guarda o refresh token do Google Calendar. Nunca lido/gravado fora das funções store/read/delete_google_refresh_token.';

-- ── store ────────────────────────────────────────────────────────────────

create or replace function public.store_google_refresh_token(
  p_google_integration_id uuid,
  p_refresh_token text
)
returns uuid
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_existing_secret_id uuid;
  v_secret_id uuid;
begin
  select refresh_token_secret_id into v_existing_secret_id
  from public.google_integrations
  where id = p_google_integration_id;

  if v_existing_secret_id is not null then
    perform vault.update_secret(v_existing_secret_id, p_refresh_token);
    v_secret_id := v_existing_secret_id;
  else
    v_secret_id := vault.create_secret(p_refresh_token);

    update public.google_integrations
      set refresh_token_secret_id = v_secret_id
      where id = p_google_integration_id;
  end if;

  return v_secret_id;
end;
$$;

comment on function public.store_google_refresh_token(uuid, text) is
  'Grava (cria ou substitui) o refresh token do Google Calendar no Vault para a integração informada. Uso restrito a service_role.';

revoke execute on function public.store_google_refresh_token(uuid, text) from public;
revoke execute on function public.store_google_refresh_token(uuid, text) from anon;
revoke execute on function public.store_google_refresh_token(uuid, text) from authenticated;
grant execute on function public.store_google_refresh_token(uuid, text) to service_role;

-- ── read ─────────────────────────────────────────────────────────────────

create or replace function public.read_google_refresh_token(p_google_integration_id uuid)
returns text
language sql
security definer
stable
set search_path = public, vault
as $$
  select ds.decrypted_secret
  from public.google_integrations gi
  join vault.decrypted_secrets ds on ds.id = gi.refresh_token_secret_id
  where gi.id = p_google_integration_id;
$$;

comment on function public.read_google_refresh_token(uuid) is
  'Lê (decriptado) o refresh token do Google Calendar da integração informada. Uso restrito a service_role — nunca exposto via RPC público.';

revoke execute on function public.read_google_refresh_token(uuid) from public;
revoke execute on function public.read_google_refresh_token(uuid) from anon;
revoke execute on function public.read_google_refresh_token(uuid) from authenticated;
grant execute on function public.read_google_refresh_token(uuid) to service_role;

-- ── delete ───────────────────────────────────────────────────────────────

create or replace function public.delete_google_refresh_token(p_google_integration_id uuid)
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_secret_id uuid;
begin
  select refresh_token_secret_id into v_secret_id
  from public.google_integrations
  where id = p_google_integration_id;

  update public.google_integrations
    set refresh_token_secret_id = null,
        connection_status = 'revoked',
        calendar_enabled = false
    where id = p_google_integration_id;

  if v_secret_id is not null then
    delete from vault.secrets where id = v_secret_id;
  end if;
end;
$$;

comment on function public.delete_google_refresh_token(uuid) is
  'Remove o refresh token do Vault e marca a integração como revoked. Uso restrito a service_role. Idempotente (seguro chamar mesmo sem token salvo).';

revoke execute on function public.delete_google_refresh_token(uuid) from public;
revoke execute on function public.delete_google_refresh_token(uuid) from anon;
revoke execute on function public.delete_google_refresh_token(uuid) from authenticated;
grant execute on function public.delete_google_refresh_token(uuid) to service_role;
