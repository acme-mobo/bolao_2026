'use client';

import Link from 'next/link';
import {
  Clock, Home, LogOut, Moon, Radio, Sun, Trophy,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  getFirebaseAuth,
  onAuthStateChanged,
  signOut,
} from '../lib/firebase-client.js';

async function api(path, token, options = {}) {
  const response = await fetch(`/api${path}`, {
    cache: 'no-store',
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {}),
    },
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : undefined;
  if (!response.ok) throw new Error(body?.error?.message ?? 'Falha na requisição');
  return body;
}

const FLAG_BY_CODE = {
  MEX: '🇲🇽', RSA: '🇿🇦', KOR: '🇰🇷', CZE: '🇨🇿',
  CAN: '🇨🇦', BIH: '🇧🇦', QAT: '🇶🇦', SUI: '🇨🇭',
  BRA: '🇧🇷', MAR: '🇲🇦', HAI: '🇭🇹', SCO: '🏴',
  USA: '🇺🇸', PAR: '🇵🇾', AUS: '🇦🇺', TUR: '🇹🇷',
  GER: '🇩🇪', CUW: '🇨🇼', CIV: '🇨🇮', ECU: '🇪🇨',
  NED: '🇳🇱', JPN: '🇯🇵', TUN: '🇹🇳', SWE: '🇸🇪',
  BEL: '🇧🇪', EGY: '🇪🇬', IRN: '🇮🇷', NZL: '🇳🇿',
  ESP: '🇪🇸', CPV: '🇨🇻', KSA: '🇸🇦', URU: '🇺🇾',
  FRA: '🇫🇷', SEN: '🇸🇳', NOR: '🇳🇴', IRQ: '🇮🇶',
  ARG: '🇦🇷', ALG: '🇩🇿', AUT: '🇦🇹', JOR: '🇯🇴',
  POR: '🇵🇹', UZB: '🇺🇿', COL: '🇨🇴', COD: '🇨🇩',
  ENG: '🏴', CRO: '🇭🇷', GHA: '🇬🇭', PAN: '🇵🇦',
};

const PREDICTION_LOCK_LEAD_MS = 5 * 60_000;
const AVATAR_COLORS = ['#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f59e0b', '#10b981', '#06b6d4', '#3b82f6'];

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function replaceIfChanged(setter, nextValue) {
  setter((currentValue) => (sameJson(currentValue, nextValue) ? currentValue : nextValue));
}

function teamById(teams, id) {
  return teams.find((t) => t.id === id);
}

function predictionLockTime(match) {
  const startsAtMs = new Date(match?.startsAt).getTime();
  const lockAtMs = match?.lockAt ? new Date(match.lockAt).getTime() : Number.POSITIVE_INFINITY;
  const fiveMinutesBeforeStart = Number.isNaN(startsAtMs)
    ? Number.POSITIVE_INFINITY
    : startsAtMs - PREDICTION_LOCK_LEAD_MS;

  return Math.min(lockAtMs, fiveMinutesBeforeStart);
}

function isMatchLocked(match, nowMs = Date.now()) {
  return predictionLockTime(match) <= nowMs;
}

function matchElapsedMs(match, nowMs = Date.now()) {
  const startsAtMs = new Date(match?.startsAt).getTime();
  if (Number.isNaN(startsAtMs)) return Number.POSITIVE_INFINITY;
  return nowMs - startsAtMs;
}

function hasKnownScore(match) {
  return match?.homeGoals != null && match?.awayGoals != null;
}

function isLikelyLive(match, nowMs = Date.now()) {
  if (match?.status === 'live') return true;
  if (match?.status === 'finished' || match?.status === 'cancelled') return false;
  const elapsed = matchElapsedMs(match, nowMs);
  if (elapsed < 0 || elapsed > 3 * 3600_000) return false;
  return hasKnownScore(match);
}

function getUrgency(match, nowMs = Date.now()) {
  if (isLikelyLive(match, nowMs)) return 'live';
  if (match.status === 'finished' || match.status === 'cancelled') return 'done';
  const lock = predictionLockTime(match);
  const diff = lock - nowMs;
  if (diff <= 0) return 'locked';
  if (diff < 6 * 3600_000) return 'urgent';
  if (diff < 24 * 3600_000) return 'warning';
  return 'normal';
}

