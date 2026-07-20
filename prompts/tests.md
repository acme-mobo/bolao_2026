# Prompt: Criacao de Testes

Use este prompt para aumentar cobertura de comportamento existente.

```text
Crie testes para o comportamento abaixo.

Comportamento:
- Modulo/rota:
- Casos principais:
- Casos de erro ou borda:

Fora de escopo:
-

Criterios de aceite:
-

Regras:
- Use `node:test` e `node:assert/strict`.
- Siga os padroes dos arquivos em `test/`.
- Nao use rede, Firebase real ou secrets.
- Para API, teste via `createRouter`.
- Para store, use arquivo temporario ou fake.
- Nao altere comportamento de producao a menos que seja indispensavel para tornar o teste possivel.
- Evite snapshots grandes e assercoes sobre detalhes internos sem valor de contrato.
- Rode primeiro o arquivo de teste afetado, depois `npm test`, e reporte os resultados.
```
