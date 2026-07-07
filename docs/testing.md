# Estrategia de Testes

O projeto usa o test runner nativo do Node (`node:test`) com `node:assert/strict`.

## Comandos

```bash
npm test
npm run build
npm run validate
```

`npm run validate` e o comando padrao antes de entregar mudancas: ele roda testes e build.

## Tipos de teste

Regras puras devem ser testadas diretamente nos modulos de `src/`, como `src/scoring.js`.

Rotas HTTP devem ser testadas via `createRouter` em `src/routes.js`, seguindo o padrao de `test/api.test.js`. Isso cobre o contrato da API sem subir servidor real.

Persistencia deve ser testada com arquivos temporarios, stores em memoria ou fakes. Testes nao devem depender de Firestore real.

Integracoes externas devem ser testadas com providers falsos, responses controladas ou fixtures pequenas. Nao faca chamadas reais de rede em testes automatizados.

Dados da Copa devem ter testes especificos quando houver alteracao em calendario, times, grupos ou match numbers.

## Quando adicionar testes

Adicione ou ajuste testes quando:

- Corrigir bug de regra de pontuacao, ranking, palpites ou fechamento.
- Alterar contrato de rota, status code, payload ou cache-control.
- Mudar persistencia, normalizacao de dados ou formato de seed.
- Alterar sync de placares ou provider externo.

Para mudancas visuais pequenas, rode ao menos `npm run build`. Se houver regra de exibicao baseada em dados, prefira extrair a regra ou cobrir via teste existente de API/dominio.
