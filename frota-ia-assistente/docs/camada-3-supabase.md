# Camada 3 — Identidade, Dados e Memória do Cliente (Supabase)

Documentação técnica da Camada 3 do Frota IA: o projeto Supabase próprio e
isolado (`frotaia`), o modelo de dados V1, RLS, integração com as 11
ferramentas internas, e preparação (não execução) de login com Google e
futura Google Calendar.

Esta camada **não transforma o Frota IA em ERP/TMS**. Ela só dá à IA
identidade do usuário, memória operacional e dados estruturados suficientes
para não perguntar a mesma coisa duas vezes — conforme o objetivo original
da V1 (ver `AGENTS.md`/prompt da Camada 3).

## 1. Arquitetura

```
Next.js 16 (App Router)
  ├─ src/lib/supabase/          cliente browser, server, admin + types gerados
  ├─ src/lib/validation/        schemas Zod (validação antes de qualquer insert/update)
  ├─ src/services/supabase/     1 arquivo por domínio, sempre recebe o client por injeção
  ├─ src/ai/context/            ponte entre Supabase e as 11 ferramentas puras (src/ai/tools)
  ├─ src/app/auth/callback/     rota de callback do OAuth (Google via Supabase Auth)
  └─ src/proxy.ts               refresh de sessão a cada requisição (era middleware.ts
                                 até o Next 15; nesta versão 16 a convenção é "proxy")
```

Princípio central: **Supabase nunca calcula nada.** Ele só guarda identidade,
dados estruturados e memória. Quem calcula continua sendo exclusivamente as
11 ferramentas de `src/ai/tools/`, que seguem puras — nenhuma delas importa
Supabase. A camada de contexto (`src/ai/context/customerContext.ts`) é quem
busca dados do banco e monta a `entrada` da ferramenta antes de chamá-la.

## 2. Projeto Supabase

- Nome: **frotaia**
- Project ref: `kqquswdrtcqicyfcvvuv`
- Região: `us-east-1`
- Plano: **Pro** (confirmado via API do Supabase)
- **Isolado do ZapFlow**: o ZapFlow (projeto na raiz do repositório, disparo
  de WhatsApp via Z-API) tem seu próprio projeto Supabase (`zapflow`,
  `ssxhtyvzvjfopbghflml`) — completamente separado. Nenhuma tabela, função
  ou policy é compartilhada entre os dois.

O projeto `frotaia` já existia antes desta etapa, com 8 tabelas de um
sistema de checklist/alerta via WhatsApp (`veiculos`, `motoristas`,
`documentos`, `manutencoes`, `checklists`, `checklist_logs`, `alertas`,
`configuracoes`) — sem RLS, sem migration rastreada, 0 linhas, não
consumidas por nenhum código deste repositório (achado da auditoria da
etapa anterior). **Essas 8 tabelas não foram tocadas.** O modelo V1 desta
Camada 3 foi criado ao lado, com nomes em inglês, sem nenhuma colisão de
nome. Decisão de reestruturar/aposentar as tabelas antigas fica para uma
etapa futura, com autorização explícita.

## 3. Modelo de dados

16 tabelas novas, em 4 grupos (uma migration por grupo):

**Identidade** (`create_core_identity`)
- `profiles` — complemento de `auth.users`, 1:1, criado por trigger.
- `companies` — empresa/transportadora/autônomo/embarcador.
- `company_members` — vínculo usuário × empresa × papel (`owner`, `admin`,
  `operator`, `viewer`).
- `user_channels` — identidade externa (WhatsApp/Z-API) vinculada a um
  usuário.

**Perfis operacionais** (`create_operational_profiles`)
- `vehicles` — só o que a IA precisa para calcular (sem documentos,
  manutenção completa ou implementos nesta V1).
- `vehicle_cost_profiles` — parâmetros de custo, com histórico por período
  (nunca dois perfis ativos sobrepostos para o mesmo veículo — garantido por
  exclusion constraint).
- `vehicle_tire_profiles` — premissas para `calcular_cpk`/`comparar_pneus`
  (não é gestão de pneus).
