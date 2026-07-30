# Camada 6 — Frota IA V1 centrada no WhatsApp

Implementação em fases do prompt "FROTA IA V1 CENTRADA NO WHATSAPP". Este
documento é atualizado a cada fase concluída — a seção 0 tem o diagnóstico
completo feito antes de qualquer alteração, como pedido no prompt.

## 0. Diagnóstico da estrutura encontrada (antes de qualquer mudança)

O prompt presume um conjunto de integrações "já existentes" que **não
existem** neste repositório. Registrado aqui para não gerar confusão sobre
o que esta fase alterou vs. o que nunca existiu:

**Existe de verdade** (Camadas 1-5, sessões anteriores):
- 11 ferramentas de cálculo puro + `gerenciar_google_calendar` (12 no
  total) — `src/ai/tools/`
- Supabase: `profiles`, `companies`, `company_members`, `vehicles`,
  `user_channels`, `conversations`, `messages`, `ai_memories`,
  `analysis_runs`, `tool_executions`, `google_integrations`,
  `calendar_action_logs`, todas com RLS
- Google Calendar OAuth com link seguro de conexão (Camada 4)
- WhatsApp/Z-API: webhook de entrada, motor de resposta compartilhado com
  a web (Camada 5)
- Painel web com login Google + onboarding por formulário (Fase 2)

**NÃO existe** (o prompt trata como pronto, mas é construção nova):
Google Maps, rotas, pedágios, clima, ANTT, ANP, legislação, geração de
documentos/PDF, agendador de alertas proativos, busca de histórico em
linguagem natural como ferramenta, feature flags, onboarding conversacional
por estados, processamento de áudio/imagem/documento recebido.

Dado o tamanho real do escopo, a implementação foi dividida em fases (A a
G) — ver tarefas no início desta sessão. Este documento cresce conforme
cada fase é concluída e testada.

## Fase A — Identidade por telefone + onboarding conversacional + feature flags

### Identidade por telefone (seção 2 do prompt)

`src/lib/identity/phoneNormalizer.ts` — normaliza dígitos, corrige DDI
duplicado (`5555...` → `55...`), gera E.164. **Não usa telefone como chave
primária**: ele só localiza o `user_id` real via `user_channels.external_user_id`
(já existente desde a Camada 3, reaproveitado — nenhuma tabela nova para
identidade).

`src/services/supabase/userIdentityService.ts` —
`resolveOrCreateUserByPhone`: para um número desconhecido, cria um usuário
de verdade em `auth.users` via Admin API (`phone` + `phone_confirm: true`,
sem e-mail/senha) — necessário porque todo o schema (RLS via `auth.uid()`,
FKs de `companies`/`vehicles`) depende de um `auth.users.id` real. O
número é considerado verificado de imediato (a mensagem chegou por aquele
número na própria instância Z-API).

### Onboarding conversacional (seções 3-6)

Nova migration `create_onboarding_sessions`: tabela `onboarding_sessions`
(estado explícito — `not_started` a `completed`/`paused` — em vez de
depender do histórico de texto) + coluna `profiles.is_admin`. Nenhuma
tabela duplicada: `onboarding_sessions.collected_data` é só rascunho até
`completed`, quando os dados viram `companies`/`vehicles` de verdade via os
mesmos services já usados pelo onboarding web (`createCompanyWithOwner`,
`createVehicle` — zero duplicação de lógica).

`src/ai/whatsapp/onboardingConversation.ts` — função pura, uma pergunta
por vez: nome → perfil (autônomo/dono de frota/gestor de frota/
transportadora/outro, mapeado para o enum `company_type` já existente) →
cidade/UF base → quantidade de veículos → veículo principal (opcional,
aceita "depois"). Reconhece `cancelar`, `continuar depois`/`pausar` e
`pular` em qualquer etapa opcional.

`src/ai/whatsapp/finalizeOnboarding.ts` — ao concluir, cria a empresa
(`createCompanyWithOwner`), grava a quantidade de veículos como uma
memória estruturada (`ai_memories`, reaproveitando a Camada 3 em vez de
criar coluna nova) e cria o veículo principal se informado.

O webhook (`src/app/api/whatsapp/webhook/route.ts`) foi reescrito para:
número novo → cria usuário + começa onboarding; onboarding em andamento →
processa a próxima pergunta sem passar pela IA; onboarding concluído →
segue exatamente como antes (mesma engine de chat da Camada 5). Usuários
que já existiam antes desta fase (vindos do vínculo web da Camada 5) e já
têm empresa são tratados como onboarding concluído — nunca reabrimos o
onboarding de quem já usa o Frota IA.

### Feature flags (seção 14)

