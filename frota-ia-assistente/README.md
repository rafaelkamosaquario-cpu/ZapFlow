# Frota IA Assistente

Especialista virtual em transporte e gestão de frotas. Este é o app de chat que,
na próxima fase, será conectado a uma IA real. **Nesta fase (Fase 1)** só existe
a estrutura, o visual e a experiência de conversa — todas as respostas são
simuladas.

Projeto construído do zero (não reaproveita código do ZapFlow que vive na raiz
deste repositório).

## Stack

- [Next.js 16](https://nextjs.org) (App Router, Turbopack)
- [TypeScript](https://www.typescriptlang.org)
- [Tailwind CSS 4](https://tailwindcss.com)
- [lucide-react](https://lucide.dev) (ícones)
- [next-themes](https://github.com/pacocoursey/next-themes) (modo claro/escuro)

Nenhuma API de IA, banco de dados ou autenticação foi conectada nesta fase.

## Como rodar localmente

```bash
cd frota-ia-assistente
npm install
npm run dev
```

Abra [http://localhost:3000](http://localhost:3000).

Outros scripts:

```bash
npm run build   # build de produção
npm run start   # roda o build de produção
npm run lint    # eslint
```

## Estrutura de pastas

```
frota-ia-assistente/
├── src/
│   ├── app/                    # rotas (App Router)
│   │   ├── layout.tsx          # fontes, metadata, providers (tema/toast)
│   │   ├── page.tsx            # tela única do assistente
│   │   ├── icon.tsx            # favicon gerado (logo)
│   │   └── globals.css         # tokens de design (cores, animações)
│   ├── components/
│   │   ├── ui/                 # Button, Input, Textarea, Card, Loading,
│   │   │                       # EmptyState, Toast, Modal, Dialog
│   │   ├── layout/              # Header, Sidebar (desktop), MobileSidebar
│   │   │                        # (menu retrátil), SidebarContent, ThemeToggle
│   │   ├── chat/                # ChatWindow, MessageList, MessageBubble,
│   │   │                        # ChatInput, SuggestionCards, TypingIndicator,
│   │   │                        # WelcomeScreen
│   │   ├── icons/                # Logo (marca Frota IA)
│   │   └── providers/            # ThemeProvider, ToastProvider
│   ├── hooks/                   # useChat, useConversations, useLocalStorage,
│   │                             # useMediaQuery, useToast, useHasMounted
│   ├── services/                 # aiService, chatService, messageService
│   │                             # (interfaces vazias, prontas para a Fase 2)
│   ├── types/                    # ChatMessage, Conversation, SuggestionPrompt
│   └── lib/                      # utils (cn, formatRelativeDate…), constants
│                                  # (sugestões, textos), mock-data (histórico
│                                  # simulado)
└── public/                       # assets estáticos
```

## Telas e componentes

A aplicação abre direto no assistente — uma única tela, sem login ou painel.

- **Header**: logo + nome, botão "Nova conversa", alternância de tema, botão
  de menu (mobile).
- **Tela de boas-vindas**: aparece antes da primeira mensagem, com 6 cartões
  de sugestão ("Analisar um frete", "Calcular consumo", "Calcular CPK",
  "Comparar pneus", "Reduzir custos", "Custos da frota"). Clicar num cartão
  apenas preenche o campo de texto — nenhuma ação é executada.
- **Conversa**: mensagens do usuário e do assistente, indicador de "digitando"
  animado e resposta fixa: *"Em breve este assistente será conectado à
  inteligência artificial."*
- **Campo de mensagem**: textarea que cresce automaticamente, envia com
  Enter (Shift+Enter para nova linha).
- **Sidebar (desktop) / menu retrátil (mobile)**: histórico de conversas
  simulado (persistido em `localStorage`), com opções de selecionar, criar
  nova conversa e excluir (com diálogo de confirmação).
- **Modo claro/escuro**: alternância manual no header, com preferência do
  sistema como padrão.

## Arquitetura proposta

- **Estado local, sem backend.** `useConversations` guarda o histórico em
  `localStorage`; `useChat` cuida do envio de mensagens e simula a resposta
  do assistente com um `setTimeout`.
- **Camada de serviços já desenhada para a Fase 2**, mas sem implementação:
  - `aiService.requestAICompletion` — vai chamar a Claude API.
  - `chatService` — vai persistir conversas (API + banco).
  - `messageService` — fábrica de mensagens (já usada nesta fase, localmente).
  Essas funções hoje só lançam um erro "ainda não implementado (Fase 2)".
  A ideia é que `useChat` troque o `setTimeout` por uma chamada real a
  `aiService` sem precisar mexer em nenhum componente visual.
- **Design tokens em `globals.css`** (`--primary`, `--surface`, `--border`,
  etc.) com variante `.dark` — qualquer componente novo herda o tema
  automaticamente.
- **Componentes de UI genéricos** (`src/components/ui`) não conhecem nada de
  "frota" ou "chat" — podem ser reaproveitados em telas futuras.

## Próximos passos (Fase 2)

1. Implementar `aiService.requestAICompletion` com a Claude API.
2. Trocar o `setTimeout` de `useChat` pela chamada real ao serviço.
3. Persistir conversas de verdade em `chatService` (API + banco), substituindo
   o `localStorage`.
4. Streaming de resposta (mensagem do assistente aparecendo token a token).
5. Fora de escopo por enquanto: RAG, memória, ferramentas de cálculo,
   cadastro de veículos/empresas/pneus, financeiro, painel administrativo —
   tudo isso vem depois da Fase 2.

Aguardando autorização para iniciar a Fase 2.