- `saved_routes` — rotas frequentes informadas manualmente
  (`data_source = 'manual'` por padrão; nunca tratado como oficial).
- `company_preferences` — 1 linha por empresa, com os padrões (moeda BRL,
  km, pt-BR, memória automática configurável).

**Memória operacional** (`create_ai_memory`)
- `conversations` / `messages` — histórico de conversa, paginado.
- `ai_memories` — fatos duradouros com `confidence`, `status`
  (`active`/`superseded`/`rejected`/`deleted`) e vínculo de origem.
- `analysis_runs` — uma análise pedida pelo cliente.
- `tool_executions` — execução de uma das 11 ferramentas (`tool_name`
  restrito por enum aos 11 nomes reais).

**Google** (`create_google_integration_metadata`)
- `google_integrations` — metadado não sensível da conexão (sem tokens).
- `calendar_action_logs` — log de ações de agenda (API ainda não chamada).

Mais duas migrations: `create_rls_policies` (RLS + policies + funções
auxiliares) e `create_indexes_constraints` (índices e a exclusion
constraint de `vehicle_cost_profiles`). Uma sétima, aplicada depois,
`harden_security_definer_functions`, corrige avisos do security advisor do
próprio Supabase (ver seção 16).

## 4. Diagrama textual

```
auth.users
  └── profiles.id
  └── company_members.user_id ── companies.id
  └── user_channels.user_id
  └── google_integrations.user_id

companies
  ├── company_members.company_id
  ├── vehicles.company_id
  ├── saved_routes.company_id
  ├── company_preferences.company_id (1:1)
  ├── conversations.company_id
  ├── ai_memories.company_id
  ├── analysis_runs.company_id
  └── tool_executions.company_id

vehicles
  ├── vehicle_cost_profiles.vehicle_id
  ├── vehicle_tire_profiles.vehicle_id
  ├── saved_routes.vehicle_id (opcional)
  └── ai_memories.vehicle_id (opcional)

conversations
  ├── messages.conversation_id
  └── tool_executions.conversation_id (opcional)

messages
  └── tool_executions.message_id / messages.tool_call_id → tool_executions.id

analysis_runs
  └── tool_executions.analysis_run_id (opcional)

google_integrations
  └── calendar_action_logs.google_integration_id
```

## 5. Autenticação

- Supabase Auth, provider Google (OAuth), configurado no painel do
  Supabase — o app Next.js nunca guarda o client secret do Google.
- `src/services/supabase/authService.ts` → `signInWithGoogle()`,
  `signOut()`.
- `src/app/auth/callback/route.ts` troca o `code` pela sessão.
- `src/proxy.ts` atualiza o token a cada requisição.
- Trigger `on_auth_user_created` cria o `profile` automaticamente.
- Onboarding (criação de empresa + vínculo owner) fica em
  `companyService.createCompanyWithOwner()` — chamado pela UI que ainda
  precisa ser construída (fora do escopo desta etapa: só a infraestrutura
  foi preparada, sem redesenhar a interface de chat existente).

## 6. Fluxo do WhatsApp (preparado, não conectado ao Z-API ainda)

```
mensagem chega (Z-API)
  → normaliza telefone para E.164
  → verifica external_message_id (dedup) — índice único idx_messages_external_message_id
  → channelIdentityService.findChannelByExternalId(admin, "z_api", externalUserId)
  → se não encontrado: fluxo de associação seguro (não implementado nesta
    etapa — não existe UI de onboarding via WhatsApp ainda; documentado
    como pendência da Camada 4)
  → se encontrado: usuário + empresa padrão (company_members.is_default)
  → customerContext.loadCustomerContext + loadVehicleContext
  → conversationService.getOrCreateOpenConversation
  → conversationService.appendMessage (mensagem recebida)
  → [processamento da IA — Fase 2, ainda não implementado]
  → toolExecutionService (via saveToolExecution) + analysisHistoryService
  → conversationService.appendMessage (resposta)
```

Este fluxo usa o **client admin** (`src/lib/supabase/admin.ts`), porque a
mensagem chega antes de qualquer sessão Supabase Auth existir. Nenhuma
alteração foi feita no `server.js`/Z-API do ZapFlow.