`src/lib/featureFlags.ts` — `CUSTOMER_PANEL_ENABLED` (padrão `false` na
V1) e `ADMIN_PANEL_ENABLED`. `src/app/page.tsx` e
`src/app/onboarding/page.tsx` (painel web) redirecionam para `/login` se a
flag estiver desligada e o usuário não tiver `profiles.is_admin = true`.
**Nenhuma rota, componente ou service do painel foi removido** — só
ganhou um gate a mais na entrada. `is_admin` nunca é setado pelo próprio
usuário, só via SQL direto por quem administra o projeto:

```sql
update public.profiles set is_admin = true where id = '<uuid do usuário>';
```

### Limitações conhecidas desta fase

- Extração de marca/modelo/ano do veículo principal é só texto livre
  (guardado em `vehicles.notes`) — não há parsing estruturado.
- Mensagens trocadas durante o onboarding não entram em `conversations`/
  `messages` (essas tabelas exigem `company_id`, que só existe depois do
  onboarding concluído) — não aparecem no histórico.
- `pausado` → ao retomar, a pergunta é escolhida pelo que falta em
  `collected_data`, não por um estado salvo separado do que já foi
  respondido.
- Não testado com tráfego real do Z-API (sem instância dedicada
  configurada neste ambiente) — `tsc`/`lint`/`build` limpos, fluxo
  validado por leitura de código, não por execução ponta a ponta.

## Fase B — Conectar Google pelo WhatsApp (seção 7)

Não precisou de fluxo novo — o link seguro de conexão já existia desde a
Camada 4 (`buildSecureConnectLink`, independente de canal). O que faltava
era a ferramenta `gerenciar_google_calendar` **devolver esse link** quando
a Agenda não está conectada, para a IA poder repassá-lo pelo WhatsApp.

- `gerenciar_google_calendar` ganhou o campo `linkConexao` no resultado,
  preenchido em `VERIFICAR_CONEXAO` e em qualquer chamada que falhe por
  `GoogleCalendarNotConnectedError` — só quando `isGoogleCalendarConfigured()`
  é verdadeiro (nunca devolve um link que sabe que vai falhar).
- Regra nova no system prompt: se a Agenda não estiver conectada, repassar
  o `linkConexao` exatamente como veio, nunca pedir login/senha do Google
  na conversa.

**Bug real encontrado e corrigido nesta fase**: `gerenciar_google_calendar`
nunca tinha sido adicionado ao enum Zod `frotaIaToolNameSchema`
(`src/lib/validation/schemas.ts`) usado por `recordToolExecution` — desde
a Camada 4, toda chamada dessa ferramenta gravava uma falha de validação
ao tentar registrar em `tool_executions`, o que fazia o loop de tool use
reportar a chamada como erro pra IA (`"A ferramenta falhou..."`) mesmo
quando a ação no Google Calendar tinha funcionado. Corrigido junto com
esta fase.

## Fase E — Busca de histórico em linguagem natural (seção 10)

Nova ferramenta `consultar_historico` (13ª ferramenta), mesmo padrão de
I/O real de `gerenciar_google_calendar`: consulta `analysis_runs`
(Camada 3, sem tabela nova) por texto livre (`ilike` em pedido do
usuário/resumo/tipo) e período, sempre busca estruturada — nunca depende
só da memória textual da conversa. Migration
`add_history_search_tool_to_enum` adiciona o valor ao enum
`frota_ia_tool_name` do Postgres (mesmo procedimento já usado para
`gerenciar_google_calendar` na Camada 4).

Resolução de datas relativas ("semana passada", "dia 20") e desambiguação
quando há mais de um resultado ficam a cargo da IA (mesmo princípio já
estabelecido: a ferramenta nunca interpreta linguagem natural) — regra
adicionada ao system prompt.

`tsc`, `lint` e `build` limpos após B e E.

## Fase C — Alertas agendados (seções 8-9)

Nova migration `create_scheduled_alerts`: tabela `scheduled_alerts`
(título, categoria livre, `scheduled_for` absoluto, status
pending/sent/cancelled/failed) — independente de `calendar_action_logs`
(que só registra ações já feitas na Agenda) e independente de um evento
no Google Calendar (o usuário pode ter os dois, criados separadamente,
sem nenhum vínculo automático entre eles nesta fase).

Nova ferramenta `gerenciar_alerta` (14ª ferramenta) — CRIAR/LISTAR/CANCELAR,
mesmo princípio de nunca interpretar "daqui a 15 dias" (a IA resolve pra
ISO absoluto antes de chamar, mesma regra de `gerenciar_google_calendar`).
Deixa explícito ao usuário que o alerta é baseado no horário planejado,
não em rastreamento — não há telemetria neste projeto.

