import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import {
  LiveScoreClient,
  normalizeLiveScoreEvent,
  normalizeLiveScoreStandings,
  parseLiveScoreDate,
} from '../src/livescore.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function jsonResponse(body, options = {}) {
  return new Response(JSON.stringify(body), {
    status: options.status ?? 200,
    headers: { 'content-type': 'application/json' },
  });
}

function htmlResponse(payload) {
  return new Response(
    `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(payload)}</script></body></html>`,
    { status: 200, headers: { 'content-type': 'text/html' } },
  );
}

function event(overrides = {}) {
  return {
    id: '1417909',
    startDateTimeString: '20260611190000',
    eventStatus: 'UPCOMING',
    statusDescription: 'UNKNOWN',
    homeTeamScore: '',
    awayTeamScore: '',
    homeTeamName: 'Mexico',
    awayTeamName: 'Africa do Sul',
    homeTeamNameEn: 'Mexico',
    awayTeamNameEn: 'South Africa',
    homeTeamAbr: 'MEX',
    awayTeamAbr: 'RSA',
    stageName: 'Group A',
    homeTeamBadge: 'enet/6710.png',
    awayTeamBadge: 'teambadge/south-africa-2024.png',
    scores: {
      matchStatusDetails: {
        isNotStarted: true,
        isInProgress: false,
        isFinished: false,
      },
    },
    ...overrides,
  };
}

function payload(events) {
  return {
    buildId: 'test-build',
    pageProps: {
      initialData: {
        sections: [
          {
            id: '734',
            events,
          },
        ],
      },
    },
  };
}

test('parseLiveScoreDate converte startDateTimeString como UTC', () => {
  assert.equal(parseLiveScoreDate('20260611190000'), '2026-06-11T19:00:00.000Z');
  assert.equal(parseLiveScoreDate('invalid'), null);
});

