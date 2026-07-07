import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import {
  LiveScoreClient,
  normalizeLiveScoreDateEvent,
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

function dateApiEvent(overrides = {}) {
  return {
    Eid: '1417909',
    Esd: 20260611190000,
    Eps: "27'",
    Esid: 2,
    Tr1: '1',
    Tr2: '0',
    T1: [{ Abr: 'MEX', Nm: 'Mexico', NmEn: 'Mexico', Img: 'enet/6710.png' }],
    T2: [{ Abr: 'RSA', Nm: 'Africa do Sul', NmEn: 'South Africa', Img: 'teambadge/south-africa-2024.png' }],
    Etm: { RTm: 27 },
    ...overrides,
  };
}

function dateApiPayload(events, stageOverrides = {}) {
  return {
    Stages: [
      {
        CompId: '734',
        Snm: 'Group A',
        Events: events,
        ...stageOverrides,
      },
    ],
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

test('normalizeLiveScoreDateEvent normaliza placar ao vivo do endpoint publico por data', () => {
  const fixture = normalizeLiveScoreDateEvent(dateApiEvent(), { Snm: 'Group A' });

  assert.equal(fixture.externalId, '1417909');
  assert.equal(fixture.date, '2026-06-11T19:00:00.000Z');
  assert.equal(fixture.status, 'live');
  assert.equal(fixture.statusShort, "27'");
  assert.equal(fixture.statusElapsed, 27);
  assert.equal(fixture.homeCode, 'MEX');
  assert.equal(fixture.awayCode, 'RSA');
  assert.equal(fixture.homeGoals, 1);
  assert.equal(fixture.awayGoals, 0);
  assert.equal(fixture.group, 'A');
});

test('normalizeLiveScoreDateEvent trata intervalo como jogo ao vivo', () => {
  const fixture = normalizeLiveScoreDateEvent(dateApiEvent({
    Eps: 'HT',
    Esid: 0,
    Etm: {},
    Tr1: '1',
    Tr2: '1',
  }), { Snm: 'Group A' });

  assert.equal(fixture.status, 'live');
  assert.equal(fixture.statusShort, 'HT');
  assert.equal(fixture.homeGoals, 1);
  assert.equal(fixture.awayGoals, 1);
});

test('LiveScoreClient descobre buildId e usa JSON do Next', async () => {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (String(url).includes('/v1/api/app/date/soccer/')) return jsonResponse(dateApiPayload([]));
    if (!String(url).includes('/_next/data/')) return htmlResponse(payload([]));
    return jsonResponse(payload([event({ eventStatus: 'FINISHED', homeTeamScore: '2', awayTeamScore: '0' })]));
  };

  const client = new LiveScoreClient({
    fixturesUrl: 'https://www.livescore.com/pt/futebol/international/world-cup-2026/fixtures/',
    publicApiUrl: 'https://prod-cdn-public-api.livescore.com',
  });

  const fixtures = await client.fetchLiveFixtures();

  // 2 fixture page calls + 2 results page calls + date-from-event + utcToday + utcYesterday = 7
  assert.equal(client.requestCount, 7);
  assert.equal(calls[1], 'https://www.livescore.com/_next/data/test-build/pt/futebol/international/world-cup-2026/fixtures.json?sport=futebol&dateOrCategory=international&competitionOrStage=world-cup-2026');
  assert.equal(calls[3], 'https://www.livescore.com/_next/data/test-build/pt/futebol/international/world-cup-2026/results.json?sport=futebol&dateOrCategory=international&competitionOrStage=world-cup-2026');
  assert.ok(calls[4].includes('/v1/api/app/date/soccer/'));
  assert.equal(fixtures.length, 1);
  assert.equal(fixtures[0].externalId, '1417909');
  assert.equal(fixtures[0].status, 'finished');
});

test('LiveScoreClient sobrescreve placar defasado do Next com endpoint publico por data', async () => {
  globalThis.fetch = async (url) => {
    const text = String(url);
    if (text.includes('/v1/api/app/date/soccer/20260611/0')) return jsonResponse(dateApiPayload([dateApiEvent()]));
    if (!text.includes('/_next/data/')) return htmlResponse(payload([]));
    return jsonResponse(payload([event({
      eventStatus: 'LIVE',
      homeTeamScore: '0',
      awayTeamScore: '0',
      scores: { matchStatusDetails: { isInProgress: true, isFinished: false } },
    })]));
  };

  const client = new LiveScoreClient({
    fixturesUrl: 'https://www.livescore.com/pt/futebol/international/world-cup-2026/fixtures/',
    publicApiUrl: 'https://prod-cdn-public-api.livescore.com',
  });

  const fixtures = await client.fetchLiveFixtures();

  assert.equal(fixtures.length, 1);
  assert.equal(fixtures[0].status, 'live');
  assert.equal(fixtures[0].homeGoals, 1);
  assert.equal(fixtures[0].awayGoals, 0);
});

test('LiveScoreClient sobrescreve placar por par de times quando endpoint por data usa outro id', async () => {
  globalThis.fetch = async (url) => {
    const text = String(url);
    if (text.includes('/v1/api/app/date/soccer/20260611/0')) {
      return jsonResponse(dateApiPayload([dateApiEvent({
        Eid: 'date-api-1001',
        Tr1: '2',
        Tr2: '1',
        Eps: "64'",
        Etm: { RTm: 64 },
      })]));
    }
    if (!text.includes('/_next/data/')) return htmlResponse(payload([]));
    return jsonResponse(payload([event({
      id: 'next-1001',
      eventStatus: 'LIVE',
      homeTeamScore: '1',
      awayTeamScore: '0',
      scores: { matchStatusDetails: { isInProgress: true, isFinished: false } },
    })]));
  };

  const client = new LiveScoreClient({
    fixturesUrl: 'https://www.livescore.com/pt/futebol/international/world-cup-2026/fixtures/',
    publicApiUrl: 'https://prod-cdn-public-api.livescore.com',
  });

  const fixtures = await client.fetchLiveFixtures();

  assert.equal(fixtures.length, 1);
  assert.equal(fixtures[0].externalId, 'date-api-1001');
  assert.equal(fixtures[0].homeGoals, 2);
  assert.equal(fixtures[0].awayGoals, 1);
  assert.equal(fixtures[0].statusElapsed, 64);
});

test('LiveScoreClient usa __NEXT_DATA__ como fallback se JSON falhar', async () => {
  globalThis.fetch = async (url) => {
    if (String(url).includes('/v1/api/app/date/soccer/')) return jsonResponse(dateApiPayload([]));
    if (String(url).includes('/_next/data/')) return jsonResponse({ error: true }, { status: 500 });
    return htmlResponse(payload([event()]));
  };

  const client = new LiveScoreClient({
    fixturesUrl: 'https://www.livescore.com/pt/futebol/international/world-cup-2026/fixtures/',
    publicApiUrl: 'https://prod-cdn-public-api.livescore.com',
  });

  const fixtures = await client.fetchLiveFixtures();

  // 2 fixture page calls + 2 results page calls + date-from-event + utcToday + utcYesterday = 7
  assert.equal(client.requestCount, 7);
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

test('resolveAbr converte codigo ISO para FIFA em normalizeLiveScoreDateEvent', () => {
  // Paraguay: LiveScore pode enviar Abr='PRY' (ISO) ou 'PAR' (FIFA)
  const fixtureIso = normalizeLiveScoreDateEvent({
    Eid: '111',
    T1: [{ Abr: 'USA', NmEn: 'United States' }],
    T2: [{ Abr: 'PRY', NmEn: 'Paraguay' }],
    Tr1: 1, Tr2: 0, Esid: 2, Esd: 20260613010000,
  });
  assert.equal(fixtureIso.homeCode, 'USA');
  assert.equal(fixtureIso.awayCode, 'PAR');

  // Switzerland: CHE (ISO) → SUI (FIFA/bolão)
  const fixtureChe = normalizeLiveScoreDateEvent({
    Eid: '222',
    T1: [{ Abr: 'QAT', NmEn: 'Qatar' }],
    T2: [{ Abr: 'CHE', NmEn: 'Switzerland' }],
    Tr1: 0, Tr2: 0, Esid: 1, Esd: 20260613190000,
  });
  assert.equal(fixtureChe.homeCode, 'QAT');
  assert.equal(fixtureChe.awayCode, 'SUI');
});

test('resolveAbr converte codigo ISO para FIFA em normalizeLiveScoreEvent', () => {
  const fixture = normalizeLiveScoreEvent({
    id: '333',
    homeTeamAbr: 'USA',
    awayTeamAbr: 'PRY',
    homeTeamScore: 1,
    awayTeamScore: 0,
    eventStatus: 'LIVE',
    startDateTimeString: '20260613010000',
  });
  assert.equal(fixture.homeCode, 'USA');
  assert.equal(fixture.awayCode, 'PAR');
});

test('normalizeLiveScoreDateEvent resolve times sem Abr por nome ingles', () => {
  // Sem Abr, depende de NmEn → livescoreCodeOverrides
  const fixture = normalizeLiveScoreDateEvent({
    Eid: '444',
    T1: [{ Abr: null, NmEn: 'United States' }],
    T2: [{ Abr: null, NmEn: 'Paraguay' }],
    Tr1: 1, Tr2: 0, Esid: 2, Esd: 20260613010000,
  });
  assert.equal(fixture.homeCode, 'USA');
  assert.equal(fixture.awayCode, 'PAR');
});