**Disparo real**: `src/app/api/alerts/dispatch/route.ts` — rota protegida
por token (`ALERTS_DISPATCH_SECRET`, mesmo padrão do webhook do
WhatsApp), busca alertas `pending` com `scheduled_for` vencido, resolve o
número de WhatsApp do usuário (`user_channels`) e envia via
`sendWhatsappText`. Não interpreta nada — só dispara o que já está
resolvido no banco.

### Configuração necessária no Railway (você escolheu: cron dentro do próprio Railway)

1. No mesmo projeto Railway do serviço "frota-ia-assistente", clique em
   **"+ New"** → **"Cron Job"** (ou "Empty Service" com schedule, dependendo
   da versão da UI do Railway).
2. **Comando**:
   ```
   curl -fsS "https://<seu-domínio-railway>/api/alerts/dispatch?token=$ALERTS_DISPATCH_SECRET"
   ```
3. **Schedule** (cron padrão): `*/5 * * * *` (a cada 5 minutos — ajuste
   conforme a granularidade que fizer sentido).
4. Nas **Variables** desse serviço cron, adicione `ALERTS_DISPATCH_SECRET`
   com o **mesmo valor** configurado no serviço principal (`frota-ia-assistente`).
5. No serviço principal, gere e configure `ALERTS_DISPATCH_SECRET`
   (`openssl rand -base64 32`) se ainda não existir.

### Limitações conhecidas desta fase

- Só considera o primeiro canal de WhatsApp verificado do usuário — sem
  suporte a múltiplos números por conta.
- Sem retry automático: um alerta que falha ao enviar (ex.: Z-API fora do
  ar no momento exato) fica marcado `failed` e não é reenviado sozinho.
- Não testado com cron real neste ambiente (sem serviço de cron
  provisionado) — a rota foi validada por leitura de código e
  `tsc`/`lint`/`build`, não por execução ponta a ponta.

## Correção de base: `analysis_runs` nunca era gravada

Auditando a Fase E, descobri que `startAnalysisRun`/`completeAnalysisRun`
(Camada 3) existiam desde sempre mas nunca eram chamados pelo loop de tool
use — `analysis_runs` ficava sempre vazia. `consultar_historico` (Fase E)
nunca encontraria nada de verdade sem isso. Corrigido em
`src/ai/chat/gerarRespostaAssistente.ts`: as 11 ferramentas de cálculo
(não as de integração) agora geram um registro por chamada, com o
resultado completo e vinculado ao `tool_executions` correspondente. O
`analysisRunId` também passou a vir de volta no próprio resultado da
ferramenta para a IA poder referenciar numa chamada seguinte de
`gerar_documento`.

## Fase D — Geração e envio de documentos PDF (seção 11)

Nova dependência: `pdf-lib` (zero dependências nativas, testado e
gerando PDF válido — `%PDF-` no cabeçalho — neste ambiente). Nova tabela
`generated_documents` — só metadados (título, tipo, nome do arquivo,
se foi entregue), **nunca o arquivo em si**: o PDF é gerado na hora e
enviado direto em base64 pela Z-API (`sendWhatsappPdf`,
`send-document/pdf`), sem precisar de bucket do Supabase Storage — decisão
deliberada para não introduzir mais uma peça de infraestrutura nova nesta
fase.

- `src/services/documents/pdfGenerator.ts` — layout simples (título, data
  de geração, cliente, empresa, período, pedido, resumo, linhas
  chave/valor, observações, rodapé com identificação do Frota IA).
- Nova ferramenta `gerar_documento` (15ª ferramenta): recebe
  `analysisRunId` (preferencial — puxa uma análise já feita) ou
  `titulo`+`conteudo` livre. Nunca inventa dado ausente — se faltar os
  dois, pede antes de gerar.

### Limitações conhecidas desta fase

- Só entrega por WhatsApp — se o usuário não tiver um canal de WhatsApp
  verificado vinculado (caso raro na V1, já que o WhatsApp é o ponto de
  entrada), a ferramenta explica que não conseguiu entregar em vez de
  tentar outro canal.
- Sem gráficos/tabelas — texto corrido, formatação simples.
- Testado isoladamente (geração de PDF válido, confirmado o cabeçalho
  `%PDF-`) — não testado o envio real via Z-API nem ponta a ponta pelo
  WhatsApp, pelas mesmas razões das fases anteriores (sem instância Z-API
  conectada neste ambiente).

## Fases seguintes (F, G)

Ainda não implementadas nesta sessão: recebimento de áudio/imagem/
documento (F), suíte de testes dos 9 cenários do prompt + entrega final
consolidada (G).
