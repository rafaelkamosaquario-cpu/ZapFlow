# Camada 4 — Integrações Externas — Módulo Google Calendar

Documentação técnica do primeiro módulo da Camada 4: conectar, consultar,
criar, alterar e excluir compromissos na Agenda Google do cliente.

## 1. Por que um OAuth separado do login

O login com Google (Camada 3, `src/services/supabase/authService.ts`) usa o
Supabase Auth — ele autentica **quem** é o usuário, mas não garante um
refresh token de longa duração utilizável pelo backend para chamar a API do
Calendar depois, em qualquer momento (ex.: quando uma mensagem chega pelo
WhatsApp, sem nenhuma sessão de navegador aberta). Por isso este módulo
implementa um fluxo OAuth **complementar**, direto com o Google
(`src/lib/google/calendarClient.ts`), com `access_type=offline` e
`prompt=consent` para garantir a emissão de um refresh token.

Os dois fluxos podem usar o **mesmo** Client ID/Secret do Google Cloud —
só é preciso cadastrar as duas redirect URIs no mesmo OAuth Client (ver
seção 6).

## 2. Escopos

Mínimos necessários, sem acesso amplo à conta Google:

- `https://www.googleapis.com/auth/calendar.readonly` — listar calendários e ler eventos.
- `https://www.googleapis.com/auth/calendar.events` — criar, alterar e excluir eventos.

Não é usado o escopo `calendar` (amplo, permite até apagar calendários
inteiros) nem qualquer escopo fora de Calendar (Gmail, Drive, etc.).

## 3. Armazenamento seguro do token

Só o **refresh token** é persistido — o access token nunca é salvo em
lugar nenhum (é obtido na hora, a partir do refresh token, antes de cada
chamada à API do Calendar).

O refresh token é guardado no **Supabase Vault** (extensão `supabase_vault`,
já habilitada no projeto `frotaia` desde antes desta etapa — não é
criptografia caseira). O acesso a ele é só através de 3 funções
`SECURITY DEFINER` criadas na migration `create_google_calendar_vault`:

- `store_google_refresh_token(google_integration_id, refresh_token)`
- `read_google_refresh_token(google_integration_id)`
- `delete_google_refresh_token(google_integration_id)`

Todas com `EXECUTE` revogado de `anon`/`authenticated` e liberado só para
`service_role` — inalcançáveis a partir do navegador ou de uma sessão de
usuário comum, só do backend (`src/lib/supabase/admin.ts`).

`google_integrations` ganhou uma coluna nova:
`refresh_token_secret_id uuid references vault.secrets(id)` — só a
referência, nunca o segredo em si.

## 4. `state` do OAuth e link seguro do WhatsApp

`src/lib/google/signedToken.ts` implementa tokens HMAC-SHA256 assinados
com `GOOGLE_CALENDAR_ENCRYPTION_KEY`, sem nenhum estado guardado no
servidor (nem cookie, nem tabela):

- **`state`** do OAuth: assinado, contém `{userId, companyId, exp}`,
  validade de 10 minutos — protege contra CSRF (um `state` forjado ou
  reaproveitado é rejeitado por assinatura ou expiração).
- **Link seguro de conexão** (`buildSecureConnectLink`, em
  `src/services/google/googleCalendarConnectLink.ts`): mesma mecânica,
  validade de 15 minutos, para o caso do WhatsApp — identifica o usuário
  sem exigir uma sessão de navegador ativa. Nunca carrega nenhum segredo,
  só a identificação do usuário.

## 5. Fluxo de conexão

```
GET /auth/calendar/connect[?link=<token assinado>]
  → identifica o usuário (via link assinado OU sessão Supabase Auth)
  → monta state assinado
  → redireciona para accounts.google.com/o/oauth2/v2/auth

GET /auth/calendar/callback?code=...&state=...
  → verifica state (assinatura + expiração)
  → troca code por tokens (googleCalendarService.connectGoogleCalendar)
  → salva refresh token no Vault
  → grava/atualiza google_integrations (email, escopos, status=connected)
  → redireciona para "/?calendar_conectado=1"
```

Se o usuário negar o consentimento, ou o `state`/link estiver
inválido/expirado, ou a troca de código falhar: redireciona com
`?calendar_erro=<motivo>` — nenhum detalhe técnico é exposto na URL.

## 6. Configuração manual no Google Cloud (pendente — não pode ser feita pelo código)

1. Criar ou selecionar um projeto no Google Cloud Console.
2. Configurar a OAuth consent screen (nome do app, e-mail de suporte,
   domínio).
3. Ativar a **Google Calendar API** no projeto.
4. Criar um OAuth Client (tipo "Web application") — pode reutilizar o
   mesmo já usado para o login (Camada 3), se existir.
