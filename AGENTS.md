# AGENTS.md

Orientacoes para agentes trabalhando neste repositorio.

## Projeto

Bolao26 e um monolito Next.js para bolao da Copa do Mundo de 2026.

- Frontend: `app/`
- API serverless: `app/api/[...path]/route.js`
- Router HTTP compartilhado: `src/routes.js`
- API Node local/legada: `src/server.js`
- Regras de negocio: `src/scoring.js`, `src/match-reference.js`, `src/validation.js`
- Persistencia: `src/store.js`
- Dados base da Copa: `src/world-cup-2026-data.js`
- Testes: `test/*.test.js`

## Comandos

- Instalar dependencias: `npm install`
- Rodar app local: `npm run dev`
- Rodar API Node local: `npm run api:start`
- Rodar testes: `npm test`
- Rodar build: `npm run build`
- Validar antes de entregar: `npm run validate`

## Regras de trabalho

- Prefira mudancas pequenas, incrementais e alinhadas ao estilo existente.
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

Testes devem rodar com `NODE_ENV=test` e nao devem exigir rede, Firebase real ou secrets.

## Validacao esperada

Antes de finalizar mudancas de codigo, rode:

```bash
npm run validate
```

Se a mudanca for pequena e o build completo for caro para a iteracao, rode primeiro:

```bash
npm test
```

Depois registre no resumo final quais comandos foram executados e o resultado.
