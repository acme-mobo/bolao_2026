'use client';

import {
  AlertTriangle, CalendarDays, Check, CheckCircle, ChevronDown,
  Clock, HelpCircle, LogOut, Moon, Pencil, Save, Shield, Sun,
  Trash2, Trophy, Users, X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  createUserWithEmailAndPassword,
  getFirebaseAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
} from './lib/firebase-client.js';

// ─── API helper ──────────────────────────────────────
async function api(path, token, options = {}) {
  const response = await fetch(`/api${path}`, {
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

// ─── Flag emoji by FIFA code ─────────────────────────
const FLAG_BY_CODE = {
  MEX: '🇲🇽', RSA: '🇿🇦', KOR: '🇰🇷', CZE: '🇨🇿',
  CAN: '🇨🇦', BIH: '🇧🇦', QAT: '🇶🇦', SUI: '🇨🇭',
  BRA: '🇧🇷', MAR: '🇲🇦', HAI: '🇭🇹', SCO: '🏴󠁧󠁢󠁳󠁣󠁴󠁿',
  USA: '🇺🇸', PAR: '🇵🇾', AUS: '🇦🇺', TUR: '🇹🇷',
  GER: '🇩🇪', CUW: '🇨🇼', CIV: '🇨🇮', ECU: '🇪🇨',
  NED: '🇳🇱', JPN: '🇯🇵', TUN: '🇹🇳', SWE: '🇸🇪',
  BEL: '🇧🇪', EGY: '🇪🇬', IRN: '🇮🇷', NZL: '🇳🇿',
  ESP: '🇪🇸', CPV: '🇨🇻', KSA: '🇸🇦', URU: '🇺🇾',
  FRA: '🇫🇷', SEN: '🇸🇳', NOR: '🇳🇴', IRQ: '🇮🇶',
  ARG: '🇦🇷', ALG: '🇩🇿', AUT: '🇦🇹', JOR: '🇯🇴',
  POR: '🇵🇹', UZB: '🇺🇿', COL: '🇨🇴', COD: '🇨🇩',
  ENG: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', CRO: '🇭🇷', GHA: '🇬🇭', PAN: '🇵🇦',
};

// ─── Pure helpers ─────────────────────────────────────
function teamById(teams, id) {
  return teams.find((t) => t.id === id);
}

function isMatchLocked(match) {
  return match.lockAt ? Date.now() >= new Date(match.lockAt).getTime() : false;
}

function getUrgency(match, nowMs = Date.now()) {
  if (match.status === 'live') return 'live';
  if (match.status === 'finished' || match.status === 'cancelled') return 'done';
  const lock = new Date(match.lockAt || match.startsAt).getTime();
  const diff = lock - nowMs;
  if (diff <= 0) return 'locked';
  if (diff < 6 * 3600_000) return 'urgent';
  if (diff < 24 * 3600_000) return 'warning';
  return 'normal';
}

function formatCountdown(match, nowMs = Date.now()) {
  const lock = new Date(match.lockAt || match.startsAt).getTime();
  const diff = lock - nowMs;
  if (diff <= 0) return null;
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  if (h < 1) return `${m}min`;
  if (h < 24) return `${h}h${m > 0 ? ` ${m}min` : ''}`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

function formatMatchDate(value) {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(new Date(value));
}

function formatDayLabel(value) {
  return new Intl.DateTimeFormat('pt-BR', {
    weekday: 'long', day: '2-digit', month: 'long',
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

// ─── Sub-components ───────────────────────────────────
const AVATAR_COLORS = ['#6366f1','#8b5cf6','#ec4899','#f43f5e','#f59e0b','#10b981','#06b6d4','#3b82f6'];
function avatarColor(id = '') {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = id.charCodeAt(i) + ((h << 5) - h);
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

function ScoringRulesModal({ onClose }) {
  const rules = [
    { pts: 25, label: 'Placar exato',              desc: 'Acertou o placar — vale para vitórias e empates', highlight: true },
    { pts: 18, label: 'Vencedor + saldo de gols',  desc: 'Acertou o vencedor e a diferença de gols \n(ex: apostou 3×1, saiu 2×0)' },
    { pts: 15, label: 'Vencedor + gols de um time', desc: 'Acertou o vencedor e os gols de uma das equipes \n(ex: apostou 2×0, saiu 2×1)' },
    { pts: 10, label: 'Só o vencedor / empate',    desc: 'Acertou apenas o resultado — quem vence ou que termina empatado' },
  ];
  return (
    <div className="modalOverlay" role="dialog" aria-modal="true"
      onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modalHead">
          <div className="modalHeadIcon"><Trophy size={20} /></div>
          <h3>Regras de Pontuação</h3>
          <p>Cada jogo vale no máximo 25 pts. Palpites fecham no início da partida.</p>
        </div>
        <div className="modalBody">
          <div className="rulesTable">
            {rules.map((r) => (
              <div key={r.label} className={`ruleRow${r.highlight ? ' highlight' : ''}`}>
                <div className="rulePts">{r.pts}</div>
                <div>
                  <div className="ruleLabel">{r.label}</div>
                  <div className="ruleDesc">{r.desc}</div>
                </div>
              </div>
            ))}
          </div>
          <p className="rulesNote">
            Desempate: mais placares exatos → mais vencedores acertados.
          </p>
        </div>
        <div className="modalFoot">
          <button className="btnPrimary" onClick={onClose}>Entendido</button>
        </div>
      </div>
    </div>
  );
}

function MatchPredictionsPanel({ matchId, poolId, token, myUserId }) {
  const [state, setState] = useState({ data: null, loading: true, error: null });

  useEffect(() => {
    api(`/pools/${poolId}/matches/${matchId}/predictions`, token)
      .then(({ predictions }) => setState({ data: predictions, loading: false, error: null }))
      .catch((e) => setState({ data: null, loading: false, error: e.message }));
  }, [matchId, poolId, token]);

  if (state.loading) return <div className="predsLoading">Carregando palpites…</div>;
  if (state.error)   return <div className="predsEmpty">Erro ao carregar.</div>;
  if (!state.data?.length) return <div className="predsEmpty">Nenhum palpite registrado.</div>;

  return (
    <ul className="predsList">
      {state.data.map((p) => {
        const cls = p.points === 25 ? 'exact' : p.points > 0 ? 'partial' : 'zero';
        return (
          <li key={p.userId} className={`predRow${p.userId === myUserId ? ' me' : ''}`}>
            <div className="predAvatar" style={{ background: avatarColor(p.userId) }}>
              {p.userName[0].toUpperCase()}
            </div>
            <span className="predName">{p.userId === myUserId ? `${p.userName} (você)` : p.userName}</span>
            <span className="predScore">{p.homeGoals} × {p.awayGoals}</span>
            <span className={`predPts ${cls}`}>
              {p.points === 25 ? '⭐ ' : ''}{p.points} pts
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function MatchStatusBadge({ match }) {
  if (match.status === 'live')      return <span className="statusBadge live">● Ao vivo</span>;
  if (match.status === 'finished')  return <span className="statusBadge finished">Encerrado</span>;
  if (match.status === 'cancelled') return <span className="statusBadge cancelled">Cancelado</span>;
  if (isMatchLocked(match))         return <span className="statusBadge locked">Fechado</span>;
  return <span className="statusBadge scheduled">Agendado</span>;
}

function Stepper({ value, onChange, disabled, label }) {
  return (
    <div className="stepper" role="group" aria-label={label}>
      <button type="button" aria-label="Diminuir" disabled={disabled || value <= 0}
        onClick={() => onChange(Math.max(0, Number(value) - 1))}>−</button>
      <span className="stepperVal">{value}</span>
      <button type="button" aria-label="Aumentar" disabled={disabled}
        onClick={() => onChange(Number(value) + 1)}>+</button>
    </div>
  );
}

function RankPosition({ index }) {
  if (index === 0) return <span className="rankPos gold">1</span>;
  if (index === 1) return <span className="rankPos silver">2</span>;
  if (index === 2) return <span className="rankPos bronze">3</span>;
  return <span className="rankPos">{index + 1}</span>;
}

function MatchCard({ match, teams, predictions, predictionDrafts, savedMatches,
  selectedPoolId, token, myUserId, showGroup, urgency, now, variant = 'default',
  onUpdateDraft, onSave, onDeletePrediction }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showPreds, setShowPreds] = useState(false);

  const home = teamById(teams, match.homeTeamId);
  const away = teamById(teams, match.awayTeamId);
  const prediction = predictions.find((p) => p.matchId === match.id);
  const draft = predictionDrafts[match.id] ?? {
    homeGoals: prediction?.homeGoals ?? 0,
    awayGoals: prediction?.awayGoals ?? 0,
  };
  const locked = urgency === 'locked' || urgency === 'done';
  const isFinished = match.status === 'finished';
  const hasScore = match.homeGoals != null && match.awayGoals != null;
  const scoreFirst = variant === 'score';
  const isSaved = savedMatches.has(match.id);
  const countdown = (urgency === 'urgent' || urgency === 'warning')
    ? formatCountdown(match, now) : null;

  function handleDeleteConfirm() {
    onDeletePrediction(match.id);
    setConfirmDelete(false);
  }

  return (
    <article className={`matchCard${scoreFirst ? ' gameCard' : ''}${match.status === 'live' ? ' liveGame' : ''}${locked ? ' locked' : ''}${urgency === 'urgent' ? ' urgent' : ''}${urgency === 'warning' ? ' warning' : ''}`}>
      <div className="matchCardHead">
        <div className="matchCardLeft">
          <span className="matchNum">#{match.matchNumber}</span>
          {showGroup && <span className="groupBadge">Gr. {match.group}</span>}
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
          <time className="matchTime">{formatMatchDate(match.startsAt)}</time>
        </div>
      </div>

      <div className="matchCardBody">
        <div className="teamBlock">
          <div className="teamFlag">{FLAG_BY_CODE[home?.code] ?? '🏳'}</div>
          <div className="teamCode">{home?.code ?? '???'}</div>
          <div className="teamFullName">{home?.name ?? '—'}</div>
        </div>

        <div className="scoreCenter">
          {scoreFirst ? (
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
          ) : (isFinished || match.status === 'live') && hasScore ? (
            <div className="resultScore">
              <span className="resultNum">{match.homeGoals}</span>
              <span className="resultSep">×</span>
              <span className="resultNum">{match.awayGoals}</span>
            </div>
          ) : (
            <div className="scoreInputs">
              <Stepper value={draft.homeGoals}
                onChange={(v) => onUpdateDraft(match.id, 'homeGoals', v)}
                disabled={locked} label={`Gols ${home?.name}`} />
              <span className="scoreSep">×</span>
              <Stepper value={draft.awayGoals}
                onChange={(v) => onUpdateDraft(match.id, 'awayGoals', v)}
                disabled={locked} label={`Gols ${away?.name}`} />
              <button
                className={`btnSave${isSaved ? ' saved' : ''}`}
                disabled={locked || !selectedPoolId}
                onClick={() => onSave(match.id)}
                aria-label="Salvar palpite"
                title="Salvar palpite"
              >
                {isSaved ? <CheckCircle size={15} /> : <Save size={15} />}
              </button>
            </div>
          )}
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
            confirmDelete ? (
              <div className="inlineConfirm">
                <span>Excluir palpite?</span>
                <button className="btnConfirmYes" onClick={handleDeleteConfirm}>Sim</button>
                <button className="btnConfirmNo" onClick={() => setConfirmDelete(false)}>Não</button>
              </div>
            ) : (
              <>
                <span className={`savedInfo${scoreFirst ? ' secondaryTip' : ''}`}>
                  {scoreFirst ? 'Seu palpite ' : ''}{prediction.homeGoals} × {prediction.awayGoals}
                </span>
                {!locked && !scoreFirst && (
                  <button
                    className="btnDeletePred"
                    onClick={() => setConfirmDelete(true)}
                    aria-label="Excluir palpite"
                    title="Excluir palpite"
                  >
                    <Trash2 size={11} />
                  </button>
                )}
              </>
            )
          ) : (
            <span className={`noTip${scoreFirst ? ' secondaryTip' : ''}`}>
              {scoreFirst ? 'Sem palpite' : locked ? 'Sem palpite' : 'Palpite pendente'}
            </span>
          )}
        </div>
      </div>

      {isFinished && (
        <div className="matchPredictionsWrap">
          <button
            className={`btnViewPreds${showPreds ? ' open' : ''}`}
            onClick={() => setShowPreds((v) => !v)}
          >
            <ChevronDown size={13} />
            {showPreds ? 'Ocultar palpites' : 'Ver palpites dos jogadores'}
          </button>
          {showPreds && (
            <MatchPredictionsPanel
              matchId={match.id}
              poolId={selectedPoolId}
              token={token}
              myUserId={myUserId}
            />
          )}
        </div>
      )}
    </article>
  );
}

// ─── Main page ────────────────────────────────────────
export default function HomePage() {
  // Auth
  const [authMode, setAuthMode]   = useState('login');
  const [authForm, setAuthForm]   = useState({ name: '', email: '', password: '' });
  const [user, setUser]           = useState(null);
  const [profile, setProfile]     = useState(null);
  const [token, setToken]         = useState('');

  // Data
  const [groups, setGroups]       = useState([]);
  const [teams, setTeams]         = useState([]);
  const [matches, setMatches]     = useState([]);
  const [activePool, setActivePool]   = useState(null);
  const [selectedPoolId, setSelectedPoolId] = useState('');
  const [leaderboard, setLeaderboard] = useState([]);
  const [predictions, setPredictions] = useState([]);
  const [predictionDrafts, setPredictionDrafts] = useState({});

  // UI state
  const [theme, setTheme]         = useState('dark');
  const [sectionMode, setSectionMode] = useState('predictions'); // predictions | today | results
  const [navMode, setNavMode]     = useState('pending'); // group | date | pending
  const [resultsMode, setResultsMode] = useState('date'); // group | date
  const [matchFilter, setMatchFilter] = useState('all'); // all | pending
  const [editingName, setEditingName]   = useState(false);
  const [nameInput, setNameInput]       = useState('');
  const [toasts, setToasts]             = useState([]);
  const [savedMatches, setSavedMatches] = useState(new Set());
  const [now, setNow]                   = useState(() => Date.now());
  const [deleteAccountModal, setDeleteAccountModal] = useState(false);
  const [deleteConfirmEmail, setDeleteConfirmEmail] = useState('');
  const [scoringModal, setScoringModal] = useState(false);
  const toastIdRef = useRef(0);

  // ─── Theme persistence ──────────────────────────────
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

  // ─── Clock tick for countdowns ──────────────────────
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  // ─── Toast helper ───────────────────────────────────
  function addToast(text, type = 'info') {
    const id = ++toastIdRef.current;
    setToasts((prev) => [...prev, { id, text, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3200);
  }

  // ─── Data loaders ───────────────────────────────────
  async function loadPublic() {
    const [gd, td, md] = await Promise.all([api('/groups'), api('/teams'), api('/matches')]);
    setGroups(gd.groups);
    setTeams(td.teams);
    setMatches(md.matches);
  }

  async function loadProtected(nextToken = token) {
    const [me, poolData] = await Promise.all([
      api('/me', nextToken),
      api('/pools/active', nextToken),
    ]);
    setProfile(me.user);
    setActivePool(poolData.pool);
    setSelectedPoolId(poolData.pool.id);
  }

  useEffect(() => {
    loadPublic().catch((err) => addToast(err.message, 'error'));
    const unsub = onAuthStateChanged(getFirebaseAuth(), async (nextUser) => {
      setUser(nextUser);
      if (!nextUser) {
        setToken(''); setProfile(null); setActivePool(null);
        setSelectedPoolId('');
        setLeaderboard([]); setPredictions([]);
        setPredictionDrafts({});
        return;
      }
      const nextToken = await nextUser.getIdToken();
      setToken(nextToken);
      await loadProtected(nextToken);
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!selectedPoolId || !token) return;
    Promise.all([
      api(`/pools/${selectedPoolId}/leaderboard`, token),
      api(`/pools/${selectedPoolId}/predictions`, token),
    ])
      .then(([rankData, predData]) => {
        setLeaderboard(rankData.leaderboard);
        setPredictions(predData.predictions);
        setPredictionDrafts(() => {
          const drafts = {};
          for (const p of predData.predictions) {
            drafts[p.matchId] = { homeGoals: p.homeGoals, awayGoals: p.awayGoals };
          }
          return drafts;
        });
      })
      .catch((err) => addToast(err.message, 'error'));
  }, [selectedPoolId, token]);

  // ─── Auth handlers ───────────────────────────────────
  async function submitAuth(event) {
    event.preventDefault();
    const auth = getFirebaseAuth();
    try {
      if (authMode === 'signup') {
        const cred = await createUserWithEmailAndPassword(auth, authForm.email, authForm.password);
        if (authForm.name) {
          await updateProfile(cred.user, { displayName: authForm.name });
        }
        // Força refresh do token para incluir o displayName recém-definido.
        // Isso garante que requireFirebaseAuth crie o usuário no DB com o nome
        // correto, e que setToken receba um valor diferente → leaderboard recarrega.
        const signupToken = await cred.user.getIdToken(true);
        if (authForm.name) {
          await api('/me', signupToken, {
            method: 'PATCH',
            body: JSON.stringify({ name: authForm.name }),
          });
        }
        setToken(signupToken);
        await loadProtected(signupToken);
        addToast('Bem-vindo!', 'success');
        return;
      }
      await signInWithEmailAndPassword(auth, authForm.email, authForm.password);
    } catch (err) {
      addToast(err.message, 'error');
    }
  }

  // ─── Profile name edit ──────────────────────────────
  function startEditName() {
    setNameInput(profile?.name ?? user?.displayName ?? '');
    setEditingName(true);
  }

  async function saveDisplayName() {
    const name = nameInput.trim();
    if (name.length < 2) { addToast('Nome precisa ter pelo menos 2 caracteres', 'error'); return; }
    try {
      await updateProfile(getFirebaseAuth().currentUser, { displayName: name });
      const { user: updated } = await api('/me', token, {
        method: 'PATCH',
        body: JSON.stringify({ name }),
      });
      setProfile(updated);
      setLeaderboard((prev) => prev.map((row) =>
        row.userId === updated.id ? { ...row, name } : row,
      ));
      setEditingName(false);
      addToast('Nome atualizado!', 'success');
    } catch (err) {
      addToast(err.message, 'error');
    }
  }

  // ─── Prediction handlers ─────────────────────────────
  function updateDraft(matchId, field, value) {
    setPredictionDrafts((cur) => ({
      ...cur,
      [matchId]: {
        homeGoals: cur[matchId]?.homeGoals ?? 0,
        awayGoals: cur[matchId]?.awayGoals ?? 0,
        [field]: value,
      },
    }));
  }

  async function deletePrediction(matchId) {
    try {
      await api(`/pools/${selectedPoolId}/predictions/${matchId}`, token, { method: 'DELETE' });
      setPredictions((prev) => prev.filter((p) => p.matchId !== matchId));
      addToast('Palpite removido.', 'info');
    } catch (err) {
      addToast(err.message, 'error');
    }
  }

  async function deleteAccount() {
    if (deleteConfirmEmail !== user?.email) return;
    try {
      await api('/me', token, { method: 'DELETE' });
      await signOut(getFirebaseAuth());
      // onAuthStateChanged resets all state and returns to auth screen
    } catch (err) {
      addToast(err.message, 'error');
    }
  }

  async function savePrediction(matchId) {
    const draft = predictionDrafts[matchId] ?? { homeGoals: 0, awayGoals: 0 };
    try {
      await api(`/pools/${selectedPoolId}/predictions`, token, {
        method: 'POST',
        body: JSON.stringify({
          matchId,
          homeGoals: Number(draft.homeGoals),
          awayGoals: Number(draft.awayGoals),
        }),
      });
      const data = await api(`/pools/${selectedPoolId}/predictions`, token);
      setPredictions(data.predictions);
      setSavedMatches((prev) => new Set([...prev, matchId]));
      setTimeout(() => setSavedMatches((prev) => {
        const n = new Set(prev); n.delete(matchId); return n;
      }), 2000);
      addToast('Palpite salvo!', 'success');
    } catch (err) {
      addToast(err.message, 'error');
    }
  }

  // ─── Derived data ────────────────────────────────────
  const myPoints = leaderboard.find((r) => r.userId === profile?.id)?.points ?? 0;

  const pendingMatches = useMemo(() => {
    return [...matches]
      .filter((m) => {
        if (m.status === 'finished' || m.status === 'cancelled') return false;
        if (isMatchLocked(m)) return false;
        return !predictions.some((p) => p.matchId === m.id);
      })
      .sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
  }, [matches, predictions]);

  function isPendingMatch(m) {
    return m.status !== 'finished'
      && m.status !== 'cancelled'
      && !isMatchLocked(m)
      && !predictions.some((p) => p.matchId === m.id);
  }

  const upcomingByDate = useMemo(() => {
    const upcoming = [...matches]
      .filter((m) => m.status !== 'finished' && m.status !== 'cancelled')
      .sort((a, b) => {
        const urgencyOrder = { live: 0, urgent: 1, warning: 2, normal: 3, locked: 4, done: 5 };
        return (urgencyOrder[getUrgency(a, now)] ?? 9) - (urgencyOrder[getUrgency(b, now)] ?? 9)
          || new Date(a.startsAt) - new Date(b.startsAt);
      });

    const grouped = [];
    const seen = {};
    for (const m of upcoming) {
      const key = formatDayLabel(m.startsAt);
      if (!seen[key]) { seen[key] = true; grouped.push({ date: key, matches: [] }); }
      grouped[grouped.length - 1].matches.push(m);
    }
    return grouped;
  }, [matches, now]);

  const todayMatches = useMemo(() => {
    const today = formatLocalDateKey(now);

    return [...matches]
      .filter((m) => formatLocalDateKey(m.startsAt) === today)
      .sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
  }, [matches, now]);

  const prioritizedTodayMatches = useMemo(() => {
    const urgencyOrder = { live: 0, urgent: 1, warning: 2, normal: 3, locked: 4, done: 5 };
    return [...todayMatches].sort((a, b) => {
      return (urgencyOrder[getUrgency(a, now)] ?? 9) - (urgencyOrder[getUrgency(b, now)] ?? 9)
        || new Date(a.startsAt) - new Date(b.startsAt);
    });
  }, [todayMatches, now]);

  const resultsMatches = useMemo(() => {
    const statusOrder = { live: 0, finished: 1 };
    return [...matches]
      .filter((m) => m.status === 'live' || m.status === 'finished')
      .sort((a, b) => {
        return (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9)
          || new Date(b.startsAt) - new Date(a.startsAt);
      });
  }, [matches]);

  const resultsByDate = useMemo(() => {
    const grouped = [];
    const seen = {};
    for (const m of resultsMatches) {
      const key = formatDayLabel(m.startsAt);
      if (!seen[key]) { seen[key] = true; grouped.push({ date: key, matches: [] }); }
      grouped[grouped.length - 1].matches.push(m);
    }
    return grouped;
  }, [resultsMatches]);

  // Shared match card props
  const matchCardShared = {
    teams, predictions, predictionDrafts, savedMatches,
    selectedPoolId, token, myUserId: profile?.id,
    now,
    onUpdateDraft: updateDraft,
    onSave: savePrediction,
    onDeletePrediction: deletePrediction,
  };

  // ─── Render ──────────────────────────────────────────
  return (
    <main className="shell">
      {/* Toasts */}
      <div className="toastWrap" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.type}`}>{t.text}</div>
        ))}
      </div>

      {/* Topbar */}
      <nav className="topbar">
        <div className="topbarLogo">
          <div className="logo">B</div>
          <div>
            <h1>Bolão STI 2026</h1>
            <p>Copa do Mundo FIFA 2026</p>
          </div>
        </div>
        <div className="topbarActions">
          <button className="themeToggle" onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Modo claro' : 'Modo escuro'}
            title={theme === 'dark' ? 'Modo claro' : 'Modo escuro'}>
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>
      </nav>

      {/* Auth */}
      {!user ? (
        <div className="authWrap">
          <img src="/hero-banner.png" className="authBanner" alt="" aria-hidden="true" />
          <div className="authCard">
            <div className="authHeader">
              <div className="authLogo">B</div>
              <h2>Bolão STI 2026</h2>
              <p>Copa do Mundo FIFA 2026</p>
            </div>
            <div className="authBody">
              <div className="segmented">
                <button className={authMode === 'login' ? 'active' : ''}
                  onClick={() => setAuthMode('login')}>Entrar</button>
                <button className={authMode === 'signup' ? 'active' : ''}
                  onClick={() => setAuthMode('signup')}>Criar conta</button>
              </div>
              <form onSubmit={submitAuth} className="formGrid">
                {authMode === 'signup' && (
                  <div className="inputGroup">
                    <label htmlFor="auth-name">Nome</label>
                    <input id="auth-name" value={authForm.name}
                      onChange={(e) => setAuthForm({ ...authForm, name: e.target.value })}
                      placeholder="Seu nome" autoComplete="name" />
                  </div>
                )}
                <div className="inputGroup">
                  <label htmlFor="auth-email">E-mail</label>
                  <input id="auth-email" type="email" value={authForm.email}
                    onChange={(e) => setAuthForm({ ...authForm, email: e.target.value })}
                    placeholder="email@dominio.com" autoComplete="email" required />
                </div>
                <div className="inputGroup">
                  <label htmlFor="auth-password">Senha</label>
                  <input id="auth-password" type="password" value={authForm.password}
                    onChange={(e) => setAuthForm({ ...authForm, password: e.target.value })}
                    placeholder={authMode === 'signup' ? 'Mínimo 8 caracteres' : '••••••••'}
                    autoComplete={authMode === 'signup' ? 'new-password' : 'current-password'}
                    required />
                </div>
                <button type="submit" className="btnPrimary">
                  {authMode === 'signup' ? 'Criar conta' : 'Entrar'}
                </button>
              </form>
            </div>
          </div>
        </div>
      ) : (
        <div className="dashGrid">

          {/* ── Hero ─────────────────────────────────── */}
          <section className="heroPanel">
            <div>
              <div className="heroMeta">
                <span className="badge active">Bolão ativo</span>
                {activePool?.inviteCode && (
                  <span className="badge inviteCode">#{activePool.inviteCode}</span>
                )}
              </div>
              <h2>{activePool?.name ?? 'Carregando…'}</h2>
              <p className="heroSub">Copa do Mundo FIFA 2026 · fase de grupos</p>
            </div>
            <img src="/hero-banner.png" className="heroBanner" alt="" aria-hidden="true" />
            <div className="heroActions">
              <button className="btnIcon danger" title="Sair"
                aria-label="Sair" onClick={() => signOut(getFirebaseAuth())}>
                <LogOut size={17} />
              </button>
            </div>
          </section>

          {/* ── Metric: Jogador ──────────────────────── */}
          <section className="metricPanel">
            <div className="metricHeader">
              <span className="metricLabel">Jogador</span>
              <div className="metricIcon"><Shield size={15} /></div>
            </div>
            {editingName ? (
              <div className="editNameRow">
                <input
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveDisplayName();
                    if (e.key === 'Escape') setEditingName(false);
                  }}
                  placeholder="Seu nome"
                  autoFocus
                />
                <button className="editNameBtn save" onClick={saveDisplayName} title="Salvar">
                  <Check size={13} />
                </button>
                <button className="editNameBtn cancel" onClick={() => setEditingName(false)} title="Cancelar">
                  <X size={13} />
                </button>
              </div>
            ) : (
              <div className="profileNameRow">
                <span className="profileNameText">
                  {profile?.name ?? user.displayName ?? user.email}
                </span>
                <button className="editBtn" onClick={startEditName} title="Editar nome">
                  <Pencil size={12} />
                </button>
              </div>
            )}
            <div className="metricSub">
              {profile?.role ?? 'player'}
              {' · '}
              <button
                className="dangerLink"
                onClick={() => { setDeleteConfirmEmail(''); setDeleteAccountModal(true); }}
                title="Excluir conta permanentemente"
              >
                excluir conta
              </button>
            </div>
          </section>

          {/* ── Metric: Pontos ───────────────────────── */}
          <section className="metricPanel">
            <div className="metricHeader">
              <span className="metricLabel">Pontos</span>
              <div className="metricIcon"><Trophy size={15} /></div>
            </div>
            <div className="metricValue">{myPoints}</div>
            <div className="metricSub">total acumulado</div>
          </section>

          {/* ── Metric: Pendentes (clickable) ────────── */}
          <section
            className={`metricPanel clickable`}
            onClick={() => { setSectionMode('predictions'); setNavMode('pending'); }}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                setSectionMode('predictions');
                setNavMode('pending');
              }
            }}
            title="Ver palpites pendentes"
          >
            <div className="metricHeader">
              <span className="metricLabel">Pendentes</span>
              <div className={`metricIcon${pendingMatches.length > 0 ? ' danger' : ''}`}>
                <CalendarDays size={15} />
              </div>
            </div>
            <div className={`metricValue${pendingMatches.length > 0 ? ' danger' : ''}`}>
              {pendingMatches.length}
            </div>
            <div className="metricSub">
              {pendingMatches.length === 0
                ? 'tudo em dia!'
                : `jogo${pendingMatches.length > 1 ? 's' : ''} sem palpite`}
            </div>
          </section>

          {/* ── Main: Palpites ───────────────────────── */}
          <section className="panel mainPanel">
            <div className="panelTitle">
              <div className="titleIcon"><CalendarDays size={13} /></div>
              <h2>{sectionMode === 'today' ? 'Jogos de hoje' : sectionMode === 'results' ? 'Resultados' : 'Palpites'}</h2>
            </div>

            {/* Section tabs */}
            <div className="navTabs" role="tablist">
              <button role="tab" aria-selected={sectionMode === 'predictions'}
                className={sectionMode === 'predictions' ? 'active' : ''}
                onClick={() => setSectionMode('predictions')}>
                Palpites
                {pendingMatches.length > 0 && (
                  <span className="countBadge">{pendingMatches.length}</span>
                )}
              </button>
              <button role="tab" aria-selected={sectionMode === 'today'}
                className={sectionMode === 'today' ? 'active' : ''}
                onClick={() => setSectionMode('today')}>
                Hoje
                {prioritizedTodayMatches.length > 0 && (
                  <span className="countBadge neutral">{prioritizedTodayMatches.length}</span>
                )}
              </button>
              <button role="tab" aria-selected={sectionMode === 'results'}
                className={sectionMode === 'results' ? 'active' : ''}
                onClick={() => setSectionMode('results')}>
                Resultados
              </button>
            </div>

            {/* Prediction mode tabs */}
            {sectionMode === 'predictions' && (
              <div className="subFilterBar sectionSubTabs" role="tablist">
                <button role="tab" aria-selected={navMode === 'group'}
                  className={navMode === 'group' ? 'active' : ''}
                  onClick={() => setNavMode('group')}>
                Por Grupo
                </button>
                <button role="tab" aria-selected={navMode === 'date'}
                  className={navMode === 'date' ? 'active' : ''}
                  onClick={() => setNavMode('date')}>
                Por Data
                </button>
                <button role="tab" aria-selected={navMode === 'pending'}
                  className={navMode === 'pending' ? 'active' : ''}
                  onClick={() => setNavMode('pending')}>
                Pendentes
                  {pendingMatches.length > 0 && (
                    <span className="countBadge">{pendingMatches.length}</span>
                  )}
                </button>
              </div>
            )}

            {/* Sub-filter: Todos / Pendentes (only for group and date views) */}
            {sectionMode === 'predictions' && (navMode === 'group' || navMode === 'date') && (
              <div className="subFilterBar">
                <button
                  className={matchFilter === 'all' ? 'active' : ''}
                  onClick={() => setMatchFilter('all')}>
                  Todos
                </button>
                <button
                  className={matchFilter === 'pending' ? 'active' : ''}
                  onClick={() => setMatchFilter('pending')}>
                  Pendentes
                  {pendingMatches.length > 0 && (
                    <span className="countBadge">{pendingMatches.length}</span>
                  )}
                </button>
              </div>
            )}

            {/* ── Por Grupo ─────────────────────────── */}
            {sectionMode === 'predictions' && navMode === 'group' && (
              <div className="matchList">
                {groups.length === 0
                  ? <div className="emptyState">Nenhum jogo disponível.</div>
                  : groups.map(({ group }) => {
                      const gMatches = matches
                        .filter((m) => m.group === group)
                        .filter((m) => matchFilter === 'all' || isPendingMatch(m))
                        .sort((a, b) => (a.matchNumber ?? 0) - (b.matchNumber ?? 0));
                      if (gMatches.length === 0) return null;
                      return (
                        <div key={group}>
                          <div className="dateSep">Grupo {group}</div>
                          {gMatches.map((m) => (
                            <MatchCard key={m.id} match={m}
                              urgency={getUrgency(m, now)}
                              showGroup={false}
                              {...matchCardShared} />
                          ))}
                        </div>
                      );
                    })}
              </div>
            )}

            {/* ── Por Data ──────────────────────────── */}
            {sectionMode === 'predictions' && navMode === 'date' && (
              <div className="matchList">
                {upcomingByDate.length === 0
                  ? <div className="emptyState">Sem jogos agendados.</div>
                  : upcomingByDate.map(({ date, matches: dm }) => {
                      const filtered = matchFilter === 'all'
                        ? dm
                        : dm.filter((m) => isPendingMatch(m));
                      if (filtered.length === 0) return null;
                      return (
                        <div key={date}>
                          <div className="dateSep">{date}</div>
                          {filtered.map((m) => (
                            <MatchCard key={m.id} match={m}
                              urgency={getUrgency(m, now)}
                              showGroup
                              {...matchCardShared} />
                          ))}
                        </div>
                      );
                    })}
              </div>
            )}

            {/* ── Pendentes ─────────────────────────── */}
            {sectionMode === 'predictions' && navMode === 'pending' && (
              <div className="matchList">
                {pendingMatches.length === 0 ? (
                  <div className="allDoneState">
                    <div className="allDoneIcon">
                      <CheckCircle size={24} />
                    </div>
                    <div className="allDoneTitle">Tudo em dia!</div>
                    <div className="allDoneSub">Você fez palpite em todos os jogos disponíveis.</div>
                  </div>
                ) : pendingMatches.map((m) => (
                  <MatchCard key={m.id} match={m}
                    urgency={getUrgency(m, now)}
                    showGroup
                    {...matchCardShared} />
                ))}
              </div>
            )}

            {/* ── Hoje ──────────────────────────────── */}
            {sectionMode === 'today' && (
              <div className="matchList">
                {prioritizedTodayMatches.length === 0
                  ? <div className="emptyState">Nenhum jogo hoje.</div>
                  : prioritizedTodayMatches.map((m) => (
                      <MatchCard key={m.id} match={m}
                        urgency={getUrgency(m, now)}
                        showGroup
                        variant="score"
                        {...matchCardShared} />
                    ))}
              </div>
            )}

            {/* ── Resultados ────────────────────────── */}
            {sectionMode === 'results' && (
              <>
                <div className="subFilterBar sectionSubTabs" role="tablist">
                  <button role="tab" aria-selected={resultsMode === 'group'}
                    className={resultsMode === 'group' ? 'active' : ''}
                    onClick={() => setResultsMode('group')}>
                    Por Grupo
                  </button>
                  <button role="tab" aria-selected={resultsMode === 'date'}
                    className={resultsMode === 'date' ? 'active' : ''}
                    onClick={() => setResultsMode('date')}>
                    Por Data
                  </button>
                </div>

                <div className="matchList">
                  {resultsMatches.length === 0 ? (
                    <div className="emptyState">Nenhum jogo em andamento ou encerrado ainda.</div>
                  ) : resultsMode === 'group' ? (
                    groups.map(({ group }) => {
                      const gMatches = resultsMatches
                        .filter((m) => m.group === group)
                        .sort((a, b) => (a.matchNumber ?? 0) - (b.matchNumber ?? 0));
                      if (gMatches.length === 0) return null;
                      return (
                        <div key={group}>
                          <div className="dateSep">Grupo {group}</div>
                          {gMatches.map((m) => (
                            <MatchCard key={m.id} match={m}
                              urgency={getUrgency(m, now)}
                              showGroup={false}
                              variant="score"
                              {...matchCardShared} />
                          ))}
                        </div>
                      );
                    })
                  ) : (
                    resultsByDate.map(({ date, matches: dm }) => (
                      <div key={date}>
                        <div className="dateSep">{date}</div>
                        {dm.map((m) => (
                          <MatchCard key={m.id} match={m}
                            urgency={getUrgency(m, now)}
                            showGroup
                            variant="score"
                            {...matchCardShared} />
                        ))}
                      </div>
                    ))
                  )}
                </div>
              </>
            )}
          </section>

          {/* ── Side: Ranking ────────────────────────── */}
          <section className="panel sidePanel">
            <div className="panelTitle">
              <div className="titleIcon"><Trophy size={13} /></div>
              <h2>Ranking</h2>
              <button className="btnRules" onClick={() => setScoringModal(true)}
                title="Regras de pontuação" aria-label="Regras de pontuação">
                <HelpCircle size={14} />
              </button>
            </div>
            {leaderboard.length ? (
              <>
                <div className="rankHeader">
                  <span />{/* posição */}
                  <span />{/* nome */}
                  <span className="rankHeaderPts" title="Pontuação total">Pts</span>
                  <span className="rankHeaderStat" title="Placares exatos">E</span>
                  <span className="rankHeaderStat" title="Vencedores acertados">V</span>
                </div>
                <ol className="leaderboard">
                  {leaderboard.map((row, i) => (
                    <li key={row.userId} className={row.userId === profile?.id ? 'me' : ''}>
                      <RankPosition index={i} />
                      <span className="rankName">{row.name}</span>
                      <span className="rankPoints">{row.points}</span>
                      <span className="rankStat">{row.exactCount ?? 0}</span>
                      <span className="rankStat">{row.correctOutcomeCount ?? 0}</span>
                    </li>
                  ))}
                </ol>
                <p className="rankLegend">E: placares exatos · V: vencedores acertados</p>
              </>
            ) : (
              <div className="emptyState">Nenhum palpite ainda.</div>
            )}
          </section>

          {/* ── Full-width: Grupos ───────────────────── */}
          <section className="panel groupsPanel">
            <div className="panelTitle">
              <div className="titleIcon"><Users size={13} /></div>
              <h2>Grupos</h2>
            </div>
            <div className="groupsGrid">
              {groups.map((g) => (
                <div key={g.group} className="groupBox">
                  <div className="groupBoxHead">Grupo {g.group}</div>
                  {g.teams.map((team) => (
                    <div key={team.id} className="groupTeam">
                      <span className="groupTeamCode">{team.code}</span>
                      <span className="groupTeamName">{team.name}</span>
                    </div>
                  ))}
                </div>
              ))}
              {groups.length === 0 && (
                <div className="emptyState">Carregando grupos…</div>
              )}
            </div>
          </section>

        </div>
      )}
      {/* ── Scoring rules modal ──────────────────── */}
      {scoringModal && <ScoringRulesModal onClose={() => setScoringModal(false)} />}

      {/* ── Delete account modal ─────────────────── */}
      {deleteAccountModal && (
        <div
          className="modalOverlay"
          onClick={(e) => e.target === e.currentTarget && setDeleteAccountModal(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-title"
        >
          <div className="modal">
            <div className="modalHead">
              <div className="modalHeadIcon">
                <AlertTriangle size={20} />
              </div>
              <h3 id="modal-title">Excluir conta</h3>
              <p>
                Todos os seus dados serão removidos permanentemente —
                palpites, histórico e perfil. Essa ação não pode ser desfeita.
              </p>
            </div>
            <div className="modalBody">
              <label htmlFor="delete-confirm-email">
                Digite seu e-mail para confirmar
              </label>
              <input
                id="delete-confirm-email"
                type="email"
                value={deleteConfirmEmail}
                onChange={(e) => setDeleteConfirmEmail(e.target.value)}
                placeholder={user?.email}
                autoComplete="off"
                autoFocus
              />
            </div>
            <div className="modalFoot">
              <button
                className="btnGhost"
                onClick={() => setDeleteAccountModal(false)}
              >
                Cancelar
              </button>
              <button
                className="btnDanger"
                disabled={deleteConfirmEmail !== user?.email}
                onClick={deleteAccount}
              >
                <Trash2 size={14} /> Excluir conta
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
