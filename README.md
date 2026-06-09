# Bolao26

Monolito Next.js para bolao da Copa do Mundo FIFA 2026, pronto para deploy na Vercel Hobby.

O projeto inclui:

- Frontend em Next.js App Router.
- API serverless em `app/api/[...path]`.
- Firebase Authentication no app cliente.
- Firestore como banco de dados de producao.
- JSON local como fallback para desenvolvimento e testes.
- Seed com 48 selecoes, 12 grupos e 72 jogos da fase de grupos.
- Integracao opcional com football-data.org para live score.

## Requisitos

- Node.js 20+
- Projeto Firebase com Authentication e Firestore habilitados

## Desenvolvimento Local

```bash
npm install
npm run seed
npm run dev
```

O app sobe em `http://localhost:3000`.

Por padrao, `DATA_STORE=json` usa `data/db.json`. Para usar Firestore localmente, configure as variaveis Firebase antes de rodar `npm run seed`.

## Scripts

- `npm run dev`: sobe o monolito Next.js.
- `npm run build`: build de producao usado pela Vercel.
- `npm start`: executa o build Next.js.
- `npm run seed`: cria selecoes e jogos no store configurado.
- `npm test`: roda testes da regra de negocio/API.
- `npm run api:start`: executa apenas a API Node legada para debug.

## Variaveis de Ambiente

### App Cliente Firebase

Essas variaveis precisam estar configuradas na Vercel e no `.env.local`:

- `NEXT_PUBLIC_FIREBASE_API_KEY`
- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
- `NEXT_PUBLIC_FIREBASE_APP_ID`

### Backend Firebase Admin

Para Vercel, prefira variaveis separadas:

- `DATA_STORE=firestore`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`
- `FIREBASE_ROOT_PATH=bolao26`

`FIREBASE_PRIVATE_KEY` deve manter as quebras como `\n`; a aplicacao converte automaticamente.

Tambem e aceito:

- `FIREBASE_SERVICE_ACCOUNT_JSON`

Para desenvolvimento local, `GOOGLE_APPLICATION_CREDENTIALS=/caminho/service-account.json` tambem funciona.

### Live Score

- `LIVE_SCORE_PROVIDER=api-football|football-data`: padrão `api-football`.
- `FOOTBALL_DATA_API_TOKEN`
- `FOOTBALL_DATA_BASE_URL=https://api.football-data.org/v4`
- `LIVE_SCORE_COMPETITION_CODE=WC`
- `LIVE_SCORE_SEASON=2026`

Para trocar a API de live score, altere `LIVE_SCORE_PROVIDER`. A aplicação usa um
contrato interno comum de fixtures normalizados, então rotas, scoring e cron não precisam
conhecer detalhes do provedor. O contador diário em Firestore registra apenas chamadas da
API-Football.

### Sincronizacao automatica

O projeto usa GitHub Actions para chamar `POST /api/sync` a cada 10 minutos no repositório público.

API-Football:

- `API_FOOTBALL_KEY`: chave da API-Football.
- `API_FOOTBALL_LEAGUE_ID=1`: FIFA World Cup.
- `API_FOOTBALL_SEASON=2026`.
- `API_FOOTBALL_PLAN=free|paid`: padrão `free`.

No plano Free, a API-Football bloqueia chamadas por temporada para a Copa 2026, como
`/fixtures?league=1&season=2026` e `/standings?league=1&season=2026`, mas permite buscar
fixtures por data, como `/fixtures?date=2026-06-09`. Nesse modo, rode `POST /api/sync/seed`
uma vez para popular o calendário completo/local e deixe o cron em `POST /api/sync`; ele não
gastará chamadas tentando endpoints por temporada bloqueados e continuará atualizando os jogos
do dia por data.

Com plano pago, configure `API_FOOTBALL_PLAN=paid` para liberar o sync completo de fixtures,
standings, daily e live.

Secrets necessários no repositório GitHub:

- `SYNC_URL`: URL pública do deploy, por exemplo `https://bolao-2026.vercel.app`
- `API_FOOTBALL_SYNC_SECRET`: mesmo valor usado no backend para autorizar o sync

O workflow também pode ser disparado manualmente com `workflow_dispatch`.

### Outros

- `DATA_STORE=json|firestore`
- `DATA_FILE=data/db.json`
- `PORT=3000`
- `JWT_SECRET`: usado apenas pelo fluxo legado em modo JSON

## Firestore

A API grava dados em subcolecoes dentro do documento raiz:

```text
bolao26/default/users/{userId}
bolao26/default/teams/{teamId}
bolao26/default/matches/{matchId}
bolao26/default/pools/{poolId}
bolao26/default/memberships/{poolId_userId}
bolao26/default/predictions/{predictionId}
```

A API continua trabalhando internamente com listas, mas persiste no Firestore como documentos chaveados por ID. Apps cliente devem escrever pela API HTTP, nao diretamente no Firestore, para preservar validacoes e permissoes.

## Autenticacao

No frontend, o usuario autentica com Firebase Auth. O app envia o ID token em rotas protegidas:

```http
Authorization: Bearer <firebase_id_token>
```

No modo `DATA_STORE=firestore`, a API valida o token com Firebase Admin. O primeiro usuario autenticado criado na colecao `users` vira `admin`; os proximos viram `player`.

## Principais Rotas

Todas ficam sob `/api` no monolito:

- `GET /api/health`
- `GET /api/me`
- `GET /api/groups`
- `GET /api/groups/:group`
- `GET /api/teams`
- `GET /api/matches`
- `GET /api/live-score/provider`
- `POST /api/live-score/sync` admin
- `POST /api/teams` admin
- `POST /api/matches` admin
- `PATCH /api/matches/:id` admin
- `POST /api/pools`
- `GET /api/pools/active`
- `GET /api/pools`
- `GET /api/pools/:id`
- `POST /api/pools/:id/join`
- `POST /api/pools/:id/predictions`
- `GET /api/pools/:id/predictions`
- `GET /api/pools/:id/leaderboard`

As rotas `/api/auth/register` e `/api/auth/login` permanecem apenas para testes/JSON local. O app cliente usa Firebase Auth.

## MVP: Bolao Unico

O MVP trabalha com um unico bolao ativo. Ao autenticar, o app chama `GET /api/pools/active`; a API cria o bolao `Bolao Copa 2026` se ele ainda nao existir e inclui automaticamente o usuario autenticado como participante.

## Pontuacao

- 25 pontos: placar exato.
- 10 pontos: acerto do vencedor ou empate.
- 5 pontos: acerto da diferenca de gols sem placar exato.
- 2 pontos: acerto dos gols de um time.

Palpites fecham em `lockAt`, normalmente igual a `startsAt`.

## Deploy na Vercel Hobby

1. Criar projeto na Vercel apontando para este repositorio.
2. Configurar as variaveis `NEXT_PUBLIC_FIREBASE_*`.
3. Configurar `DATA_STORE=firestore`.
4. Configurar credenciais Admin do Firebase.
5. Rodar `npm run seed` uma vez com as mesmas variaveis, localmente ou em ambiente seguro.
6. Deploy com build command `npm run build`.
7. Configurar os secrets `SYNC_URL` e `API_FOOTBALL_SYNC_SECRET` no GitHub para habilitar o sync automatico.

## Dados Oficiais

O seed carrega os grupos e os 72 jogos da fase de grupos da Copa do Mundo FIFA 2026, com horarios em UTC. Os campos extras `matchNumber`, `venue` e `city` aparecem em `GET /api/matches`.
