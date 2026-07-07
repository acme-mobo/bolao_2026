'use client';

import Link from 'next/link';
import {
  CheckCircle, Home, LogOut, Moon, RefreshCw, Save, Search, ShieldAlert, Sun,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  getFirebaseAuth,
  onAuthStateChanged,
  signOut,
} from '../../lib/firebase-client.js';

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

const STATUS_OPTIONS = [
  ['scheduled', 'Agendado'],
  ['live', 'Ao vivo'],
  ['finished', 'Encerrado'],
  ['cancelled', 'Cancelado'],
];

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function replaceIfChanged(setter, nextValue) {
  setter((currentValue) => (sameJson(currentValue, nextValue) ? currentValue : nextValue));
}

function teamById(teams, id) {
  return teams.find((team) => team.id === id);
}

function formatMatchDate(value) {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function MatchStatusBadge({ status }) {
  if (status === 'live') return <span className="statusBadge live">● Ao vivo</span>;
  if (status === 'finished') return <span className="statusBadge finished">Encerrado</span>;
  if (status === 'cancelled') return <span className="statusBadge cancelled">Cancelado</span>;
  return <span className="statusBadge scheduled">Agendado</span>;
}

function draftFromMatch(match) {
  return {
    status: match.status ?? 'scheduled',
    homeGoals: match.homeGoals ?? '',
    awayGoals: match.awayGoals ?? '',
  };
}

function formatSyncResult(sync) {
  if (!sync) return 'Sync concluído. Jogos atualizados.';
  const changedOps = (sync.ran ?? []).filter((op) => Number(op.changes) > 0);
  const parts = [];

  if (changedOps.length > 0) {
    const changes = changedOps.reduce((total, op) => total + Number(op.changes ?? 0), 0);
    parts.push(`Sync concluído: ${changes} jogo(s) atualizado(s).`);
  } else if (Array.isArray(sync.ran) && sync.ran.length > 0) {
    parts.push('Sync concluído: nenhum placar mudou.');
  } else if (sync.status) {
    parts.push(`Sync ${sync.status}.`);
  } else {
    parts.push('Sync concluído.');
  }

  if (Array.isArray(sync.errors) && sync.errors.length > 0) {
    const firstError = sync.errors[0];
    parts.push(`Erro em ${firstError.op ?? 'operação'}: ${firstError.error ?? 'sem detalhe'}`);
  } else if (Array.isArray(sync.skipped) && sync.skipped.length > 0 && !sync.ran?.length) {
    const firstSkipped = sync.skipped[0];
    parts.push(`Ignorado: ${firstSkipped.reason ?? 'sem detalhe'}`);
  } else if (sync.summary && typeof sync.summary === 'object') {
    const { ok = 0, skipped = 0, errors = 0, total = 0 } = sync.summary;
    parts.push(`${ok}/${total} operações OK, ${skipped} ignoradas, ${errors} com erro`);
  }

  return parts.join(' ');
}

function MatchEditor({ match, teams, draft, saving, saved, onDraft, onSave }) {
  const home = teamById(teams, match.homeTeamId);
  const away = teamById(teams, match.awayTeamId);

  return (
    <article className="adminMatchRow">
      <div className="adminMatchMeta">
        <div className="adminMatchTop">
          <span className="matchNum">#{match.matchNumber}</span>
          {match.group && <span className="groupBadge">Gr. {match.group}</span>}
          <MatchStatusBadge status={match.status} />
          <time>{formatMatchDate(match.startsAt)}</time>
        </div>
        <div className="adminTeams">
          <span>
            <span className="teamFlag compact">{FLAG_BY_CODE[home?.code] ?? '🏳'}</span>
            <strong>{home?.code ?? '???'}</strong>
            <small>{home?.name ?? '-'}</small>
          </span>
          <span>
            <span className="teamFlag compact">{FLAG_BY_CODE[away?.code] ?? '🏳'}</span>
            <strong>{away?.code ?? '???'}</strong>
            <small>{away?.name ?? '-'}</small>
          </span>
        </div>
      </div>

      <div className="adminScoreControls">
        <label>
          <span>{home?.code ?? 'Casa'}</span>
          <input
            type="number"
            min="0"
            inputMode="numeric"
            value={draft.homeGoals}
            onChange={(event) => onDraft(match.id, { homeGoals: event.target.value })}
          />
        </label>
        <span className="scoreSep">×</span>
        <label>
          <span>{away?.code ?? 'Fora'}</span>
          <input
            type="number"
            min="0"
            inputMode="numeric"
            value={draft.awayGoals}
            onChange={(event) => onDraft(match.id, { awayGoals: event.target.value })}
          />
        </label>
      </div>

      <div className="adminStatusControl">
        <label>
          <span>Status</span>
          <select
            value={draft.status}
            onChange={(event) => onDraft(match.id, { status: event.target.value })}
          >
            {STATUS_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
      </div>

      <button
        className={`adminSaveBtn${saved ? ' saved' : ''}`}
        onClick={() => onSave(match)}
        disabled={saving}
      >
        {saved ? <CheckCircle size={15} /> : <Save size={15} />}
        <span>{saved ? 'Salvo' : saving ? 'Salvando' : 'Salvar'}</span>
      </button>
    </article>
  );
}

export default function AdminScoresPage() {
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [token, setToken] = useState('');
  const [theme, setTheme] = useState('dark');
  const [teams, setTeams] = useState([]);
  const [matches, setMatches] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('today');
  const [savingIds, setSavingIds] = useState(new Set());
  const [savedIds, setSavedIds] = useState(new Set());
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState('');

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
    const [teamsData, matchesData] = await Promise.all([api('/teams'), api('/matches')]);
    replaceIfChanged(setTeams, teamsData.teams);
    replaceIfChanged(setMatches, matchesData.matches);
    setDrafts((current) => {
      const next = { ...current };
      for (const match of matchesData.matches) {
        if (!next[match.id]) next[match.id] = draftFromMatch(match);
      }
      return sameJson(current, next) ? current : next;
    });
  }, []);

  useEffect(() => {
    loadPublic().catch((error) => setMessage(error.message));
    let active = true;
    const unsub = onAuthStateChanged(getFirebaseAuth(), async (nextUser) => {
      try {
        if (!active) return;
        if (!nextUser) {
          setUser(null);
          setToken('');
          setProfile(null);
          return;
        }
        setUser(nextUser);
        const nextToken = await nextUser.getIdToken();
        if (!active) return;
        setToken(nextToken);
        const { user: me } = await api('/me', nextToken);
        setProfile(me);
      } catch (error) {
        if (active) setMessage(error.message);
      } finally {
        if (active) setAuthReady(true);
      }
    });
    return () => {
      active = false;
      unsub();
    };
  }, [loadPublic]);

  const teamMap = useMemo(() => Object.fromEntries(teams.map((team) => [team.id, team])), [teams]);
  const visibleMatches = useMemo(() => {
    const todayKey = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    const text = query.trim().toLowerCase();

    return [...matches]
      .filter((match) => {
        if (statusFilter === 'today') {
          const key = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'America/Sao_Paulo',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
          }).format(new Date(match.startsAt));
          if (key !== todayKey) return false;
        } else if (statusFilter !== 'all' && match.status !== statusFilter) {
          return false;
        }

        if (!text) return true;
        const home = teamMap[match.homeTeamId];
        const away = teamMap[match.awayTeamId];
        const haystack = [
          match.matchNumber,
          match.group,
          home?.name,
          home?.code,
          away?.name,
          away?.code,
          match.city,
          match.venue,
        ].join(' ').toLowerCase();
        return haystack.includes(text);
      })
      .sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
  }, [matches, query, statusFilter, teamMap]);

  function updateDraft(matchId, patch) {
    setDrafts((current) => ({
      ...current,
      [matchId]: {
        ...current[matchId],
        ...patch,
      },
    }));
  }

  async function saveMatch(match) {
    const draft = drafts[match.id] ?? draftFromMatch(match);
    setSavingIds((current) => new Set([...current, match.id]));
    setMessage('');
    try {
      const homeGoals = draft.homeGoals === '' ? null : Number(draft.homeGoals);
      const awayGoals = draft.awayGoals === '' ? null : Number(draft.awayGoals);
      const { match: updated } = await api(`/matches/${match.id}`, token, {
        method: 'PATCH',
        body: JSON.stringify({
          status: draft.status,
          homeGoals,
          awayGoals,
        }),
      });
      setMatches((current) => current.map((candidate) => (
        candidate.id === updated.id ? updated : candidate
      )));
      setDrafts((current) => ({ ...current, [updated.id]: draftFromMatch(updated) }));
      setSavedIds((current) => new Set([...current, updated.id]));
      setTimeout(() => setSavedIds((current) => {
        const next = new Set(current);
        next.delete(updated.id);
        return next;
      }), 1800);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setSavingIds((current) => {
        const next = new Set(current);
        next.delete(match.id);
        return next;
      });
    }
  }

  async function handleRefresh() {
    try {
      await loadPublic();
      setMessage('Dados atualizados.');
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function handleForceSync() {
    if (!token || syncing) return;
    setSyncing(true);
    setMessage('Sincronizando placares...');
    try {
      const { sync } = await api('/admin/sync', token, {
        method: 'POST',
      });
      await loadPublic();
      setMessage(formatSyncResult(sync));
    } catch (error) {
      setMessage(error.message);
    } finally {
      setSyncing(false);
    }
  }

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
            <p>Administração de placares</p>
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
          <div className="authCard">
            <div className="authHeader">
              <div className="authLogo">B</div>
              <h2>Bolão 2026</h2>
              <p>Entre com uma conta admin para alterar placares.</p>
            </div>
            <div className="authBody">
              <Link className="btnPrimary" href="/">Entrar na página principal</Link>
            </div>
          </div>
        </div>
      ) : profile?.role !== 'admin' ? (
        <section className="panel adminAccessPanel">
          <div className="titleIcon danger"><ShieldAlert size={18} /></div>
          <h2>Acesso restrito</h2>
          <p>Somente administradores podem alterar placares manualmente.</p>
        </section>
      ) : (
        <div className="adminScoresGrid">
          <section className="adminHeaderPanel">
            <div>
              <span className="badge active">Admin</span>
              <h2>Placares manuais</h2>
              <p className="heroSub">Use quando a API falhar ou atrasar a atualização de algum jogo.</p>
            </div>
            <div className="adminHeaderActions">
              <button className="btnGhost adminRefreshBtn" onClick={handleRefresh} disabled={syncing}>
                <RefreshCw size={15} />
                Recarregar
              </button>
              <button className="btnPrimary adminSyncBtn" onClick={handleForceSync} disabled={syncing || !token}>
                <RefreshCw size={15} />
                {syncing ? 'Sincronizando' : 'Sync force'}
              </button>
            </div>
          </section>

          <section className="panel adminControlsPanel">
            <label className="adminSearch">
              <Search size={15} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar por time, sigla, grupo, cidade ou número"
              />
            </label>
            <div className="subFilterBar adminStatusFilters">
              {[
                ['today', 'Hoje'],
                ['live', 'Ao vivo'],
                ['scheduled', 'Agendados'],
                ['finished', 'Encerrados'],
                ['all', 'Todos'],
              ].map(([value, label]) => (
                <button
                  key={value}
                  className={statusFilter === value ? 'active' : ''}
                  onClick={() => setStatusFilter(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </section>

          {message && <div className="todayError">{message}</div>}

          <section className="panel adminListPanel">
            <div className="panelTitle">
              <div className="titleIcon"><Save size={13} /></div>
              <h2>Jogos</h2>
            </div>
            <div className="adminMatchList">
              {visibleMatches.length === 0 ? (
                <div className="emptyState">Nenhum jogo encontrado.</div>
              ) : visibleMatches.map((match) => (
                <MatchEditor
                  key={match.id}
                  match={match}
                  teams={teams}
                  draft={drafts[match.id] ?? draftFromMatch(match)}
                  saving={savingIds.has(match.id)}
                  saved={savedIds.has(match.id)}
                  onDraft={updateDraft}
                  onSave={saveMatch}
                />
              ))}
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