5. Adicionar **as duas** redirect URIs autorizadas:
   - `https://kqquswdrtcqicyfcvvuv.supabase.co/auth/v1/callback` (login, Camada 3)
   - `<APP_URL>/auth/calendar/callback` (este módulo — ex.:
     `http://localhost:3000/auth/calendar/callback` em dev,
     `https://<domínio-de-produção>/auth/calendar/callback` em produção)
6. Copiar Client ID e Client Secret para `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`.
7. Gerar um valor aleatório para `GOOGLE_CALENDAR_ENCRYPTION_KEY` (ex.:
   `openssl rand -base64 32`).
8. Definir `APP_URL` com a URL pública real da aplicação.

## 7. Variáveis de ambiente

Ver `.env.example`. Nenhum valor real foi inserido em nenhum arquivo
versionado.

| Variável | Uso |
|---|---|
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | OAuth do Calendar (pode ser o mesmo Client do login) |
| `GOOGLE_CALENDAR_REDIRECT_URI` | Redirect URI deste módulo (`/auth/calendar/callback`) |
| `GOOGLE_CALENDAR_ENCRYPTION_KEY` | Assina o `state`/link seguro (HMAC) — **não** criptografa o refresh token (isso é o Vault) |
| `APP_URL` | Base para montar o link seguro de conexão enviado pelo WhatsApp |

## 8. Serviço centralizado

`src/services/google/googleCalendarService.ts` — único lugar que orquestra
a integração; nenhum outro arquivo chama `src/lib/google/calendarClient.ts`
diretamente. Funções: `connectGoogleCalendar`, `disconnectGoogleCalendar`,
`refreshGoogleAccessToken`, `listCalendars`, `getDefaultCalendar`,
`setDefaultCalendar`, `listUpcomingEvents`, `getEvent`, `createEvent`,
`updateEvent`, `deleteEvent`, `checkCalendarConnection`.

Toda criação/alteração/exclusão de evento é registrada em
`calendar_action_logs` (Camada 3, reaproveitada sem alteração de schema).

## 9. Ferramenta interna: `gerenciar_google_calendar`

`src/ai/tools/gerenciar-google-calendar.ts`, registrada em
`src/ai/tools/index.ts` junto das outras 11.

Diferença arquitetural importante: as 11 ferramentas de cálculo são puras
e síncronas. Esta faz I/O de verdade (Google + Supabase), então é a
primeira ferramenta assíncrona do projeto — o contrato compartilhado
(`DefinicaoFerramenta.executar`, em `src/ai/tools/types.ts`) foi ajustado
para aceitar `TSaida | Promise<TSaida>`, mudança compatível que não altera
o comportamento de nenhuma das 11 ferramentas existentes (confirmado por
teste de regressão — ver seção 12).

A ferramenta **não interpreta linguagem natural**: datas devem chegar já
resolvidas em ISO 8601 com offset (`2026-08-03T08:00:00-03:00`), nunca
como "amanhã" ou "sexta-feira" — isso é responsabilidade de quem monta a
entrada (a camada de IA, Fase 2 do chat, ainda não implementada). Da mesma
forma, ALTERAR/EXCLUIR exigem o `externalEventId` já identificado
(tipicamente por uma chamada anterior no modo `CONSULTAR`) — a ferramenta
nunca decide sozinha "qual" evento entre vários.

Modos: `VERIFICAR_CONEXAO`, `LISTAR_CALENDARIOS`, `DEFINIR_CALENDARIO_PADRAO`,
`CONSULTAR`, `CRIAR`, `ALTERAR`, `EXCLUIR`.

## 10. Roteador de ferramentas — achado importante

O prompt desta etapa pede para "integrar ao roteador já existente". **Esse
roteador não existe no código ainda.** `src/services/aiService.ts`
continua sendo o stub da Fase 1/2 do chat (`requestAICompletion` lança
"ainda não implementado"). Não há nenhum mecanismo de intent
detection/dispatch de linguagem natural para as ferramentas no
repositório — nem para as 11 de cálculo, nem para esta nova.

O que foi feito, dentro do que é real hoje: a ferramenta foi registrada em
`FERRAMENTAS_FROTA_IA` (`src/ai/tools/index.ts`), exatamente como as
outras 11, pronta para ser descoberta por esse mecanismo quando ele for
construído (Fase 2 do chat). Não fabriquei um roteador para "cumprir" este
item — reportar essa lacuna com precisão é mais útil do que simular uma
integração que não existiria de verdade.

## 11. Fluxo pelo WhatsApp — o que existe e o que não existe

Preparado (código pronto, sem tocar o Z-API do ZapFlow):

- `buildSecureConnectLink(userId, companyId)` gera o link seguro de conexão
  que uma mensagem de WhatsApp poderia enviar quando a Agenda não está
  conectada.
