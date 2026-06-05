'use client';

import {
  AlertTriangle, CalendarDays, Check, CheckCircle, Clock,
  LogOut, Moon, Pencil, Save, Shield, Sun, Trash2, Trophy, Users, X,
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

// ─── Sub-components ───────────────────────────────────
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
  selectedPoolId, showGroup, urgency, now, onUpdateDraft, onSave, onDeletePrediction }) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  const home = teamById(teams, match.homeTeamId);
  const away = teamById(teams, match.awayTeamId);
  const prediction = predictions.find((p) => p.matchId === match.id);
  const draft = predictionDrafts[match.id] ?? {
    homeGoals: prediction?.homeGoals ?? 0,
    awayGoals: prediction?.awayGoals ?? 0,
  };
  const locked = urgency === 'locked' || urgency === 'done';
  const isFinished = match.status === 'finished';
  const isSaved = savedMatches.has(match.id);
  const countdown = (urgency === 'urgent' || urgency === 'warning')
    ? formatCountdown(match, now) : null;

  function handleDeleteConfirm() {
    onDeletePrediction(match.id);
    setConfirmDelete(false);
  }

  return (
    <article className={`matchCard${locked ? ' locked' : ''}${urgency === 'urgent' ? ' urgent' : ''}${urgency === 'warning' ? ' warning' : ''}`}>
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
          {isFinished && match.homeGoals != null ? (
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
                <span className="savedInfo">
                  {prediction.homeGoals} × {prediction.awayGoals}
                </span>
                {!locked && (
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
            <span className="noTip">{locked ? 'Sem palpite' : 'Palpite pendente'}</span>
          )}
        </div>
      </div>
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
  const [navMode, setNavMode]     = useState('pending'); // group | date | pending | results
  const [matchFilter, setMatchFilter] = useState('all'); // all | pending
  const [editingName, setEditingName]   = useState(false);
  const [nameInput, setNameInput]       = useState('');
  const [toasts, setToasts]             = useState([]);
  const [savedMatches, setSavedMatches] = useState(new Set());
  const [now, setNow]                   = useState(() => Date.now());
  const [deleteAccountModal, setDeleteAccountModal] = useState(false);
  const [deleteConfirmEmail, setDeleteConfirmEmail] = useState('');
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
        setLeaderboard([]); setPredictions([]);
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
        setPredictionDrafts((cur) => {
          const next = { ...cur };
          for (const p of predData.predictions) {
            next[p.matchId] = { homeGoals: p.homeGoals, awayGoals: p.awayGoals };
          }
          return next;
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
        // Grab token before onAuthStateChanged has a chance to run loadProtected
        // with a token that doesn't yet carry the displayName claim.
        const signupToken = await cred.user.getIdToken();
        if (authForm.name) {
          await updateProfile(cred.user, { displayName: authForm.name });
          // Write the name to our DB via PATCH /me (decoded.name in the token
          // is still empty at this point, so we pass the name explicitly).
          await api('/me', signupToken, {
            method: 'PATCH',
            body: JSON.stringify({ name: authForm.name }),
          });
        }
        // Reload profile so the UI shows the correct name immediately.
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
      // Update Firebase Auth displayName and our DB atomically.
      await updateProfile(getFirebaseAuth().currentUser, { displayName: name });
      const { user: updated } = await api('/me', token, {
        method: 'PATCH',
        body: JSON.stringify({ name }),
      });
      setProfile(updated);
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
      .sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));

    const groups = [];
    const seen = {};
    for (const m of upcoming) {
      const key = formatDayLabel(m.startsAt);
      if (!seen[key]) { seen[key] = true; groups.push({ date: key, matches: [] }); }
      groups[groups.length - 1].matches.push(m);
    }
    return groups;
  }, [matches]);

  const resultsMatches = useMemo(() => {
    return [...matches]
      .filter((m) => m.status === 'finished')
      .sort((a, b) => new Date(b.startsAt) - new Date(a.startsAt));
  }, [matches]);

  // Shared match card props
  const matchCardShared = {
    teams, predictions, predictionDrafts, savedMatches,
    selectedPoolId, now,
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
            onClick={() => setNavMode('pending')}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && setNavMode('pending')}
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
              <h2>Palpites</h2>
            </div>

            {/* Nav mode tabs */}
            <div className="navTabs" role="tablist">
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
              <button role="tab" aria-selected={navMode === 'results'}
                className={navMode === 'results' ? 'active' : ''}
                onClick={() => setNavMode('results')}>
                Resultados
              </button>
            </div>

            {/* Sub-filter: Todos / Pendentes (only for group and date views) */}
            {(navMode === 'group' || navMode === 'date') && (
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
            {navMode === 'group' && (
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
            {navMode === 'date' && (
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
            {navMode === 'pending' && (
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

            {/* ── Resultados ────────────────────────── */}
            {navMode === 'results' && (
              <div className="matchList">
                {resultsMatches.length === 0
                  ? <div className="emptyState">Nenhum jogo encerrado ainda.</div>
                  : resultsMatches.map((m) => (
                      <MatchCard key={m.id} match={m}
                        urgency="done"
                        showGroup
                        {...matchCardShared} />
                    ))}
              </div>
            )}
          </section>

          {/* ── Side: Ranking ────────────────────────── */}
          <section className="panel sidePanel">
            <div className="panelTitle">
              <div className="titleIcon"><Trophy size={13} /></div>
              <h2>Ranking</h2>
            </div>
            <ol className="leaderboard">
              {leaderboard.length ? (
                leaderboard.map((row, i) => (
                  <li key={row.userId} className={row.userId === profile?.id ? 'me' : ''}>
                    <RankPosition index={i} />
                    <span className="rankName">{row.name}</span>
                    <span className="rankPoints">{row.points}</span>
                  </li>
                ))
              ) : (
                <div className="emptyState">Nenhum palpite ainda.</div>
              )}
            </ol>
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
