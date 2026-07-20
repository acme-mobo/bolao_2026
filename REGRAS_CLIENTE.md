# Regras de Negócio para Apps Cliente

Este contrato é independente de competição e edição.

## Autenticação e perfis

- O primeiro usuário criado recebe `admin`; os seguintes recebem `player`.
- Rotas protegidas exigem `Authorization: Bearer <token>`.
- Players consultam jogos, registram palpites e acompanham ranking.
- Admins também criam/alteram times e jogos e sincronizam placares.

## Times e grupos

```json
{
  "id": "team_ALF",
  "name": "Time Alfa",
  "code": "ALF",
  "group": "A",
  "flag": "🏳️"
}
```

`code` deve ser único. `group` e `flag` são opcionais. A interface usa `flag` quando
informado e não mantém uma lista fixa de seleções.

## Jogos

```json
{
  "id": "match_1",
  "matchNumber": 1,
  "homeTeamId": "team_ALF",
  "awayTeamId": "team_BET",
  "stage": "group",
  "group": "A",
  "startsAt": "2030-06-01T19:00:00.000Z",
  "lockAt": "2030-06-01T19:00:00.000Z",
  "status": "scheduled",
  "homeGoals": null,
  "awayGoals": null
}
```

Status aceitos: `scheduled`, `live`, `finished` e `cancelled`. Datas são salvas em UTC e
exibidas no fuso do usuário. Jogos eliminatórios podem usar `homeSlot` e `awaySlot` enquanto
os times ainda não estiverem definidos.

Palpites fecham cinco minutos antes de `startsAt` ou em `lockAt`, o que ocorrer primeiro.
A API rejeita palpites fechados e jogos sem os dois times definidos com `409`.

## Bolão ativo

No MVP existe um bolão ativo. `GET /pools/active` cria o bolão padrão configurado quando
necessário e inclui automaticamente o usuário autenticado como participante.

## Palpites

```json
{
  "id": "pred_...",
  "poolId": "pool_main",
  "userId": "usr_...",
  "matchId": "match_1",
  "homeGoals": 2,
  "awayGoals": 1
}
```

- Gols são inteiros maiores ou iguais a zero.
- `POST /pools/:id/predictions` faz upsert por usuário e jogo.
- O usuário precisa participar do bolão.
- Palpites de outros jogadores só ficam visíveis quando o jogo está ao vivo ou encerrado.

## Pontuação e ranking

| Pontos | Condição |
| ---: | --- |
| 5 | Placar exato |
| 3 | Vencedor ou empate correto, sem placar exato |
| 0 | Resultado incorreto ou jogo sem resultado |

O ranking ordena por pontos, depois por quantidade de placares exatos e finalmente por nome.
A API é a fonte final da pontuação.

## Live score

O provider é configurado no servidor. O cliente consome somente o formato normalizado da API.
Admins podem disparar sincronização manual; players apenas recarregam jogos e ranking.

## Persistência

Clientes devem escrever pela API HTTP. Escritas diretas no Firestore podem ignorar validação,
autorização, fechamento dos palpites e unicidade.

## Erros esperados

| Status | Significado |
| ---: | --- |
| 400 | Dados inválidos |
| 401 | Autenticação ausente ou expirada |
| 403 | Operação sem permissão |
| 404 | Recurso inexistente |
| 409 | Conflito de regra de negócio |
| 500 | Falha interna |
| 503 | Integração externa indisponível ou não configurada |
