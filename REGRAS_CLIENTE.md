# Regras de Negocio para Apps Cliente

Este documento descreve as regras que os apps cliente devem seguir ao consumir a API do Bolao26.

## Objetivo

O app cliente deve permitir que usuarios participem de boloes da Copa do Mundo FIFA 2026, façam palpites antes do inicio dos jogos, acompanhem seus pontos e vejam o ranking do bolao.

## Autenticacao

- O usuario cria conta com `name`, `email` e `password`.
- `name` deve ter pelo menos 2 caracteres.
- `email` deve ter formato valido.
- `password` deve ter pelo menos 8 caracteres no cadastro.
- O primeiro usuario cadastrado no sistema recebe role `admin`.
- Usuarios seguintes recebem role `player`.
- Login e cadastro retornam `token`.
- Todas as rotas protegidas devem enviar `Authorization: Bearer <token>`.
- O cliente deve armazenar o token de forma segura.
- Quando a API retornar `401`, o cliente deve tratar como sessao invalida ou expirada e pedir novo login.

## Perfis de Usuario

### Player

Pode:

- Ver selecoes, grupos e jogos.
- Criar bolao.
- Entrar em bolao.
- Fazer e editar seus palpites antes do fechamento.
- Ver seus palpites.
- Ver ranking dos boloes em que participa.

### Admin

Pode tudo que um player pode, alem de:

- Criar selecoes.
- Criar jogos.
- Editar jogos e resultados.
- Sincronizar placares via live score.

## Copa 2026

- A base inicial possui 48 selecoes.
- Existem 12 grupos: `A` ate `L`.
- Cada grupo tem 4 selecoes.
- A fase de grupos possui 72 jogos.
- Datas e horarios sao salvos em UTC no campo `startsAt`.
- O app deve converter `startsAt` e `lockAt` para o fuso local do usuario na exibicao.

## Selecoes

Modelo:

```json
{
  "id": "team_...",
  "name": "Brasil",
  "code": "BRA",
  "group": "C"
}
```

Regras:

- `code` e unico.
- `group` pode ser `A` ate `L`.
- O cliente deve preferir `code` para abreviacoes visuais e `name` para textos completos.

## Grupos

`GET /groups` retorna:

```json
{
  "groups": [
    {
      "group": "C",
      "teams": [],
      "matches": []
    }
  ]
}
```

Regras de exibicao:

- Ordenar grupos alfabeticamente.
- Dentro do grupo, exibir as selecoes retornadas pela API.
- Jogos do grupo ja sao retornados ordenados por `matchNumber`.

## Jogos

Modelo:

```json
{
  "id": "match_...",
  "matchNumber": 1,
  "homeTeamId": "team_...",
  "awayTeamId": "team_...",
  "stage": "group",
  "group": "A",
  "startsAt": "2026-06-11T19:00:00.000Z",
  "lockAt": "2026-06-11T19:00:00.000Z",
  "venue": "Estadio Azteca",
  "city": "Mexico City",
  "status": "scheduled",
  "homeGoals": null,
  "awayGoals": null
}
```

Status possiveis:

- `scheduled`: jogo agendado.
- `live`: jogo em andamento.
- `finished`: jogo encerrado.
- `cancelled`: jogo cancelado ou suspenso.

Regras:

- `homeTeamId` e `awayTeamId` sempre devem apontar para selecoes existentes.
- Um jogo nao pode ter a mesma selecao como mandante e visitante.
- Se `homeGoals` e `awayGoals` forem definidos, o status passa a ser `finished`.
- O app deve bloquear palpite localmente quando `Date.now() >= lockAt`, mesmo antes de tentar enviar para a API.
- A API tambem bloqueia palpites encerrados e retorna `409`.

## Boloes

No MVP existe apenas um bolao ativo.

Modelo publico:

```json
{
  "id": "pool_...",
  "name": "Bolao da firma",
  "ownerId": "usr_...",
  "inviteCode": "ABCD1234",
  "createdAt": "2026-06-02T12:00:00.000Z"
}
```

Regras:

- Ao autenticar, o cliente deve chamar `GET /pools/active`.
- A API cria o bolao ativo se ele ainda nao existir.
- A API inclui automaticamente o usuario autenticado como participante.
- O cliente deve abrir direto a tela do bolao ativo.
- Criacao, selecao e entrada por convite ficam fora do MVP.

## Participacao

Modelo:

```json
{
  "poolId": "pool_...",
  "userId": "usr_...",
  "joinedAt": "2026-06-02T12:00:00.000Z"
}
```

Regras:

- Um usuario so pode ver detalhes, palpites e ranking de boloes em que participa.
- Se tentar acessar bolao sem participacao, a API retorna `403`.

## Palpites

Modelo:

```json
{
  "id": "pred_...",
  "poolId": "pool_...",
  "userId": "usr_...",
  "matchId": "match_...",
  "homeGoals": 2,
  "awayGoals": 1,
  "createdAt": "2026-06-02T12:00:00.000Z",
  "updatedAt": "2026-06-02T12:00:00.000Z"
}
```

Regras:

- O usuario precisa estar autenticado.
- O usuario precisa participar do bolao.
- `matchId` deve existir.
- `homeGoals` e `awayGoals` devem ser inteiros maiores ou iguais a 0.
- O palpite pode ser criado ou atualizado ate `lockAt`.
- Depois de `lockAt`, a API retorna `409`.
- Para o mesmo `poolId`, `userId` e `matchId`, existe apenas um palpite.
- Enviar novo palpite para o mesmo jogo atualiza o palpite anterior.
- O cliente deve tratar `POST /pools/:id/predictions` como upsert.

