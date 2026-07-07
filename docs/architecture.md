# Arquitetura

Bolao26 e um monolito Next.js com API HTTP compartilhada entre o ambiente serverless da Vercel e uma API Node local.

## Camadas

`app/` contem o frontend em Next.js App Router. As paginas consomem rotas sob `/api` e usam Firebase Authentication no cliente.

`app/api/[...path]/route.js` adapta requests do runtime Next para o formato esperado pelo router Node em `src/routes.js`. Esse arquivo deve permanecer fino: conversao de request/response e delegacao.

`src/routes.js` concentra as rotas HTTP, validacoes de entrada, autenticacao, autorizacao e chamadas ao store. E o principal ponto de entrada para testes de API.

`src/store.js` define duas implementacoes de persistencia:

- `JsonFileStore`, usada em desenvolvimento local e testes.
- `FirestoreStore`, usada em producao quando `DATA_STORE=firestore`.

`src/scoring.js`, `src/match-reference.js` e `src/validation.js` concentram regras reutilizaveis e devem continuar sem dependencia de runtime web.

`src/live-score.js`, `src/livescore.js`, `src/api-football.js` e `src/wc-sync.js` cuidam de sincronizacao de placares e providers externos. Testes dessas areas devem usar fakes/mocks e evitar chamadas reais de rede.

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

Os dados oficiais e seeds ficam em `src/world-cup-2026-data.js` e scripts `src/seed*.js`.
Evite mudar dados oficiais junto com mudancas de regra ou UI.

## Principio para mudancas

Mantenha o adaptador Next fino, regras puras em modulos pequenos e testes no nivel mais baixo que cobre o comportamento. Quando uma mudanca afetar contrato HTTP, adicione teste via router.
