# Fase 2 do chat + Onboarding — o que foi construído

Fecha as 3 pendências listadas no relatório de status: chat real com a
Claude API (com roteador de ferramentas), UI de onboarding (empresa +
veículo), e o ponto de entrada para conectar a Agenda Google.

## 1. Autenticação passou a ser obrigatória

`src/app/page.tsx` agora é um Server Component que exige sessão (redireciona
para `/login`), depois exige empresa e veículo cadastrados (redireciona
para `/onboarding`). **Isso é uma mudança de comportamento real**: antes,
o chat abria direto para qualquer visitante (Fase 1, sem login). Não dá
para testar esse fluxo ponta a ponta neste momento porque o login com
Google (Camada 3) ainda depende das mesmas credenciais do Google Cloud que
o módulo Calendar (Camada 4) — nenhuma delas existe ainda.

- `src/components/providers/AuthProvider.tsx` — estado de sessão
  (`useAuth()`) disponível em toda a árvore client-side.
- `src/app/login/page.tsx` — botão "Continuar com Google"
  (`authService.signInWithGoogle`).

## 2. Onboarding (empresa + veículo)

`src/app/onboarding/` — página server-side que decide o passo (1: criar
empresa: se ainda não existe uma vinculada ao usuário; 2: cadastrar
veículo) e Server Actions (`actions.ts`, `"use server"`) que chamam os
services já existentes da Camada 3 (`companyService.createCompanyWithOwner`,
`vehicleService.createVehicle`) — nenhum service novo foi necessário.
Usa `useActionState`/`useFormStatus` (React 19) para erro inline e estado
de carregamento sem JavaScript extra.

Cadastro de veículo pode ser pulado ("Cadastrar depois") — mas hoje `/`
exige um veículo para liberar o chat (ver seção 1); ajustar isso é uma
decisão de produto em aberto (ver Limitações).

## 3. Conectar a Agenda Google

`Header` mostra um botão "Conectar Agenda" (link para
`/auth/calendar/connect`, já existente desde a Camada 4) sempre que
`checkCalendarConnection` (verificado no `page.tsx`, server-side) retornar
não conectado. Nenhuma tela nova — reaproveita a rota que já existia.

## 4. Chat real com a Claude API

**O "roteador de ferramentas" que faltava desde a Camada 3/4 é a própria
Claude API com tool use** — não foi construído um mecanismo de intenção à
parte. O Claude recebe as 12 ferramentas como `tools` e decide sozinho
quando (e se) chamar cada uma, a partir da mensagem do usuário.

- `src/lib/anthropic/client.ts` — cliente Anthropic (`ANTHROPIC_API_KEY`),
  modelo `claude-sonnet-5`.
- `src/lib/anthropic/tools.ts` — converte as 12 ferramentas
  (`FERRAMENTAS_FROTA_IA`) para o formato de tool use da Anthropic. Some do
  schema exposto ao Claude os campos de identidade (`userId`, `companyId`,
  `conversationId`) — esses são sempre injetados pelo backend depois que o
  Claude decide chamar uma ferramenta, nunca aceitos do que o modelo
  "imaginou" (mesmo princípio de não confiar em `company_id` vindo do
  cliente, usado nas policies de RLS da Camada 3).
- `src/lib/anthropic/systemPrompt.ts` — informa ao Claude a empresa, o
  veículo padrão e o perfil de custo já salvos (para não perguntar de novo),
  a data/hora atual no fuso da empresa (necessário para
  `gerenciar_google_calendar` resolver "amanhã às 8h" em ISO absoluto) e as
  regras invioláveis (nunca inventar dado, sempre confirmar antes de
  excluir evento, etc.).
- `src/app/api/chat/route.ts` — a rota em si: autentica, carrega contexto,
  persiste a mensagem do usuário, roda o loop de tool use (até 4 rodadas),
  executa cada ferramenta chamada via `saveToolExecution` (grava em
  `tool_executions` para auditoria), persiste a resposta final e devolve.

### Limitação conhecida do schema das ferramentas

`DefinicaoParametroFerramenta` (contrato usado pelas 12 ferramentas desde
a Camada 2) só descreve campos primitivos — não expressa objetos ou listas
aninhadas (`opcoes` de `comparar_pneus`, `periodos`/`motoristas` de
`calcular_jornada` etc.). O schema enviado ao Claude para esses campos é
"aberto" (`additionalProperties: true`): o Claude ainda consegue enviar
essa estrutura mais rica com base na descrição em texto da ferramenta, só
sem validação estrita. Como toda ferramenta já valida a entrada de forma
defensiva e explica o que falta em vez de quebrar (nenhuma ferramenta foi
alterada para isso), é seguro — só menos preciso do que um schema completo
por ferramenta seria. Registrado como melhoria futura, não corrigido agora
por ser um esforço grande por si só (schema completo para as 12
ferramentas).

## 5. Conversas migraram de `localStorage` para o Supabase

- `src/services/chatService.ts` / `src/services/aiService.ts` — reescritos
  para chamar as rotas reais (`/api/conversations`, `/api/chat`) em vez de
  lançar "Fase 2 não implementada".
- `src/hooks/useConversations.ts` / `src/hooks/useChat.ts` — mesma
  assinatura pública de antes (nenhum componente de UI mudou), reescritos
  por dentro para buscar do servidor e cachear localmente.
- `src/app/api/conversations/route.ts` (lista), `[id]/route.ts` (exclui —
  soft delete, `status = 'archived'`), `[id]/messages/route.ts`
  (histórico paginado).

## 6. Testes executados

- `npx tsc --noEmit -p .`, `npm run lint`, `npm run build` — todos limpos.
- Smoke test real: subi o `npm run dev` neste ambiente com as variáveis
  públicas do Supabase (`NEXT_PUBLIC_SUPABASE_URL`/`PUBLISHABLE_KEY`) e
  confirmei via HTTP que `/` responde `307` para `/login` (gate de
  autenticação funcionando de verdade, não só no papel) e que `/login`
  renderiza sem nenhum erro de console.
- Cliquei em "Continuar com Google" no navegador headless: a navegação
  para o provedor OAuth falhou por causa da rede deste sandbox (não chega
  a ser um teste real do provider, que também não está configurado no
  Supabase ainda) — nenhum erro de JavaScript, o clique disparou a chamada
  correta.

**Não testado** (exige credenciais que não existem neste ambiente): login
completo, onboarding ponta a ponta (precisa de um usuário autenticado
real), o chat de verdade conversando com o Claude (`ANTHROPIC_API_KEY`
ausente), qualquer ferramenta sendo chamada pelo modelo em uma conversa
real.

## 7. Limitações e decisões em aberto

- `/` exige empresa **e** veículo cadastrados para liberar o chat, mesmo
  que o usuário tenha clicado em "Cadastrar depois" no onboarding — nesse
  caso ele fica preso num loop de redirecionamento entre `/` e
  `/onboarding`. Decisão de produto pendente: permitir chat sem veículo
  cadastrado, ou tornar o veículo obrigatório de verdade (removendo o
  "pular")?
- `createCompanyWithOwner` continua não-atômico (já documentado na Camada
  3) — sem mudança aqui.
- Sem paginação de "carregar mais mensagens antigas" na UI (o serviço já
  suporta página, só não tem botão).
- Sem streaming de resposta (a mensagem do Claude aparece de uma vez,
  não token a token).
