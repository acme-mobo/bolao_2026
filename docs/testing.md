# Estrategia de Testes

O projeto usa o test runner nativo do Node (`node:test`) com `node:assert/strict`.

## Comandos

```bash
npm test
npm run test:watch
npm run validate:quick
npm run build
npm run validate
```

`npm test` e o ciclo rapido. `npm run validate:quick` executa a mesma suite pelo harness.
`npm run validate` e o comando final: ele roda testes e build de producao.

## Tipos de teste

Regras puras devem ser testadas diretamente nos modulos de `src/`, como `src/scoring.js`.

Rotas HTTP devem ser testadas via `createRouter` em `src/routes.js`, seguindo o padrao de `test/api.test.js`. Isso cobre o contrato da API sem subir servidor real.

Persistencia deve ser testada com arquivos temporarios, stores em memoria ou fakes. Testes nao devem depender de Firestore real.

Integracoes externas devem ser testadas com providers falsos, responses controladas ou fixtures pequenas. Nao faca chamadas reais de rede em testes automatizados.

O formato do seed generico deve ter testes quando houver alteracao em times, jogos ou validacoes.

## Matriz por tipo de mudanca

| Mudanca | Cobertura preferida | Validacao minima |
| --- | --- | --- |
| Regra pura | Teste direto do modulo | `npm test` |
| Rota ou contrato HTTP | `createRouter` | `npm test` |
| Persistencia | Store temporario ou fake | `npm test` |
| Provider ou sync | Payload e provider falsos | `npm test` |
| Seed ou template | Validacao e normalizacao | `npm test` |
| UI ou configuracao Next | Regra extraida quando aplicavel | `npm run validate` |
| Documentacao ou prompt | Revisao de links e comandos | `git diff --check` |

## Quando adicionar testes

Adicione ou ajuste testes quando:

- Corrigir bug de regra de pontuacao, ranking, palpites ou fechamento.
- Alterar contrato de rota, status code, payload ou cache-control.
- Mudar persistencia, normalizacao de dados ou formato de seed.
- Alterar sync de placares ou provider externo.

Para mudancas visuais pequenas, rode ao menos `npm run build`. Se houver regra de exibicao baseada em dados, prefira extrair a regra ou cobrir via teste existente de API/dominio.

## Qualidade dos testes

- Teste comportamento observavel, nao detalhes internos sem valor de contrato.
- Cubra o caminho principal e os erros relevantes sem repetir a mesma assercao em varias camadas.
- Use fixtures pequenas e explicitas dentro do teste ou em helpers proximos.
- Evite snapshots grandes e dependencias de horario, rede ou ordem global.
- Um teste deve falhar por uma razao clara e apontar o comportamento quebrado.
