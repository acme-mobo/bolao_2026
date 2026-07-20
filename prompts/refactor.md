# Prompt: Refactor

Use este prompt para refatoracoes incrementais sem mudar comportamento.

```text
Refatore a area abaixo sem alterar comportamento observavel.

Escopo:
- Arquivos/modulos:
- Objetivo:
- O que nao deve mudar:

Criterios de aceite:
-

Regras:
- Primeiro leia os arquivos envolvidos e os testes existentes.
- Mantenha o diff pequeno e facil de revisar.
- Nao misture bugfix, mudanca visual ou mudanca de contrato se nao for necessario.
- Preserve nomes publicos e payloads de API, salvo pedido explicito.
- Rode testes antes e depois quando fizer sentido.
- Se descobrir mudanca funcional necessaria, pare e explique antes de amplia-la.
- No resumo final, explique o que ficou igual, o que foi simplificado e como foi validado.
```
