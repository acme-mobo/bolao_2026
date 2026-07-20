# AGENTS.md

Orientacoes para agentes trabalhando neste repositorio.

## Harness do repositorio

- Arquitetura: `docs/architecture.md`
- Estrategia de testes: `docs/testing.md`
- Validacao automatizada: `scripts/validate.sh`
- Prompts reutilizaveis: `prompts/bugfix.md`, `prompts/refactor.md`, `prompts/tests.md`

Leia este arquivo primeiro e abra apenas a documentacao relacionada ao trabalho atual.

## Projeto

Este projeto e um monolito Next.js reutilizavel para boloes de futebol.

- Frontend: `app/`
- API serverless: `app/api/[...path]/route.js`
- Router HTTP compartilhado: `src/routes.js`
- API Node local/legada: `src/server.js`
- Regras de negocio: `src/scoring.js`, `src/match-reference.js`, `src/validation.js`
- Persistencia: `src/store.js`
- Template de competicao: `templates/competition.example.json`
- Seed generico: `src/seed.js`
- Testes: `test/*.test.js`

## Comandos

- Instalar dependencias: `npm install`
- Rodar app local: `npm run dev`
- Rodar API Node local: `npm run api:start`
- Rodar testes: `npm test`
- Rodar testes em modo watch: `npm run test:watch`
- Rodar build: `npm run build`
- Validacao rapida: `npm run validate:quick`
- Validar antes de entregar: `npm run validate`

## Regras de trabalho

- Prefira mudancas pequenas, incrementais e alinhadas ao estilo existente.
- Antes de editar, confira `git status --short` e preserve todo trabalho local fora do escopo.
- Antes de editar, leia os arquivos diretamente relacionados ao comportamento.
- Nao altere `.env.local`, credenciais Firebase, service accounts ou arquivos ignorados.
- Nao sobrescreva mudancas locais existentes. Se houver arquivo modificado fora do escopo, preserve.
- Evite refactors amplos junto com bugfixes.
- Para regras puras, adicione ou ajuste testes em `test/`.
- Para rotas, prefira testar via `createRouter` como em `test/api.test.js`.
- Para persistencia, use stores temporarios ou fakes; nao dependa de Firestore real em testes.

## Dados e ambiente

Por padrao o projeto usa `DATA_STORE=json` e `data/db.json` para desenvolvimento local.
Em producao, usa Firestore com Firebase Admin.

Dados de uma competicao, participantes e palpites reais nao devem ser versionados. Use os
templates e arquivos locais ignorados pelo Git.

Testes devem rodar com `NODE_ENV=test` e nao devem exigir rede, Firebase real ou secrets.

## Matriz de validacao

- Documentacao ou prompt: revise links, comandos e `git diff --check`.
- Regra pura, rota, store, seed ou provider: rode `npm test` durante a iteracao.
- Frontend, configuracao do Next ou mudanca transversal: rode `npm run validate`.
- Antes de entregar qualquer mudanca de codigo: prefira `npm run validate`.

## Entrega

No resumo final:

- descreva o comportamento alterado;
- liste os comandos de validacao executados e seus resultados;
- informe qualquer validacao nao executada e o motivo;
- mencione riscos, limitacoes ou proximos passos apenas quando existirem.
