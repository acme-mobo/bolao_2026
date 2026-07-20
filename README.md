# Bolão

Monolito Next.js reutilizável para bolões de futebol, com frontend, API serverless,
autenticação Firebase, persistência JSON/Firestore, sincronização de placares e ranking.

O repositório não contém calendário, participantes ou palpites de uma edição específica.
Cada competição é carregada a partir de um arquivo externo baseado em
[`templates/competition.example.json`](templates/competition.example.json).

## Desenvolvimento

Requer Node.js 20 ou superior.

```bash
npm install
npm run dev
```

Comandos principais:

```bash
npm test
npm run build
npm run validate
npm run api:start
```

Por padrão, o desenvolvimento usa `DATA_STORE=json` e `data/db.json`. Esse arquivo é
ignorado pelo Git para não versionar dados reais.

## Preparar uma nova competição

1. Copie `templates/competition.example.json` para um arquivo fora de `templates/`.
2. Preencha `teams` e `matches` com os dados da nova edição.
3. Valide o arquivo sem alterar o store:

```bash
npm run seed -- ./competition.json --dry-run
```

4. Substitua os times e jogos do store somente após revisar o resumo:

```bash
npm run seed -- ./competition.json --replace
```

O modo `--replace` preserva usuários, bolões e participações, mas limpa palpites e tabela,
pois eles pertencem ao calendário anterior.

Times aceitam `id`, `name`, `code`, `group` e `flag`. Jogos aceitam `id`, `matchNumber`,
`homeCode`, `awayCode`, `homeSlot`, `awaySlot`, `stage`, `group`, `startsAt`, `lockAt`,
`venue`, `city`, `status`, `homeGoals` e `awayGoals`.

## Importar palpites

Use o formato de [`templates/predictions.example.md`](templates/predictions.example.md):

```bash
node src/import-pasted-predictions.js ./predictions.md --dry-run
node src/import-pasted-predictions.js ./predictions.md
```

Para escolher um bolão que não seja o ativo:

```bash
node src/import-pasted-predictions.js ./predictions.md --pool pool_id
```

O importador resolve times pelos nomes ou códigos cadastrados e faz upsert por
`poolId + userId + matchId`.

## Configuração

Principais variáveis:

- `DATA_STORE=json|firestore`
- `DATA_FILE=data/db.json`
- `FIREBASE_ROOT_PATH=bolao`
- `FIRESTORE_DATABASE_ID=(default)`
- `DEFAULT_POOL_ID=pool_main`
- `DEFAULT_POOL_NAME=Bolao Principal`
- `DEFAULT_POOL_INVITE_CODE=BOLAO`
- `NEXT_PUBLIC_APP_NAME=Bolão`
- `NEXT_PUBLIC_COMPETITION_NAME=Competição`
- `COMPETITION_ID=current`

Use [`.env.example`](.env.example) como ponto de partida e mantenha credenciais somente em
arquivos locais ignorados ou no gerenciador de secrets do ambiente.

Firebase cliente:

- `NEXT_PUBLIC_FIREBASE_API_KEY`
- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
- `NEXT_PUBLIC_FIREBASE_APP_ID`

Firebase Admin pode usar credencial padrão do ambiente, `FIREBASE_SERVICE_ACCOUNT_JSON`
ou `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL` e `FIREBASE_PRIVATE_KEY`.

## Sincronização de placares

Providers suportados por `LIVE_SCORE_PROVIDER`:

- `api-football`
- `football-data`
- `livescore`

Nenhuma liga, temporada ou URL de competição é presumida. Configure conforme a edição:

- `LIVE_SCORE_COMPETITION_CODE`
- `LIVE_SCORE_SEASON`
- `LIVESCORE_FIXTURES_URL`
- `LIVESCORE_RESULTS_URL`
- `LIVESCORE_STANDINGS_URL`
- `LIVESCORE_COMPETITION_ID`
- `API_FOOTBALL_LEAGUE_ID`
- `API_FOOTBALL_SEASON`
- `API_FOOTBALL_KEY`
- `API_FOOTBALL_PLAN`
- `API_FOOTBALL_SYNC_SECRET`

Depois do seed principal, `POST /api/sync/seed` copia os jogos normalizados do store para
o cache de sincronização da competição configurada.

## Pontuação

- 5 pontos: placar exato.
- 3 pontos: vencedor ou empate correto sem placar exato.
- 0 pontos: resultado incorreto ou jogo sem placar oficial.

O ranking desempata pelo maior número de placares exatos.

## Estrutura

- `app/`: frontend e rotas serverless.
- `src/routes.js`: router HTTP compartilhado.
- `src/scoring.js`: pontuação e ranking.
- `src/store.js`: persistência JSON/Firestore.
- `src/live-score.js`, `src/livescore.js`, `src/api-football.js`: providers.
- `src/competition-sync.js`: orquestração de sincronização.
- `src/seed.js`: importador genérico de competição.
- `templates/`: exemplos sem dados reais.
- `test/`: testes isolados, sem rede ou Firestore real.