## Pontuacao

A pontuacao e calculada somente quando o jogo possui resultado inteiro em `homeGoals` e `awayGoals`.

Regras:

- 25 pontos: placar exato.
- 10 pontos: acerto do vencedor ou empate.
- 5 pontos: acerto da diferenca de gols sem placar exato.
- 2 pontos: acerto dos gols do mandante.
- 2 pontos: acerto dos gols do visitante.

Exemplos considerando resultado real `Brasil 2 x 1 Marrocos`:

| Palpite | Pontos | Motivo |
| --- | ---: | --- |
| 2 x 1 | 25 | Placar exato |
| 2 x 0 | 12 | Vencedor + gols do mandante |
| 3 x 2 | 15 | Vencedor + diferenca de gols |
| 1 x 0 | 10 | Vencedor |
| 0 x 0 | 0 | Resultado incorreto |

Observacao:

- Placar exato substitui as outras regras e retorna 25 pontos.
- Sem resultado oficial, o palpite vale 0 temporariamente.

## Ranking

`GET /pools/:id/leaderboard` retorna:

```json
{
  "leaderboard": [
    {
      "userId": "usr_...",
      "name": "Vagner",
      "predictions": 10,
      "points": 82
    }
  ]
}
```

Ordenacao:

1. Maior pontuacao.
2. Maior quantidade de palpites.
3. Nome em ordem alfabetica.

Regras de UX:

- O ranking deve ser recalculado pela API.
- O cliente pode exibir pontuacao local estimada, mas deve considerar a API como fonte final.
- Participantes sem palpites aparecem com 0 pontos.

## Live Score

Provider atual:

- `football-data.org`
- Competicao padrao: `WC`
- Temporada padrao: `2026`

Regras:

- `GET /live-score/provider` informa se o provider esta configurado.
- `POST /live-score/sync` e rota admin.
- Sync atualiza jogos locais usando selecoes mandante e visitante.
- Campos atualizados pelo sync:
  - `status`
  - `homeGoals`
  - `awayGoals`
  - `externalProvider`
  - `externalMatchId`
  - `externalLastUpdated`

Regras para cliente:

- Player nao deve chamar sync.
- Tela admin pode ter acao manual de sincronizacao.
- App deve refletir novos resultados apos recarregar `GET /matches`, `GET /groups` ou leaderboard.

## Firebase Firestore

A API grava no Firebase Firestore usando documentos chaveados por ID.

Estrutura:

```text
bolao26/default/users/{userId}
bolao26/default/teams/{teamId}
bolao26/default/matches/{matchId}
bolao26/default/pools/{poolId}
bolao26/default/memberships/{poolId_userId}
bolao26/default/predictions/{predictionId}
```

Regras para apps cliente:

- O app cliente deve consumir a API HTTP como fonte principal.
- Nao escrever diretamente no Firestore sem passar pela API, para nao pular regras de negocio.
- Se usar listeners do Firestore para tempo real, tratar como leitura complementar.
- Escritas diretas no Firestore podem quebrar:
  - validacao de palpite fechado;
  - regra de participante do bolao;
  - pontuacao;
  - unicidade de palpite por jogo;
  - permissoes de admin.

## Erros que o Cliente Deve Tratar

| Status | Significado | Acao recomendada |
| ---: | --- | --- |
| 400 | Dados invalidos | Mostrar erro de formulario |
| 401 | Sem autenticacao ou token invalido | Pedir login |
| 403 | Sem permissao | Ocultar acao ou mostrar acesso negado |
| 404 | Recurso nao encontrado | Voltar ou recarregar lista |
| 409 | Conflito de regra de negocio | Mostrar mensagem contextual |
| 500 | Erro interno | Mostrar falha temporaria |
| 503 | Integracao externa nao configurada ou indisponivel | Mostrar indisponibilidade |

## Fluxos Recomendados

### Cadastro e primeiro acesso

1. Chamar `POST /auth/register`.
2. Guardar `token`.
3. Chamar `GET /groups` para carregar Copa.
4. Chamar `GET /pools` para listar boloes do usuario.

### Criar bolao

1. Usuario informa nome.
2. Chamar `POST /pools`.
3. Exibir `inviteCode` para compartilhamento.
4. Abrir tela do bolao criado.

### Entrar em bolao

1. Usuario informa `poolId` e `inviteCode`.
2. Chamar `POST /pools/:id/join`.
3. Recarregar `GET /pools`.

### Fazer palpite

1. Carregar jogos com `GET /matches` ou `GET /groups`.
2. Verificar se `lockAt` ainda nao passou.
3. Enviar `POST /pools/:id/predictions`.
4. Recarregar `GET /pools/:id/predictions`.

### Ver ranking

1. Chamar `GET /pools/:id/leaderboard`.
2. Atualizar ao entrar na tela.
3. Atualizar novamente depois que resultados forem sincronizados.

## Regras de Interface

- Mostrar horario dos jogos no fuso local do usuario.
- Mostrar status visual para jogos agendados, ao vivo, encerrados e cancelados.
- Desabilitar campos de palpite apos `lockAt`.
- Exibir claramente se um palpite foi salvo.
- Permitir editar palpite ate o fechamento.
- Em ranking, destacar o usuario logado.
- Em tela de jogo encerrado, mostrar resultado real e pontos do palpite.
- Em tela admin, separar acoes administrativas das acoes normais de jogador.

## Fonte de Verdade

- A API e a fonte de verdade para autenticacao, permissoes, palpites, pontuacao e ranking.
- O Firestore e a camada de persistencia.
- O provider de live score e fonte externa para resultados, mas a API decide como aplicar os dados.
