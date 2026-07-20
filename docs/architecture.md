# Arquitetura

O projeto e um monolito Next.js com API HTTP compartilhada entre o ambiente serverless da Vercel e uma API Node local.

## Camadas

`app/` contem o frontend em Next.js App Router. As paginas consomem rotas sob `/api` e usam Firebase Authentication no cliente.

`app/api/[...path]/route.js` adapta requests do runtime Next para o formato esperado pelo router Node em `src/routes.js`. Esse arquivo deve permanecer fino: conversao de request/response e delegacao.

`src/routes.js` concentra as rotas HTTP, validacoes de entrada, autenticacao, autorizacao e chamadas ao store. E o principal ponto de entrada para testes de API.

`src/store.js` define duas implementacoes de persistencia:

- `JsonFileStore`, usada em desenvolvimento local e testes.
- `FirestoreStore`, usada em producao quando `DATA_STORE=firestore`.

`src/scoring.js`, `src/match-reference.js` e `src/validation.js` concentram regras reutilizaveis e devem continuar sem dependencia de runtime web.

`src/live-score.js`, `src/livescore.js`, `src/api-football.js` e `src/competition-sync.js` cuidam de sincronizacao de placares e providers externos. Testes dessas areas devem usar fakes/mocks e evitar chamadas reais de rede.

`src/seed.js` importa uma competicao a partir de JSON. `templates/` contem somente exemplos;
dados reais de competicoes, usuarios e palpites nao devem ser versionados.

## Direcao das dependencias

- Paginas e adaptadores HTTP podem depender de regras e persistencia em `src/`.
- Regras puras nao devem depender de Next.js, Firebase ou APIs externas.
- Providers externos devem retornar dados normalizados antes de alterar o store.
- O adaptador `app/api/[...path]/route.js` deve continuar sem regras de negocio.

## Fluxo de request

```text
Browser
  -> Next app em app/
  -> /api/*
  -> app/api/[...path]/route.js
  -> src/routes.js
  -> src/store.js
  -> JSON local ou Firestore
```

## Autenticacao

O frontend usa Firebase Auth. Rotas protegidas recebem:

```http
Authorization: Bearer <firebase_id_token>
```

Em `DATA_STORE=firestore`, a API valida o token com Firebase Admin. Rotas legadas de auth continuam existindo para testes e modo JSON local.

## Dados

Os dados de cada edicao ficam fora do codigo e seguem o formato de
`templates/competition.example.json`. O script generico `src/seed.js` importa esse arquivo.
Evite misturar alteracoes de dados de uma competicao com mudancas de regra ou UI.

## Pontos de extensao

- Nova competicao: crie um JSON baseado no template e use `src/seed.js`.
- Novo provider: implemente o contrato normalizado de `src/live-score.js`.
- Nova regra de negocio: prefira um modulo puro em `src/` e um teste direto em `test/`.
- Nova rota: implemente no router compartilhado e cubra via `createRouter`.

## Principio para mudancas

Mantenha o adaptador Next fino, regras puras em modulos pequenos e testes no nivel mais baixo que cobre o comportamento. Quando uma mudanca afetar contrato HTTP, adicione teste via router.