function isHalftime(match) {
  const status = String(match?.externalStatusShort ?? match?.externalRawStatus ?? '').toUpperCase();
  return isLikelyLive(match) && ['HT', 'HALFTIME', 'HALF_TIME', 'PAUSED', 'INTERVAL'].includes(status);
}

function formatCountdown(match, nowMs = Date.now()) {
  const lock = predictionLockTime(match);
  const diff = lock - nowMs;
  if (diff <= 0) return null;
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  if (h < 1) return `${m}min`;
  if (h < 24) return `${h}h${m > 0 ? ` ${m}min` : ''}`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

function formatMatchTime(value) {
  return new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatLocalDateKey(value) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value));
}

function avatarColor(id = '') {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = id.charCodeAt(i) + ((h << 5) - h);
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

function MatchStatusBadge({ match }) {
  if (isHalftime(match)) return <span className="statusBadge halftime">Intervalo</span>;
  if (isLikelyLive(match)) return <span className="statusBadge live">● Ao vivo</span>;
  if (match.status === 'finished') return <span className="statusBadge finished">Encerrado</span>;
  if (match.status === 'cancelled') return <span className="statusBadge cancelled">Cancelado</span>;
  if (isMatchLocked(match)) return <span className="statusBadge locked">Fechado</span>;
  return <span className="statusBadge scheduled">Agendado</span>;
}

function isLeaderboardTie(a, b) {
  return (a?.points ?? 0) === (b?.points ?? 0)
    && (a?.exactCount ?? 0) === (b?.exactCount ?? 0);
}

function getDenseLeaderboardRank(leaderboard, index) {
  let rank = 1;
  for (let i = 1; i <= index; i++) {
    if (!isLeaderboardTie(leaderboard[i], leaderboard[i - 1])) rank++;
  }
  return rank;
}

function RankPosition({ rank }) {
  if (rank === 1) return <span className="rankPos gold">1</span>;
  if (rank === 2) return <span className="rankPos silver">2</span>;
  if (rank === 3) return <span className="rankPos bronze">3</span>;
  return <span className="rankPos">{rank}</span>;
}

function isBotLeaderboardRow(row) {
  const values = [row?.userId, row?.username, row?.name, row?.email]
    .filter(Boolean)
    .map((value) => String(value).trim().toLowerCase());
  return values.some((value) => value === 'gpt'
    || value === 'claude'
    || value === 'mvp-player-gpt'
    || value === 'mvp-player-claude'
    || value === 'gpt@bolao26.local'
    || value === 'claude@bolao26.local');
}

function ScoreOrVs({ match }) {
  const hasScore = match.homeGoals != null && match.awayGoals != null;

  return (
    <div className={`resultScore gameScore${hasScore ? '' : ' noScore'}`}>
      {hasScore ? (
        <>
          <span className="resultNum">{match.homeGoals}</span>
          <span className="resultSep">×</span>
          <span className="resultNum">{match.awayGoals}</span>
        </>
      ) : (
        <span className="vsLabel">VS</span>
      )}
    </div>
  );
}

function MatchPredictionsPanel({ matchId, poolId, token, myUserId, refreshKey }) {
  const [state, setState] = useState({ data: null, loading: true, error: null });

  useEffect(() => {
    let active = true;
    setState({ data: null, loading: true, error: null });
    api(`/pools/${poolId}/matches/${matchId}/predictions`, token)
      .then(({ predictions: matchPredictions }) => {
        if (active) setState({ data: matchPredictions, loading: false, error: null });
      })
      .catch((e) => {
        if (active) setState({ data: null, loading: false, error: e.message });
      });
    return () => {
      active = false;
    };
  }, [matchId, poolId, token, refreshKey]);

  if (state.loading) return <div className="predsLoading">Carregando palpites...</div>;
  if (state.error) return <div className="predsEmpty">Erro ao carregar.</div>;
  if (!state.data?.length) return <div className="predsEmpty">Nenhum palpite registrado.</div>;

  return (
    <ul className="predsList">
      {state.data.map((p) => {
        const cls = p.points === 5 ? 'exact' : p.points > 0 ? 'partial' : 'zero';
        const userName = p.userName ?? 'Usuário';
        return (
          <li key={p.userId} className={`predRow${p.userId === myUserId ? ' me' : ''}`}>
            <div className="predAvatar" style={{ background: avatarColor(p.userId) }}>
              {userName.charAt(0).toUpperCase() || '?'}
            </div>
            <span className="predName">{p.userId === myUserId ? `${userName} (você)` : userName}</span>
            <span className="predScore">{p.homeGoals} × {p.awayGoals}</span>
            <span className={`predPts ${cls}`}>
              {p.points === 5 ? '★ ' : ''}{p.points} pts
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function MatchSpotlightCard({ match, teams, prediction, now, selectedPoolId, token, myUserId, featured = false }) {
  const home = teamById(teams, match.homeTeamId);
  const away = teamById(teams, match.awayTeamId);
  const urgency = getUrgency(match, now);
  const inProgress = isLikelyLive(match, now);
  const canViewMatchPredictions = inProgress && Boolean(selectedPoolId && token);
  const countdown = urgency === 'urgent' || urgency === 'warning'
    ? formatCountdown(match, now)
    : null;

  return (
    <article className={`matchCard gameCard todayGameCard${featured ? ' featuredGame' : ''}${inProgress ? ' liveGame' : ''}${urgency === 'urgent' ? ' urgent' : ''}${urgency === 'warning' ? ' warning' : ''}`}>
      <div className="matchCardHead">
        <div className="matchCardLeft">
          <span className="matchNum">#{match.matchNumber}</span>
          {match.group && <span className="groupBadge">Gr. {match.group}</span>}
        </div>
        <div className="matchCardCenter">
          <MatchStatusBadge match={match} />
        </div>
        <div className="matchCardRight">
          {countdown && (
            <span className={`countdown ${urgency}`}>
              <Clock size={9} /> {countdown}
            </span>
          )}
          <time className="matchTime">{formatMatchTime(match.startsAt)}</time>
        </div>
      </div>

      <div className="matchCardBody">
        <div className="teamBlock">
          <div className="teamFlag">{FLAG_BY_CODE[home?.code] ?? '🏳'}</div>
          <div className="teamCode">{home?.code ?? '???'}</div>
          <div className="teamFullName">{home?.name ?? '—'}</div>
        </div>

        <div className="scoreCenter">
          <ScoreOrVs match={match} />
        </div>

        <div className="teamBlock away">
          <div className="teamFlag">{FLAG_BY_CODE[away?.code] ?? '🏳'}</div>
          <div className="teamCode">{away?.code ?? '???'}</div>
          <div className="teamFullName">{away?.name ?? '—'}</div>
        </div>
      </div>

      <div className="matchCardFoot">
        <span>{match.venue ? `${match.city} · ${match.venue}` : match.city}</span>
        <div className="matchCardFootRight">
          {prediction ? (
            <span className="savedInfo secondaryTip">Seu palpite {prediction.homeGoals} × {prediction.awayGoals}</span>
          ) : (
            <span className="noTip secondaryTip">Sem palpite</span>
          )}
        </div>
      </div>

      {canViewMatchPredictions && (
        <div className="matchPredictionsWrap">
          <div className="todayPredictionsTitle">Palpites dos jogadores</div>
          <MatchPredictionsPanel
            matchId={match.id}
            poolId={selectedPoolId}
            token={token}
            myUserId={myUserId}
            refreshKey={`${match.status}:${match.homeGoals ?? ''}:${match.awayGoals ?? ''}`}
          />
        </div>
      )}
    </article>
  );
}

function RankingPanel({ leaderboard, profileId }) {
  const visibleLeaderboard = leaderboard.filter((row) => !isBotLeaderboardRow(row));

  return (
    <section className="panel todayRankPanel">
      <div className="panelTitle">
        <div className="titleIcon"><Trophy size={13} /></div>
        <h2>Ranking</h2>
      </div>
      {visibleLeaderboard.length ? (
        <>
          <div className="rankHeader">
            <span />
            <span />
            <span className="rankHeaderPts" title="Pontuação total">Pts</span>
            <span className="rankHeaderStat" title="Placares exatos">E</span>
          </div>
          <ol className="leaderboard">
            {visibleLeaderboard.map((row, i) => {
              const rank = getDenseLeaderboardRank(visibleLeaderboard, i);
              return (
                <li key={row.userId} className={row.userId === profileId ? 'me' : ''}>
                  <RankPosition rank={rank} />
                  <span className="rankPlayer">
                    <span className="rankName">{row.name}</span>
                    {row.username && <span className="rankUsername">@{row.username}</span>}
                  </span>
                  <span className="rankPoints">{row.points}</span>
                  <span className="rankStat">{row.exactCount ?? 0}</span>
                </li>
              );
            })}
          </ol>
          <p className="rankLegend">E: placares exatos · desempate por exatos</p>
        </>
      ) : (
        <div className="emptyState">Nenhum palpite ainda.</div>
      )}
    </section>
  );
}

export default function TodayPage() {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [token, setToken] = useState('');
  const [authReady, setAuthReady] = useState(false);
  const [teams, setTeams] = useState([]);
  const [matches, setMatches] = useState([]);
  const [leaderboard, setLeaderboard] = useState([]);
  const [predictions, setPredictions] = useState([]);
  const [selectedPoolId, setSelectedPoolId] = useState('');
  const [theme, setTheme] = useState('dark');
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState('');
  const lastAutoRefreshRef = useRef(0);

  useEffect(() => {
    const saved = localStorage.getItem('theme') || 'dark';
    setTheme(saved);
    document.documentElement.dataset.theme = saved;
  }, []);

  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.dataset.theme = next;
    localStorage.setItem('theme', next);
  }

  const loadPublic = useCallback(async () => {
    const [td, md] = await Promise.all([api('/teams'), api('/matches')]);
    replaceIfChanged(setTeams, td.teams);
    replaceIfChanged(setMatches, md.matches);
  }, []);

  const loadProtected = useCallback(async (nextToken) => {
    const [me, poolData] = await Promise.all([
      api('/me', nextToken),
      api('/pools/active', nextToken),
    ]);
    setProfile(me.user);
    setSelectedPoolId(poolData.pool.id);
    const [rankData, predData] = await Promise.all([
      api(`/pools/${poolData.pool.id}/leaderboard`, nextToken),
      api(`/pools/${poolData.pool.id}/predictions`, nextToken),
    ]);
    replaceIfChanged(setLeaderboard, rankData.leaderboard);
    replaceIfChanged(setPredictions, predData.predictions);
  }, []);

  useEffect(() => {
    loadPublic().catch((err) => setError(err.message));
    let active = true;
    const unsub = onAuthStateChanged(getFirebaseAuth(), async (nextUser) => {
      try {
        if (!active) return;
        if (!nextUser) {
          setUser(null);
          setToken('');
          setProfile(null);
          setLeaderboard([]);
          setPredictions([]);
          setSelectedPoolId('');
          return;
        }
        setUser(nextUser);
        const nextToken = await nextUser.getIdToken();
        if (!active) return;
        setToken(nextToken);
        await loadProtected(nextToken);
      } catch (err) {
        if (active) setError(err.message);
      } finally {
        if (active) setAuthReady(true);
      }
    });
    return () => {
      active = false;
      unsub();
    };
  }, [loadProtected, loadPublic]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const todayMatches = useMemo(() => {
    const today = formatLocalDateKey(now);
    return [...matches]
      .filter((match) => formatLocalDateKey(match.startsAt) === today)
      .sort((a, b) => {
        const urgencyOrder = { live: 0, urgent: 1, warning: 2, normal: 3, locked: 4, done: 5 };
        return (urgencyOrder[getUrgency(a, now)] ?? 9) - (urgencyOrder[getUrgency(b, now)] ?? 9)
          || new Date(a.startsAt) - new Date(b.startsAt);
      });
  }, [matches, now]);

  const liveMatches = useMemo(
    () => todayMatches.filter((match) => isLikelyLive(match, now)),
    [todayMatches, now],
  );

  const otherTodayMatches = useMemo(
    () => todayMatches.filter((match) => !isLikelyLive(match, now)),
    [todayMatches, now],
  );

  const predictionsByMatch = useMemo(() => {
    return Object.fromEntries(predictions.map((prediction) => [prediction.matchId, prediction]));
  }, [predictions]);

  const hasLiveRefreshWindow = todayMatches.some((match) => {
    const urgency = getUrgency(match, now);
    return urgency === 'live' || urgency === 'urgent' || urgency === 'warning';
  });

  useEffect(() => {
    if (!token) return;

    async function refreshVisibleData() {
      if (document.visibilityState !== 'visible') return;
      const intervalMs = hasLiveRefreshWindow ? 60_000 : 5 * 60_000;
      if (Date.now() - lastAutoRefreshRef.current < intervalMs) return;
      lastAutoRefreshRef.current = Date.now();
      try {
        await Promise.all([loadPublic(), loadProtected(token)]);
      } catch (err) {
        setError(err.message);
      }
    }

    const id = setInterval(refreshVisibleData, 30_000);
    const onVisible = () => refreshVisibleData();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [hasLiveRefreshWindow, loadProtected, loadPublic, token]);

  async function handleSignOut() {
    await signOut(getFirebaseAuth());
  }

  if (!authReady) {
    return <main className="shell" aria-busy="true" />;
  }

  return (
    <main className="shell">
      <nav className="topbar">
        <div className="topbarLogo">
          <div className="logo">B</div>
          <div>
            <h1>Bolão STI 2026</h1>
            <p>Copa do Mundo FIFA 2026</p>
          </div>
        </div>
        <div className="topbarActions">
          <Link className="topbarLink" href="/" title="Página principal">
            <Home size={15} />
            <span>Principal</span>
          </Link>
          <button className="themeToggle" onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Modo claro' : 'Modo escuro'}
            title={theme === 'dark' ? 'Modo claro' : 'Modo escuro'}>
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          {user && (
            <button className="btnIcon danger" title="Sair" aria-label="Sair" onClick={handleSignOut}>
              <LogOut size={17} />
            </button>
          )}
        </div>
      </nav>

      {!user ? (
        <div className="authWrap">
          <img src="/hero-banner.png" className="authBanner" alt="" aria-hidden="true" />
          <div className="authCard">
            <div className="authHeader">
              <div className="authLogo">B</div>
              <h2>Bolão 2026</h2>
              <p>Entre para ver jogos do dia e ranking.</p>
            </div>
            <div className="authBody">
              <Link className="btnPrimary" href="/">Entrar na página principal</Link>
            </div>
          </div>
        </div>
      ) : (
        <div className="todayGrid">
          {error && <div className="todayError">{error}</div>}

          <section className="panel todayMatchesPanel">
            <div className="panelTitle">
              <div className="titleIcon"><Radio size={13} /></div>
              <h2>{liveMatches.length ? 'Ao vivo em destaque' : 'Jogos de hoje'}</h2>
            </div>

            {todayMatches.length === 0 ? (
              <div className="emptyState">Nenhum jogo hoje.</div>
            ) : (
              <div className="matchList">
                {liveMatches.length > 0 && liveMatches.map((match) => (
                  <MatchSpotlightCard
                    key={match.id}
                    match={match}
                    teams={teams}
                    prediction={predictionsByMatch[match.id]}
                    now={now}
                    selectedPoolId={selectedPoolId}
                    token={token}
                    myUserId={profile?.id}
                    featured
                  />
                ))}

                {liveMatches.length > 0 && otherTodayMatches.length > 0 && (
                  <div className="dateSep">Também hoje</div>
                )}

                {(liveMatches.length > 0 ? otherTodayMatches : todayMatches).map((match) => (
                  <MatchSpotlightCard
                    key={match.id}
                    match={match}
                    teams={teams}
                    prediction={predictionsByMatch[match.id]}
                    now={now}
                    selectedPoolId={selectedPoolId}
                    token={token}
                    myUserId={profile?.id}
                  />
                ))}
              </div>
            )}
          </section>

          <RankingPanel leaderboard={leaderboard} profileId={profile?.id} />
        </div>
      )}
    </main>
  );
}
