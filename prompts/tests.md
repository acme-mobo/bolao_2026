# Prompt: Criacao de Testes

Use este prompt para aumentar cobertura de comportamento existente.

```text
Crie testes para o comportamento abaixo.

Comportamento:
- Modulo/rota:
- Casos principais:
- Casos de erro ou borda:

Regras:
- Use `node:test` e `node:assert/strict`.
- Siga os padroes dos arquivos em `test/`.
- Nao use rede, Firebase real ou secrets.
- Para API, teste via `createRouter`.
- Para store, use arquivo temporario ou fake.
- Nao altere comportamento de producao a menos que seja indispensavel para tornar o teste possivel.
- Rode `npm test` ao final e reporte o resultado.
```