test('normalizeLiveScoreEvent normaliza jogo UPCOMING real do LiveScore', () => {
  const fixture = normalizeLiveScoreEvent(event());

  assert.deepEqual(fixture, {
    externalId: '1417909',
    fixtureId: '1417909',
    date: '2026-06-11T19:00:00.000Z',
    statusShort: 'UPCOMING',
    statusElapsed: null,
    status: 'scheduled',
    round: null,
    group: 'A',
    venue: null,
    city: null,
    homeCode: 'MEX',
    awayCode: 'RSA',
    homeName: 'Mexico',
    awayName: 'South Africa',
    homeLogo: 'enet/6710.png',
    awayLogo: 'teambadge/south-africa-2024.png',
    homeGoals: null,
    awayGoals: null,
    rawStatus: 'UPCOMING',
    updatedAt: fixture.updatedAt,
  });
  assert.match(fixture.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('normalizeLiveScoreEvent identifica live e placar numerico', () => {
  const fixture = normalizeLiveScoreEvent(event({
    eventStatus: 'LIVE',
    homeTeamScore: '0',
    awayTeamScore: '2',
    scores: { matchStatusDetails: { isInProgress: true, isFinished: false } },
  }));

  assert.equal(fixture.status, 'live');
  assert.equal(fixture.homeGoals, 0);
  assert.equal(fixture.awayGoals, 2);
});

test('normalizeLiveScoreEvent identifica finished por detalhes do placar', () => {
  const fixture = normalizeLiveScoreEvent(event({
    eventStatus: 'FINISHED',
    homeTeamScore: '2',
    awayTeamScore: '0',
    scores: { matchStatusDetails: { isInProgress: false, isFinished: true } },
  }));

  assert.equal(fixture.status, 'finished');
  assert.equal(fixture.homeGoals, 2);
  assert.equal(fixture.awayGoals, 0);
});

test('LiveScoreClient descobre buildId e usa JSON do Next', async () => {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (!String(url).includes('/_next/data/')) return htmlResponse(payload([]));
    return jsonResponse(payload([event({ eventStatus: 'FINISHED', homeTeamScore: '2', awayTeamScore: '0' })]));
  };

  const client = new LiveScoreClient({
    fixturesUrl: 'https://www.livescore.com/pt/futebol/international/world-cup-2026/fixtures/',
  });

  const fixtures = await client.fetchLiveFixtures();

  assert.equal(client.requestCount, 4);
  assert.equal(calls[1], 'https://www.livescore.com/_next/data/test-build/pt/futebol/international/world-cup-2026/fixtures.json?sport=futebol&dateOrCategory=international&competitionOrStage=world-cup-2026');
  assert.equal(calls[3], 'https://www.livescore.com/_next/data/test-build/pt/futebol/international/world-cup-2026/results.json?sport=futebol&dateOrCategory=international&competitionOrStage=world-cup-2026');
  assert.equal(fixtures.length, 1);
  assert.equal(fixtures[0].externalId, '1417909');
  assert.equal(fixtures[0].status, 'finished');
});

test('LiveScoreClient usa __NEXT_DATA__ como fallback se JSON falhar', async () => {
  globalThis.fetch = async (url) => {
    if (String(url).includes('/_next/data/')) return jsonResponse({ error: true }, { status: 500 });
    return htmlResponse(payload([event()]));
  };

  const client = new LiveScoreClient({
    fixturesUrl: 'https://www.livescore.com/pt/futebol/international/world-cup-2026/fixtures/',
  });

  const fixtures = await client.fetchLiveFixtures();

  assert.equal(client.requestCount, 4);
  assert.equal(fixtures.length, 1);
  assert.equal(fixtures[0].status, 'scheduled');
});

test('normalizeLiveScoreStandings normaliza tabela de grupos', () => {
  const standings = normalizeLiveScoreStandings({
    Stages: [
      {
        Sid: '19986',
        Snm: 'Group A',
        LeagueTable: {
          L: [
            {
              Tables: [
                {
                  team: [
                    {
                      rnk: 2,
                      Tid: '9025',
                      Tnm: 'México',
                      NmEn: 'Mexico',
                      Img: 'enet/6710.png',
                      pts: 4,
                      pld: 2,
                      win: 1,
                      drw: 1,
                      lst: 0,
                      gf: 3,
                      ga: 1,
                      gd: 2,
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
    ],
  });

  assert.deepEqual(standings, [
    {
      group: 'A',
      rank: 2,
      teamId: '9025',
      teamCode: 'MEX',
      teamName: 'México',
      teamNameEn: 'Mexico',
      teamLogo: 'enet/6710.png',
      points: 4,
      played: 2,
      won: 1,
      drawn: 1,
      lost: 0,
      goalsFor: 3,
      goalsAgainst: 1,
      goalsDiff: 2,
      form: null,
      source: 'livescore',
      stageId: '19986',
    },
  ]);
});

test('LiveScoreClient busca standings no endpoint publico leagueTable', async () => {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (String(url).includes('/leagueTable')) {
      return jsonResponse({
        Stages: [
          {
            Sid: '19986',
            Snm: 'Group A',
            LeagueTable: {
              L: [{ Tables: [{ team: [{ rnk: 1, Tid: '9025', Tnm: 'México', NmEn: 'Mexico', pts: 0, pld: 0 }] }] }],
            },
          },
        ],
      });
    }
    if (!String(url).includes('/_next/data/')) {
      return htmlResponse({
        buildId: 'test-build',
        pageProps: { competitionId: '734', initialData: { sections: [] } },
      });
    }
    return jsonResponse({ pageProps: { competitionId: '734', initialData: { sections: [] } } });
  };

  const client = new LiveScoreClient({
    fixturesUrl: 'https://www.livescore.com/pt/futebol/international/world-cup-2026/fixtures/',
    standingsUrl: 'https://www.livescore.com/pt/futebol/international/world-cup-2026/standings/',
    publicApiUrl: 'https://prod-cdn-public-api.livescore.com',
  });

  const standings = await client.fetchStandings();

  assert.equal(calls[2], 'https://prod-cdn-public-api.livescore.com/v1/api/app/competition/734/leagueTable?locale=pt');
  assert.equal(standings.length, 1);
  assert.equal(standings[0].teamCode, 'MEX');
});