## 7. Fluxo de memória

`ai_memories` nunca sobrescreve silenciosamente: `memoryService.saveMemory`
marca a memória anterior (mesma `company_id` + `memory_type` + `key`) como
`superseded` antes de inserir a nova. `rejectMemory`/`deleteMemory` são soft
(mudam `status`, nunca fazem `DELETE`). Dado estruturado (veículo, custo,
pneu, rota) tem tabela própria e é sempre preferido a `ai_memories` — a
tabela de memória é para o que não cabe em coluna própria.

## 8. Integração com as 11 ferramentas

`src/ai/context/customerContext.ts` expõe `loadCustomerContext`,
`loadVehicleContext`, `resolveDefaultVehicle`, `saveAnalysisRun`,
`saveToolExecution`, `saveConfirmedMemory`. Nenhuma ferramenta foi alterada;
nenhuma fórmula foi tocada. `saveToolExecution` só mede duração e grava
entrada/saída em volta da chamada síncrona a `ferramenta.executar(...)`.

## 9. Comandos Supabase usados

```
npx supabase init
npx supabase migration new <nome>      # × 7
npx supabase telemetry disable
```

`link`/`db push`/`gen types` da CLI **não foram usados por não serem
alcançáveis** a partir deste sandbox (ver seção 15). Em vez disso, as
migrations foram aplicadas e os types gerados através das ferramentas MCP
do Supabase (`apply_migration`, `generate_typescript_types`), que têm canal
próprio autenticado com a API do Supabase — resultado funcionalmente
idêntico ao da CLI, sem precisar de senha de banco em lugar nenhum.

## 10. Variáveis de ambiente

Ver `.env.example` atualizado. Resumo:

| Variável | Onde | Observação |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | client + server | pública, segura |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | client + server | pública, segura |
| `SUPABASE_SECRET_KEY` | só backend | **nunca** no navegador; pegar no painel |
| `SUPABASE_PROJECT_REF` | scripts/CLI | não é segredo |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` | painel do Supabase | documentação apenas — não lidas pelo Next.js |

## 11. Configuração do Google (checklist manual — pendente)

1. Criar/selecionar projeto no Google Cloud Console.
2. Configurar a tela de consentimento OAuth.
3. Criar um OAuth Client (tipo "Web application").
4. Adicionar como redirect URI autorizado:
   `https://kqquswdrtcqicyfcvvuv.supabase.co/auth/v1/callback`
5. No painel do Supabase → Authentication → Providers → Google: colar
   Client ID e Client Secret, habilitar o provider.
6. Adicionar as URLs de callback locais e de produção em Authentication →
   URL Configuration.
7. Ativar a Google Calendar API no Google Cloud **só quando for autorizado
   chamá-la de fato** (não nesta etapa).
8. Escopos mínimos para a futura Agenda: priorizar criar evento e
   consultar próximos eventos; atualizar/excluir ficam para depois.

Sem o Client ID/Secret reais, o login com Google não pode ser testado
ponta a ponta nesta etapa — o código está pronto e é ativado assim que as
credenciais forem cadastradas no painel do Supabase.

## 12. Configuração local

Docker não está disponível neste ambiente (daemon não sobe por restrição de
permissão do sandbox) — `supabase start`/`db reset` local não puderam ser
executados. `supabase/config.toml` já existe e funciona normalmente em
qualquer máquina com Docker disponível.

## 13. Aplicação das migrations

As 7 migrations em `supabase/migrations/` foram validadas com um parser SQL
real (`pglast`, sem tocar o banco) e então aplicadas em sequência no projeto
remoto `frotaia` via `apply_migration` (MCP). Todas retornaram sucesso.
`list_migrations` no projeto confirma as 6 primeiras rastreadas (a 7ª,
`harden_security_definer_functions`, foi aplicada depois para corrigir
avisos do advisor — ver seção 16).

## 14. Geração de tipos

