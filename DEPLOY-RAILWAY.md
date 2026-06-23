# 🚂 Como publicar no Railway (e usar no celular)

Este guia coloca o Frota-bot online em um link público (ex.:
`https://frota-bot.up.railway.app`) que você acessa do **navegador do celular**.

## Antes de começar

- Uma conta no [GitHub](https://github.com) com este projeto enviado (já está!)
- Uma conta no [Railway](https://railway.app) (login com o GitHub é o mais fácil)
- Os dados da sua instância da **Z-API** (ID, Token e Client-Token)

---

## Passo a passo

### 1. Criar o projeto no Railway
1. Acesse [railway.app](https://railway.app) e faça login.
2. Clique em **New Project** → **Deploy from GitHub repo**.
3. Autorize o Railway a acessar seu GitHub e escolha o repositório **Frota-bot**.
4. O Railway detecta que é um app Node.js e começa a build automaticamente.

### 2. Configurar as variáveis de ambiente
No projeto, abra a aba **Variables** e adicione:

| Variável | Valor |
|----------|-------|
| `ZAPI_INSTANCE_ID` | ID da sua instância |
| `ZAPI_INSTANCE_TOKEN` | Token da sua instância |
| `ZAPI_CLIENT_TOKEN` | Client-Token (aba Segurança da Z-API) |
| `DATA_DIR` | `/data` |

> Preencher essas variáveis é opcional (dá pra digitar na tela também), mas
> deixa o app pronto pra usar sem precisar colar as credenciais toda vez.

### 3. Gerar o link público
1. Vá na aba **Settings** → seção **Networking**.
2. Clique em **Generate Domain**.
3. O Railway cria um endereço tipo `https://frota-bot-production.up.railway.app`.
4. **Esse é o link que você abre no celular!** 📱

### 4. (Recomendado) Volume para não perder os agendamentos
Os agendamentos são salvos em arquivo. Sem um volume, eles **somem a cada novo
deploy**. Para mantê-los:

1. No projeto, clique em **+ New** → **Volume** (ou em Settings → Volumes).
2. Defina o **Mount Path** como `/data`.
3. Confirme que a variável `DATA_DIR` está como `/data` (passo 2).

Pronto — agora os disparos agendados sobrevivem a reinícios.

---

## 📱 Usando no celular

1. Abra o link do Railway no navegador do celular (Chrome/Safari).
2. **Dica:** toque em *Compartilhar → Adicionar à Tela de Início* para criar um
   "atalho de app" na tela inicial do celular.
3. Cole as credenciais (se não usou as variáveis), teste a conexão.
4. Suba a planilha, escreva a mensagem, escolha **Enviar agora** ou **Agendar**.

> ⚠️ Para o **agendamento** funcionar, o app precisa estar no ar no horário
> marcado. No plano gratuito o Railway pode "dormir" o serviço por inatividade —
> se for usar agendamentos com frequência, considere o plano que mantém o app
> sempre ativo (Hobby).

---

## 🔁 Atualizações
Toda vez que você (ou eu) enviar mudanças para o GitHub, o Railway faz o deploy
automaticamente. Não precisa fazer nada manualmente.