- A ferramenta `gerenciar_google_calendar` já devolve, no modo
  `VERIFICAR_CONEXAO`, exatamente a informação (`conectado: false`) que um
  fluxo de mensagens usaria para decidir mandar esse link.

**Não implementado** (fora do escopo real deste repositório): não existe
integração de fato com a Z-API/`server.js` do ZapFlow — são projetos
Supabase e codebases diferentes, por decisão já confirmada nas etapas
anteriores. O fluxo descrito na seção 12 do prompt (receber mensagem →
identificar intenção → executar ferramenta → responder) depende do
processamento de IA da Fase 2 do chat, que também não existe ainda.

## 12. Testes executados

- `npx tsc --noEmit -p .` — limpo.
- `npm run lint` — limpo.
- `npm run build` — build de produção completo, sem erros, rotas
  `/auth/calendar/connect` e `/auth/calendar/callback` presentes no
  output.
- Suíte manual (16 verificações, compilada para CommonJS e executada com
  `node --conditions=react-server` para resolver corretamente os módulos
  marcados `server-only`):
  - `signedToken`: roundtrip, rejeição de assinatura adulterada, rejeição
    de payload trocado com assinatura antiga, rejeição de token expirado.
  - `gerenciar_google_calendar`: validação de `userId` ausente; `CRIAR`
    sem título/início/fim/timezone/empresa; `CRIAR` com data relativa
    (sem offset) rejeitada; `ALTERAR`/`EXCLUIR` sem `externalEventId`;
    `EXCLUIR` sem `confirmation`; `DEFINIR_CALENDARIO_PADRAO` sem id.
  - Regressão: `calcular_combustivel` (ferramenta pura) continua
    funcionando após a mudança do tipo `DefinicaoFerramenta.executar`.
  - **Resultado: 16 de 16 passaram.**

**Não testado** (exige credenciais reais do Google, que não existem neste
ambiente): troca de code por token, refresh de access token, chamadas
reais à API do Calendar (listar/criar/alterar/excluir evento de verdade),
fluxo OAuth ponta a ponta, revogação real.

## 13. Segurança verificada

`get_advisors` (security) rodado antes e depois da migration: nenhum
alerta novo introduzido. As 3 funções do Vault não aparecem nem como
`anon`/`authenticated` executável (grants corretos), nem geram nenhum
outro alerta — o `service_role` não é avaliado por essa regra do linter
por já ser um papel privilegiado por definição.

## 14. Erros comuns (para quando as credenciais existirem)

- **"O Google não devolveu um refresh token"**: acontece quando o usuário
  já tinha concedido consentimento antes e não passou por
  `prompt=consent` de novo com o `access_type=offline` — como o código já
  sempre envia os dois, isso só ocorreria se o Google decidir não reemitir
  (raro); a mitigação é desconectar e conectar de novo.
- **`GoogleCalendarNotConnectedError`**: usuário sem integração salva ou
  com `connection_status` diferente de `connected` — a ferramenta devolve
  isso como `sucesso: false` com uma mensagem seguem, nunca lança para o
  chamador.
- **`EVENT_NOT_FOUND`**: evento já excluído/alterado por fora — tratado
  como falha segura, não como exceção não capturada.

## 15. Revogação

`disconnectGoogleCalendar(userId)` chama a revogação no Google
(`revokeGoogleToken`, melhor esforço — segue em frente mesmo se o Google
já considerar o token inválido) e depois `delete_google_refresh_token`,
que apaga o segredo do Vault e marca `connection_status = 'revoked'`.
Idempotente: chamar de novo sem integração ativa não falha.

## 16. Limitações conhecidas

- Sem UI para o usuário clicar em "Conectar Google Calendar" — só a rota
  (`/auth/calendar/connect`) existe; falta um botão na tela de chat.
- Sem roteador de intenção real (ver seção 10) — a ferramenta está pronta,
  mas nada ainda a aciona a partir de uma mensagem de usuário.
- Sem integração real com WhatsApp/Z-API (ver seção 11).
- `vehicleId` aceito na entrada da ferramenta mas ainda não persistido em
  `calendar_action_logs` (a tabela da Camada 3 não tem essa coluna — não
  criei migration para isso porque não há um caso de uso concreto ainda
  além de "reservar o campo"; adicionar quando o vínculo evento↔veículo
  for realmente consumido em algum lugar).
- Ambiguidade de eventos ("cancele a revisão" quando há mais de uma) não é
  resolvida por nenhum código hoje — depende inteiramente da futura camada
  de IA consultar (`CONSULTAR`) antes de agir.

## 17. Próximo módulo da Camada 4

A definir com você — não implementado nesta etapa (fora do escopo,
seção 19 do prompt): Google Maps/rotas, pedágios, clima, ANTT, ANP,
legislação.