`src/lib/supabase/database.types.ts` foi gerado via `generate_typescript_types`
(MCP), equivalente a `supabase gen types typescript --project-id
kqquswdrtcqicyfcvvuv --schema public`. Aliases `Row`/`Insert`/`Update` por
tabela ficam em `src/lib/supabase/tables.ts`.

## 15. Testes executados

- `npx tsc --noEmit -p .` — limpo.
- `npm run lint` (ESLint) — limpo.
- `npm run build` (Next.js/Turbopack) — build de produção completo, sem
  erros nem avisos.
- Validação de sintaxe SQL das 7 migrations com `pglast` antes de aplicar
  qualquer uma no banco remoto.
- Verificação pós-migration via `get_advisors` (security + performance) do
  próprio Supabase — ver seção 16.

**Não executados nesta etapa** (limitação de ambiente, não de escopo):
testes de RLS ponta a ponta com usuários reais (precisa de pelo menos dois
usuários autenticados de teste, que não existem no projeto — `auth.users`
está com 0 linhas), testes de carga/paginação de mensagens em volume, teste
real do fluxo OAuth do Google (sem credenciais).

## 16. Segurança verificada

Rodei o security advisor do Supabase antes e depois das migrations:

- **Antes**: nenhuma tabela nova existia.
- **Logo após a migration de RLS**: 4 avisos de funções `SECURITY DEFINER`
  chamáveis via RPC por `anon`/`authenticated`
  (`is_company_member`, `has_company_role`, `default_company_id`,
  `handle_new_user`) + 1 aviso de extensão (`btree_gist`) instalada no
  schema `public`.
- **Depois da migration `harden_security_definer_functions`**: os avisos de
  `anon` e o de extensão desapareceram. `handle_new_user` não é mais
  executável por ninguém via RPC (só roda via trigger). Restam 3 avisos
  `WARN` esperados: `is_company_member`/`has_company_role`/`default_company_id`
  continuam chamáveis por `authenticated` — **intencional**, é assim que as
  próprias policies de RLS os usam.
- As 8 tabelas antigas (`veiculos`, `motoristas`, etc.) continuam sem RLS —
  fora do escopo desta etapa por decisão explícita (ver seção 2).

## 17. Rollback

Não existe rollback automático nesta V1 (nenhuma migration `down` foi
escrita — o Supabase CLI/`apply_migration` não geram isso automaticamente).
Como as 16 tabelas novas estão isoladas (nomes próprios, sem FK para as 8
tabelas antigas) e sem nenhuma linha de dado real ainda, reverter — se
necessário — seria um `DROP TABLE`/`DROP TYPE` manual na ordem inversa das
migrations. Nenhum rollback foi executado ou é necessário no momento.

## 18. Limitações conhecidas desta etapa

- Sem UI de onboarding (criar empresa, convidar membro, cadastrar veículo)
  — só a infraestrutura (services + validação) foi construída.
- `createCompanyWithOwner` não é atômico (dois inserts sequenciais); ver
  comentário no código.
- Login com Google não testado ponta a ponta (sem credenciais).
- Token do Google (access/refresh) deliberadamente **não** tem onde ser
  persistido nesta V1 — sem mecanismo de criptografia seguro disponível.
  Fica pendente para a Camada 4.
- Google Calendar API real não é chamada em nenhum lugar.
- Fluxo do WhatsApp está documentado e as peças (dedup, contexto, memória)
  existem como services, mas não há integração de fato com o `server.js`
  do ZapFlow — são projetos e Supabase separados por decisão do usuário.
- RLS não foi testado com usuários reais (0 usuários no projeto).

## 19. Próximos passos (Camada 4)

- Onboarding real (UI): criar empresa, convidar membros, cadastrar veículo.
- Conectar o processamento de IA (Fase 2 do chat) ao
  `customerContext`/`saveToolExecution`.
- Decidir e implementar o mecanismo seguro de persistência do refresh token
  do Google (ou confirmar que a sessão do Supabase Auth já é suficiente
  sem token adicional, se o uso planejado permitir).
- Testes de RLS com usuários de teste reais.
- Decidir o destino das 8 tabelas antigas do projeto `frotaia`
  (reestruturar, aposentar ou manter como estão).
