# MACHINE CHEATS Marketplace (portfólio)

Aplicação full-stack simulando um marketplace de mods digitais para jogos,
com autenticação segura, sistema VIP, painel administrativo
e chat em tempo real com controle de permissões.

Projeto desenvolvido com foco em:
- arquitetura backend
- controle de acesso por roles
- persistência relacional
- comunicação via WebSocket

## 🧠 Stack utilizada

- Node.js
- Express
- SQLite
- Socket.IO
- bcrypt
- CSRF Protection
- Vanilla JS
- HTML5 / CSS3

Este projeto foi atualizado para virar um **marketplace de MODS digitais** com:

- Login / cadastro (senha com **hash bcrypt**)
- Sessão por cookie + **CSRF token**
- Roles: **USER** e **ADMIN**
- VIP separado do Admin (**isVip**)
- Marketplace com produtos digitais (upload de arquivo + entrega automática após compra)
- Perfis públicos `/u/:nick` com bio, avatar, badges e reputação
- Avaliação de perfil **anti-fraude** (somente se já comprou do vendedor)
- Avaliação de produto **anti-fraude** (somente compradores)
- Dúvidas do produto (perguntas + respostas do vendedor)
- Painel Admin: overview, transações, usuários, produtos, taxas, chat admin, impersonação (com logs)
- Sidebar esquerda abre/fecha com atalhos
- Chat em tempo real (Socket.IO) + persistência no SQLite

> Observação: por ser portfólio, o pagamento é em **modo demo**, com wallet interna (saldo fake).

---

## Requisitos

- Node.js 18+ (recomendado)

---

## Como rodar localmente

> **Importante:** este projeto precisa do backend (Express) para Login/Compras/Chat. **Não abra os HTMLs direto** com Live Server sem rodar o `npm start`, senão a navbar/sidebar e os endpoints `/api/*` podem não funcionar.
>
> Se você estiver usando VSCode Live Preview e acabou caindo em URLs como `/public/index.html`, tudo bem: o servidor agora também aceita esse caminho e redireciona para as rotas amigáveis.

```bash
npm install
npm start
```

Acesse:

- Home: `http://localhost:3000/`
- Marketplace: `http://localhost:3000/mods`

---

## Credenciais do Admin (seed)

Ao iniciar o servidor, ele cria (se não existir) um usuário admin seed:

- **Email:** `admin@site.com`
- **Senha:** `admin123`

---

## Fluxo principal para testar

### 1) Cadastro → Login

- Acesse `/cadastro` e crie um usuário.
- Você começa com **R$ 200,00** de saldo demo.

### 2) Criar produto (vendedor)

- Vá em **Sidebar → Meus produtos** (`/meus-produtos`)
- Crie um mod com:
  - título, descrição, preço, estoque
  - imagem (opcional)
  - arquivo do mod (`.zip/.rar/.7z`) — obrigatório no cadastro

### 3) Comprar com outro usuário (demo)

- Faça logout, crie outro usuário (ou use outro)
- Abra o produto e clique **Comprar**
- A compra debita a wallet demo do comprador e credita o saldo do vendedor (líquido)

### 4) Download automático

- Vá em **Minhas compras** (`/minhas-compras`)
- Clique em **Baixar**

> O download exige autenticação e valida se o usuário realmente comprou.

### 5) Avaliações válidas

- Avaliação de produto: disponível **apenas para compradores**
- Avaliação de perfil: disponível **apenas se comprou ao menos 1 produto daquele vendedor**

---

## VIP

- Página: `/vip`
- VIP é comprado via wallet demo (modo portfólio)
- Benefício principal: **taxa menor nas vendas** + badge no perfil

---

## Painel Admin

- Página: `/admin`
- Abas:
  - Visão geral
  - Transações
  - Usuários (buscar, banir, promover, dar VIP, impersonar)
  - Produtos (ocultar/editar/excluir)
  - Taxas (fee)
  - Chat Admin
  - Impersonação + logs

### Impersonação segura (sem backdoor)

No Admin:

- Clique **Entrar como** em um usuário
- O sistema cria uma sessão temporária e registra log (`admin_impersonation_logs`)
- Aparece um banner no topo com **Voltar para Admin**

Durante impersonação:

- O admin **não consegue** acessar rotas/admin actions
- Serve apenas para suporte/demonstração

---

## Estrutura / Banco

- Backend: Express
- DB: SQLite (`/data/database.sqlite`)
- Uploads: `/storage` (fora de `public`)

Tabelas principais:

- `users`
- `products`
- `orders`
- `product_questions` / `product_answers`
- `product_reviews`
- `profile_ratings`
- `chat_messages`
- `platform_settings`
- `admin_impersonation_logs`
- `admin_audit_logs`

---

## Segurança (mínimo viável)

- Hash de senha com **bcrypt**
- Cookies de sessão `HttpOnly` + CSRF token em cookie legível + header `X-CSRF-Token`
- Rotas protegidas por role (USER/ADMIN) + VIP
- Uploads com limite de tamanho e extensão
- Downloads privados com checagem de compra
- Logs para ações administrativas e impersonação

---

## Dicas

- Para adicionar saldo demo: **Configurações do perfil → Wallet (demo)**
- Para testar chat: `/chat` (geral) e `/admin#chat` (admin)

---

## Licença

Projeto de portfólio.
