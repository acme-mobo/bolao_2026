'use client';

import Link from 'next/link';
import {
  AlertTriangle, CalendarDays, Check, CheckCircle, ChevronDown,
  Clock, HelpCircle, LogOut, Moon, Pencil, RefreshCw, Save, Settings, Shield, Sun,
  Trash2, Trophy, Users, X,
} from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  createUserWithEmailAndPassword,
  getFirebaseAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
} from './lib/firebase-client.js';
import { APP_NAME, COMPETITION_NAME } from './lib/branding.js';

// ─── API helper ──────────────────────────────────────
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

const SESSION_CACHE_KEY = 'bolao.sessionSnapshot';

function readSessionSnapshot() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(SESSION_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeSessionSnapshot(snapshot) {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(SESSION_CACHE_KEY, JSON.stringify(snapshot));
  } catch {
    // Session cache is only a UI convenience; auth state remains owned by Firebase.
  }
}

function clearSessionSnapshot() {
  if (typeof window === 'undefined') return;
  window.sessionStorage.removeItem(SESSION_CACHE_KEY);
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function replaceIfChanged(setter, nextValue) {
  setter((currentValue) => (sameJson(currentValue, nextValue) ? currentValue : nextValue));
}

const PREDICTION_LOCK_LEAD_MS = 5 * 60_000;

// ─── Pure helpers ─────────────────────────────────────
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

function hasMatchTeamsDefined(match) {
  return Boolean(match?.homeTeamId && match?.awayTeamId);
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

const KNOCKOUT_STAGE_ORDER = [
  'round-of-32',
  'round-of-16',
  'quarter-final',
  'semi-final',
  'third-place',
  'final',
];

const KNOCKOUT_STAGE_LABELS = {
  'round-of-32': '16 avos',
  'round-of-16': 'Oitavas',
  'quarter-final': 'Quartas',
  'semi-final': 'Semifinais',
  'third-place': '3º lugar',
  final: 'Final',
};

function normalizeStage(value = '') {
  return String(value)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function knockoutStageKey(match) {
  const normalized = normalizeStage(match?.stage ?? match?.round ?? match?.phase);
  if (['round-of-32', 'last-32', '32', 'r32', 'dezesseis-avos'].includes(normalized)) return 'round-of-32';
  if (['round-of-16', 'last-16', '16', 'r16', 'oitavas', 'oitava-de-final'].includes(normalized)) return 'round-of-16';
  if (['quarter-final', 'quarter-finals', 'quarterfinal', 'quarterfinals', 'quartas', 'quartas-de-final'].includes(normalized)) return 'quarter-final';
  if (['semi-final', 'semi-finals', 'semifinal', 'semifinals', 'semifinais'].includes(normalized)) return 'semi-final';
  if (['third-place', 'third-place-play-off', '3rd-place', 'terceiro-lugar', 'disputa-de-3-lugar'].includes(normalized)) return 'third-place';
  if (normalized === 'final') return 'final';

  return null;
}

function isKnockoutMatch(match) {
  return Boolean(knockoutStageKey(match));
}

function matchStageLabel(match) {
  const knockoutKey = knockoutStageKey(match);
  if (knockoutKey) return KNOCKOUT_STAGE_LABELS[knockoutKey];
  return match?.group ? `Gr. ${match.group}` : null;
}

function groupMatchesByKnockoutStage(sourceMatches) {
  const byStage = new Map(KNOCKOUT_STAGE_ORDER.map((key) => [key, []]));
  for (const match of sourceMatches) {
    const key = knockoutStageKey(match);
    if (!key) continue;
    byStage.get(key)?.push(match);
  }

  return KNOCKOUT_STAGE_ORDER
    .map((key) => ({
      key,
      label: KNOCKOUT_STAGE_LABELS[key],
      matches: (byStage.get(key) ?? [])
        .sort((a, b) => (a.matchNumber ?? 0) - (b.matchNumber ?? 0)),
    }))
    .filter((stage) => stage.matches.length > 0);
}

function groupMatchesForBracket(sourceMatches) {
  const stages = positionBracketStages(groupMatchesByKnockoutStage(sourceMatches));
  const finalStage = stages.find((stage) => stage.key === 'final');
  const thirdPlaceStage = stages.find((stage) => stage.key === 'third-place');

  if (!finalStage || !thirdPlaceStage) return stages;

  return [
    ...stages.filter((stage) => stage.key !== 'final' && stage.key !== 'third-place'),
    {
      key: 'finals',
      label: 'Final e 3º lugar',
      matches: spreadOverlappingBracketSlots([...finalStage.matches, ...thirdPlaceStage.matches]),
    },
  ];
}

function sourceMatchNumbers(match) {
  return [match?.homeSlot, match?.awaySlot].flatMap((slot) => {
    const normalized = normalizeStage(slot);
    const isPathSlot = ['vencedor', 'perdedor', 'winner', 'loser'].some((word) => normalized.includes(word));
    if (!isPathSlot) return [];
    return [...String(slot).matchAll(/\d+/g)].map(([value]) => Number(value));
  });
}

function orderMatchesByNextRound(matches, nextStages) {
  const byMatchNumber = new Map(matches.map((match) => [Number(match.matchNumber), match]));
  const seen = new Set();
  const ordered = [];

  for (const targetStage of nextStages) {
    for (const targetMatch of targetStage.matches) {
      const sourceMatches = sourceMatchNumbers(targetMatch)
        .map((matchNumber) => byMatchNumber.get(matchNumber))
        .filter(Boolean);

      for (const match of sourceMatches) {
        const matchNumber = Number(match.matchNumber);
        if (seen.has(matchNumber)) continue;
        seen.add(matchNumber);
        ordered.push(match);
      }
    }
  }

  const leftovers = matches.filter((match) => !seen.has(Number(match.matchNumber)));
  return [...ordered, ...leftovers];
}

function fallbackBracketSlot(index, matchCount, baseCount) {
  if (baseCount <= 1) return 0;
  if (matchCount <= 1) return (baseCount - 1) / 2;
  return index * ((baseCount - 1) / (matchCount - 1));
}

function positionBracketStages(stages) {
  const orderedStages = stages.map((stage) => ({ ...stage, matches: stage.matches }));
  for (let stageIndex = orderedStages.length - 1; stageIndex >= 0; stageIndex -= 1) {
    orderedStages[stageIndex] = {
      ...orderedStages[stageIndex],
      matches: orderMatchesByNextRound(
        orderedStages[stageIndex].matches,
        orderedStages.slice(stageIndex + 1),
      ),
    };
  }

  const baseCount = orderedStages[0]?.matches.length ?? 0;
  const slotByMatchNumber = new Map();

  return orderedStages.map((stage, stageIndex) => {
    const matches = stage.matches.map((match, matchIndex) => {
      const sourceSlots = sourceMatchNumbers(match)
        .map((matchNumber) => slotByMatchNumber.get(matchNumber))
        .filter((slot) => Number.isFinite(slot));
      const bracketSlot = sourceSlots.length > 0
        ? sourceSlots.reduce((sum, slot) => sum + slot, 0) / sourceSlots.length
        : fallbackBracketSlot(matchIndex, stage.matches.length, baseCount);
      slotByMatchNumber.set(Number(match.matchNumber), bracketSlot);
      return { ...match, bracketSlot };
    });

    return {
      ...stage,
      matches: stageIndex === 0 ? matches : matches.sort((a, b) => a.bracketSlot - b.bracketSlot),
    };
  });
}

function spreadOverlappingBracketSlots(matches) {
  const bySlot = new Map();
  for (const match of matches) {
    const key = String(match.bracketSlot ?? 0);
    bySlot.set(key, [...(bySlot.get(key) ?? []), match]);
  }

  return [...bySlot.values()].flatMap((slotMatches) => {
    if (slotMatches.length === 1) return slotMatches;
    const centerOffset = (slotMatches.length - 1) / 2;
    return slotMatches.map((match, index) => ({
      ...match,
      bracketSlot: (match.bracketSlot ?? 0) + ((index - centerOffset) * 1.05),
    }));
  }).sort((a, b) => a.bracketSlot - b.bracketSlot);
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
    { pts: 5, label: 'Placar exato', desc: 'Acertou o placar completo — vale para vitórias e empates', highlight: true },
    { pts: 3, label: 'Vencedor / empate', desc: 'Acertou quem vence ou que o jogo termina empatado, sem placar exato' },
  ];
  return (
    <div className="modalOverlay" role="dialog" aria-modal="true"
      onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modalHead">
          <div className="modalHeadIcon"><Trophy size={20} /></div>
          <h3>Regras de Pontuação</h3>
          <p>Cada jogo vale no máximo 5 pts. Palpites fecham no início da partida.</p>
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
            Desempate: maior número de placares exatos.
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
        const cls = p.points === 5 ? 'exact' : p.points > 0 ? 'partial' : 'zero';
        return (
          <li key={p.userId} className={`predRow${p.userId === myUserId ? ' me' : ''}`}>
            <div className="predAvatar" style={{ background: avatarColor(p.userId) }}>
              {p.userName[0].toUpperCase()}
            </div>
            <span className="predName">{p.userId === myUserId ? `${p.userName} (você)` : p.userName}</span>
            <span className="predScore">{p.homeGoals} × {p.awayGoals}</span>
            <span className={`predPts ${cls}`}>
              {p.points === 5 ? '⭐ ' : ''}{p.points} pts
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function MatchStatusBadge({ match }) {
  if (isHalftime(match))           return <span className="statusBadge halftime">Intervalo</span>;
  if (isLikelyLive(match))          return <span className="statusBadge live">● Ao vivo</span>;
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

function MatchCard({ match, teams, predictions, predictionDrafts, savedMatches,
  selectedPoolId, token, myUserId, showGroup, urgency, now, variant = 'default',
  onUpdateDraft, onSave, onDeletePrediction }) {
  const inProgress = isLikelyLive(match, now);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showPreds, setShowPreds] = useState(inProgress);

  const home = teamById(teams, match.homeTeamId);
  const away = teamById(teams, match.awayTeamId);
  const homeCode = home?.code ?? 'TBD';
  const awayCode = away?.code ?? 'TBD';
  const homeName = home?.name ?? match.homeSlot ?? 'A definir';
  const awayName = away?.name ?? match.awaySlot ?? 'A definir';
  const prediction = predictions.find((p) => p.matchId === match.id);
  const draft = predictionDrafts[match.id] ?? {
    homeGoals: prediction?.homeGoals ?? 0,
    awayGoals: prediction?.awayGoals ?? 0,
  };
  const locked = urgency === 'locked' || urgency === 'done' || inProgress;
  const isFinished = match.status === 'finished';
  const canViewMatchPredictions = inProgress || isFinished;
  const hasScore = match.homeGoals != null && match.awayGoals != null;
  const scoreFirst = variant === 'score';
  const isSaved = savedMatches.has(match.id);
  const hasTeamsDefined = hasMatchTeamsDefined(match);
  const canEditPrediction = hasTeamsDefined && !locked && Boolean(selectedPoolId && token);
  const countdown = (urgency === 'urgent' || urgency === 'warning')
    ? formatCountdown(match, now) : null;
  const stageLabel = matchStageLabel(match);

  useEffect(() => {
    if (inProgress) setShowPreds(true);
  }, [inProgress]);

  function handleDeleteConfirm() {
    if (!token) return;
    onDeletePrediction(match.id);
    setConfirmDelete(false);
  }

  return (
    <article className={`matchCard${scoreFirst ? ' gameCard' : ''}${inProgress ? ' liveGame' : ''}${locked ? ' locked' : ''}${urgency === 'urgent' ? ' urgent' : ''}${urgency === 'warning' ? ' warning' : ''}`}>
      <div className="matchCardHead">
        <div className="matchCardLeft">
          <span className="matchNum">#{match.matchNumber}</span>
          {showGroup && stageLabel && (
            <span className={`groupBadge${isKnockoutMatch(match) ? ' knockoutBadge' : ''}`}>
              {stageLabel}
            </span>
          )}
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
          <div className={`teamFlag${home ? '' : ' pendingFlag'}`}>{home ? home.flag ?? '🏳' : 'TBD'}</div>
          <div className="teamCode">{homeCode}</div>
          <div className="teamFullName">{homeName}</div>
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
          ) : (isFinished || inProgress) && hasScore ? (
            <div className="resultScore">
              <span className="resultNum">{match.homeGoals}</span>
              <span className="resultSep">×</span>
              <span className="resultNum">{match.awayGoals}</span>
            </div>
          ) : (
            <div className="scoreInputs">
              <Stepper value={draft.homeGoals}
                onChange={(v) => onUpdateDraft(match.id, 'homeGoals', v)}
                disabled={!canEditPrediction} label={`Gols ${homeName}`} />
              <span className="scoreSep">×</span>
              <Stepper value={draft.awayGoals}
                onChange={(v) => onUpdateDraft(match.id, 'awayGoals', v)}
                disabled={!canEditPrediction} label={`Gols ${awayName}`} />
              <button
                className={`btnSave${isSaved ? ' saved' : ''}`}
                disabled={!canEditPrediction}
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
          <div className={`teamFlag${away ? '' : ' pendingFlag'}`}>{away ? away.flag ?? '🏳' : 'TBD'}</div>
          <div className="teamCode">{awayCode}</div>
          <div className="teamFullName">{awayName}</div>
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
                {canEditPrediction && !scoreFirst && (
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
              {!hasTeamsDefined ? 'Aguardando definição' : scoreFirst ? 'Sem palpite' : locked ? 'Sem palpite' : 'Palpite pendente'}
            </span>
          )}
        </div>
      </div>

      {canViewMatchPredictions && (
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

function bracketTeamInfo(match, teams, side) {
  const teamId = side === 'home' ? match.homeTeamId : match.awayTeamId;
  const slot = side === 'home' ? match.homeSlot : match.awaySlot;
  const team = teamById(teams, teamId);
  return {
    code: team?.code ?? 'TBD',
    name: team?.name ?? slot ?? 'A definir',
    flag: team ? team.flag ?? '🏳' : null,
  };
}

function matchWinnerSide(match) {
  if (!hasKnownScore(match)) return null;
  if (match.homeGoals > match.awayGoals) return 'home';
  if (match.awayGoals > match.homeGoals) return 'away';
  return null;
}

function BracketTeam({ team, score, winner }) {
  return (
    <div className={`bracketTeam${winner ? ' winner' : ''}`}>
      <span className="bracketFlag">{team.flag ?? 'TBD'}</span>
      <span className="bracketTeamText">
        <strong>{team.code}</strong>
        <span>{team.name}</span>
      </span>
      {Number.isInteger(score) && <span className="bracketScore">{score}</span>}
    </div>
  );
}

const BRACKET_CARD_HEIGHT = 126;
const BRACKET_CARD_MID = BRACKET_CARD_HEIGHT / 2;
const BRACKET_STEP = 150;

function splitBracketSides(stages) {
  const centerStage = stages.find((stage) => stage.key === 'finals')
    ?? stages.find((stage) => stage.key === 'final')
    ?? stages.at(-1);
  const sideStages = stages.filter((stage) => stage !== centerStage && stage.key !== 'third-place');
  const firstStageMatchCount = sideStages[0]?.matches.length ?? centerStage?.matches.length ?? 1;
  const sideSlotCount = Math.max(Math.ceil(firstStageMatchCount / 2), 1);
  const centerSlot = (Math.max(firstStageMatchCount, 1) - 1) / 2;

  const mapSide = (predicate) => sideStages
    .map((stage) => ({
      ...stage,
      matches: stage.matches.filter((match) => predicate(match.bracketSlot ?? centerSlot, centerSlot)),
    }))
    .filter((stage) => stage.matches.length > 0);
  const minSlot = (stageList) => Math.min(
    ...stageList.flatMap((stage) => stage.matches.map((match) => match.bracketSlot).filter(Number.isFinite)),
  );
  const withDisplaySlots = (stageList, offset) => stageList.map((stage) => ({
    ...stage,
    matches: stage.matches.map((match) => ({
      ...match,
      displayBracketSlot: (match.bracketSlot ?? offset) - offset,
    })),
  }));
  const withCenterDisplaySlots = (stage) => {
    if (!stage) return stage;
    const visualCenterSlot = (sideSlotCount - 1) / 2;
    return {
      ...stage,
      matches: stage.matches.map((match) => ({
        ...match,
        displayBracketSlot: visualCenterSlot + ((match.bracketSlot ?? centerSlot) - centerSlot),
      })),
    };
  };
  const leftStages = mapSide((slot, midpoint) => slot <= midpoint);
  const rightStages = mapSide((slot, midpoint) => slot > midpoint);
  const leftOffset = Number.isFinite(minSlot(leftStages)) ? minSlot(leftStages) : 0;
  const rightOffset = Number.isFinite(minSlot(rightStages)) ? minSlot(rightStages) : 0;

  return {
    centerStage: withCenterDisplaySlots(centerStage),
    leftStages: withDisplaySlots(leftStages, leftOffset),
    rightStages: withDisplaySlots(rightStages, rightOffset).reverse(),
    visualSlotCount: sideSlotCount,
  };
}

function KnockoutBracket({ matches, teams }) {
  const stages = groupMatchesForBracket(matches);
  const { centerStage, leftStages, rightStages, visualSlotCount } = splitBracketSides(stages);
  const bracketBoardHeight = BRACKET_CARD_HEIGHT + (Math.max(visualSlotCount, 1) - 1) * BRACKET_STEP;
  const roundCount = leftStages.length + (centerStage ? 1 : 0) + rightStages.length;

  if (stages.length === 0) {
    return <div className="emptyState">Jogos de mata-mata ainda não disponíveis.</div>;
  }

  const renderRound = ({ key, label, matches: stageMatches }, options = {}) => (
    <section key={key} className={`bracketRound${options.center ? ' centerRound' : ''}${options.mirrored ? ' mirroredRound' : ''}`}>
      <div className="bracketRoundHead">
        <span>{label}</span>
        <small>{stageMatches.length} jogo{stageMatches.length > 1 ? 's' : ''}</small>
      </div>
      <div className="bracketRoundMatches">
        {stageMatches.map((match) => {
          const home = bracketTeamInfo(match, teams, 'home');
          const away = bracketTeamInfo(match, teams, 'away');
          const winner = matchWinnerSide(match);
          return (
            <article
              key={match.id}
              className={`bracketMatch${options.connected ? ' connected' : ''}${options.mirrored ? ' mirrored' : ''}`}
              style={{ '--bracket-top': `${BRACKET_CARD_MID + ((match.displayBracketSlot ?? match.bracketSlot ?? 0) * BRACKET_STEP)}px` }}
            >
              <div className="bracketMatchMeta">
                <span>#{match.matchNumber}</span>
                <time>{formatMatchDate(match.startsAt)}</time>
              </div>
              <BracketTeam team={home} score={match.homeGoals} winner={winner === 'home'} />
              <BracketTeam team={away} score={match.awayGoals} winner={winner === 'away'} />
              <div className="bracketVenue">
                {match.city}{match.venue ? ` · ${match.venue}` : ''}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );

  return (
    <div className="bracketViewport">
      <div
        className="bracketBoard bracketBoardSplit"
        style={{ '--round-count': roundCount, '--bracket-board-height': `${bracketBoardHeight}px` }}
      >
        {leftStages.map((stage) => renderRound(stage, { connected: true }))}
        {centerStage && renderRound(centerStage, { center: true })}
        {rightStages.map((stage) => renderRound(stage, { connected: true, mirrored: true }))}
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────
export default function HomePage() {
  const [sessionSnapshot, setSessionSnapshot] = useState(null);

  // Auth
  const [authMode, setAuthMode]   = useState('login');
  const [authForm, setAuthForm]   = useState({ name: '', email: '', password: '' });
  const [user, setUser]           = useState(null);
  const [profile, setProfile]     = useState(null);
  const [token, setToken]         = useState('');
  const [authReady, setAuthReady] = useState(false);

  // Data
  const [groups, setGroups]       = useState([]);
  const [teams, setTeams]         = useState([]);
  const [matches, setMatches]     = useState([]);
  const [activePool, setActivePool]   = useState(null);
  const [selectedPoolId, setSelectedPoolId] = useState('');
  const [leaderboard, setLeaderboard] = useState([]);
  const [predictions, setPredictions] = useState([]);
  const [predictionDrafts, setPredictionDrafts] = useState({});
  const [predictionsReady, setPredictionsReady] = useState(false);

  // UI state
  const [theme, setTheme]         = useState('dark');
  const [sectionMode, setSectionMode] = useState('predictions'); // predictions | today | results
  const [navMode, setNavMode]     = useState('pending'); // group | knockout | date | pending
  const [resultsMode, setResultsMode] = useState('date'); // group | knockout | date
  const [matchFilter, setMatchFilter] = useState('all'); // all | pending
  const [tableMode, setTableMode] = useState('bracket'); // groups | bracket
  const [editingName, setEditingName]   = useState(false);
  const [nameInput, setNameInput]       = useState('');
  const [toasts, setToasts]             = useState([]);
  const [savedMatches, setSavedMatches] = useState(new Set());
  const [now, setNow]                   = useState(() => Date.now());
  const [deleteAccountModal, setDeleteAccountModal] = useState(false);
  const [deleteConfirmEmail, setDeleteConfirmEmail] = useState('');
  const [scoringModal, setScoringModal] = useState(false);
  const [showSessionLoader, setShowSessionLoader] = useState(false);
  const [syncingScores, setSyncingScores] = useState(false);
  const toastIdRef = useRef(0);
  const initialSectionSetRef = useRef(false);
  const userSelectedSectionRef = useRef(false);
  const lastAutoRefreshRef = useRef(0);
  const restoredSessionRef = useRef(false);
  const explicitSignOutRef = useRef(false);

  // ─── Session cache hydration ────────────────────────
  useLayoutEffect(() => {
    const snapshot = readSessionSnapshot();
    if (!snapshot?.user) return;

    restoredSessionRef.current = true;
    setSessionSnapshot(snapshot);
    setUser(snapshot.user);
    setProfile(snapshot.profile ?? null);
    setGroups(snapshot.groups ?? []);
    setTeams(snapshot.teams ?? []);
    setMatches(snapshot.matches ?? []);
    setActivePool(snapshot.activePool ?? null);
    setSelectedPoolId(snapshot.selectedPoolId ?? '');
    setLeaderboard(snapshot.leaderboard ?? []);
    setPredictions(snapshot.predictions ?? []);
    setPredictionDrafts(snapshot.predictionDrafts ?? {});
    setPredictionsReady(Boolean(snapshot.predictionsReady));
    setSectionMode(snapshot.ui?.sectionMode ?? 'predictions');
    setNavMode(snapshot.ui?.navMode ?? 'pending');
    setResultsMode(snapshot.ui?.resultsMode ?? 'date');
    setMatchFilter(snapshot.ui?.matchFilter ?? 'all');
    setTableMode(snapshot.ui?.tableMode ?? 'bracket');
  }, []);

  useEffect(() => {
    if (authReady || sessionSnapshot?.user) {
      setShowSessionLoader(false);
      return undefined;
    }

    const id = setTimeout(() => setShowSessionLoader(true), 180);
    return () => clearTimeout(id);
  }, [authReady, sessionSnapshot?.user]);

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

  async function handleSignOut() {
    explicitSignOutRef.current = true;
    clearSessionSnapshot();
    setSessionSnapshot(null);
    await signOut(getFirebaseAuth());
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
  const loadPublic = useCallback(async (options = {}) => {
    const matchesPath = options.fresh ? `/matches?fresh=${Date.now()}` : '/matches';
    const [gd, td, md] = await Promise.all([api('/groups'), api('/teams'), api(matchesPath)]);
    replaceIfChanged(setGroups, gd.groups);
    replaceIfChanged(setTeams, td.teams);
    replaceIfChanged(setMatches, md.matches);
  }, []);

  const loadPoolData = useCallback(async (poolId = selectedPoolId, nextToken = token, options = {}) => {
    if (!poolId || !nextToken) return;
    if (!options.silent) setPredictionsReady(false);
    const [rankData, predData] = await Promise.all([
      api(`/pools/${poolId}/leaderboard`, nextToken),
      api(`/pools/${poolId}/predictions`, nextToken),
    ]);
    replaceIfChanged(setLeaderboard, rankData.leaderboard);
    replaceIfChanged(setPredictions, predData.predictions);
    setPredictionDrafts((current) => {
      const drafts = { ...current };
      for (const p of predData.predictions) {
        drafts[p.matchId] = { homeGoals: p.homeGoals, awayGoals: p.awayGoals };
      }
      return sameJson(current, drafts) ? current : drafts;
    });
    setPredictionsReady(true);
  }, [selectedPoolId, token]);

  async function loadProtected(nextToken = token) {
    const [me, poolData] = await Promise.all([
      api('/me', nextToken),
      api('/pools/active', nextToken),
    ]);
    setProfile(me.user);
    setActivePool(poolData.pool);
    setSelectedPoolId(poolData.pool.id);
  }

  function syncToastMessage(sync) {
    const changed = (sync?.ran ?? []).reduce((total, op) => total + Number(op.changes ?? 0), 0);
    if (changed > 0) return `${changed} jogo(s) atualizado(s).`;
    if (sync?.errors?.length) return `Erro no sync: ${sync.errors[0].error ?? 'sem detalhe'}`;
    return 'Sync concluído: nenhum placar mudou.';
  }

  useEffect(() => {
    loadPublic().catch((err) => addToast(err.message, 'error'));
    let active = true;
    const unsub = onAuthStateChanged(getFirebaseAuth(), async (nextUser) => {
      try {
        if (!active) return;
        if (!nextUser) {
          if (restoredSessionRef.current && !explicitSignOutRef.current) {
            setAuthReady(true);
            return;
          }
          setUser(null);
          setToken(''); setProfile(null); setActivePool(null);
          setSelectedPoolId('');
          setLeaderboard([]); setPredictions([]);
          setPredictionsReady(false);
          setPredictionDrafts({});
          clearSessionSnapshot();
          setSessionSnapshot(null);
          initialSectionSetRef.current = false;
          userSelectedSectionRef.current = false;
          return;
        }
        explicitSignOutRef.current = false;
        setUser(nextUser);
        const nextToken = await nextUser.getIdToken();
        if (!active) return;
        setToken(nextToken);
        await loadProtected(nextToken);
      } catch (err) {
        if (active) addToast(err.message, 'error');
      } finally {
        if (active) setAuthReady(true);
      }
    });
    return () => {
      active = false;
      unsub();
    };
  }, [loadPublic]);

  useEffect(() => {
    if (!selectedPoolId || !token) return;
    loadPoolData(selectedPoolId, token, { silent: predictionsReady })
      .catch((err) => {
        setPredictionsReady(true);
        addToast(err.message, 'error');
      });
  }, [loadPoolData, selectedPoolId, token, predictionsReady]);

  useEffect(() => {
    if (!authReady || !user || !profile || !activePool || !selectedPoolId) return;

    const snapshot = {
      user: {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName,
      },
      profile,
      activePool,
      selectedPoolId,
      groups,
      teams,
      matches,
      leaderboard,
      predictions,
      predictionDrafts,
      predictionsReady,
      ui: {
        sectionMode,
        navMode,
        resultsMode,
        matchFilter,
        tableMode,
      },
      cachedAt: new Date().toISOString(),
    };
    writeSessionSnapshot(snapshot);
    setSessionSnapshot(snapshot);
  }, [
    authReady,
    user,
    profile,
    activePool,
    selectedPoolId,
    groups,
    teams,
    matches,
    leaderboard,
    predictions,
    predictionDrafts,
    predictionsReady,
    sectionMode,
    navMode,
    resultsMode,
    matchFilter,
    tableMode,
  ]);

  function selectSection(next) {
    userSelectedSectionRef.current = true;
    setSectionMode(next);
  }

  function selectPendingPredictions() {
    userSelectedSectionRef.current = true;
    setSectionMode('predictions');
    setNavMode('pending');
  }

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
    if (!token) return;
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

  async function forceSyncScores() {
    if (!token || syncingScores || profile?.role !== 'admin') return;
    setSyncingScores(true);
    try {
      const { sync } = await api('/admin/sync', token, { method: 'POST' });
      await loadPublic({ fresh: true });
      if (selectedPoolId) {
        await loadPoolData(selectedPoolId, token, { silent: true });
      }
      addToast(syncToastMessage(sync), sync?.errors?.length ? 'error' : 'success');
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setSyncingScores(false);
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
      await loadPoolData(selectedPoolId, token, { silent: true });
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
      const rankData = await api(`/pools/${selectedPoolId}/leaderboard`, token);
      setLeaderboard(rankData.leaderboard);
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
  const visibleLeaderboard = leaderboard;
  const myLeaderboardIndex = leaderboard.findIndex((r) => r.userId === profile?.id);
  const myLeaderboardRow = myLeaderboardIndex >= 0 ? leaderboard[myLeaderboardIndex] : null;
  const myPoints = myLeaderboardRow?.points ?? 0;
  const myVisibleLeaderboardIndex = visibleLeaderboard.findIndex((r) => r.userId === profile?.id);
  const myPosition = myVisibleLeaderboardIndex >= 0
    ? getDenseLeaderboardRank(visibleLeaderboard, myVisibleLeaderboardIndex)
    : null;
  const predictionsLoading = Boolean(user && selectedPoolId && token && !predictionsReady);

  const pendingMatches = useMemo(() => {
    if (!predictionsReady) return [];
    return [...matches]
      .filter((m) => {
        if (!hasMatchTeamsDefined(m)) return false;
        if (m.status === 'finished' || m.status === 'cancelled') return false;
        if (isMatchLocked(m, now)) return false;
        return !predictions.some((p) => p.matchId === m.id);
      })
      .sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
  }, [matches, now, predictions, predictionsReady]);

  function isPendingMatch(m) {
    return hasMatchTeamsDefined(m)
      && m.status !== 'finished'
      && m.status !== 'cancelled'
      && !isMatchLocked(m, now)
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

  useEffect(() => {
    if (!token || !selectedPoolId || !matches.length || !predictionsReady) return;
    if (initialSectionSetRef.current || userSelectedSectionRef.current) return;

    if (todayMatches.length > 0) {
      setSectionMode('today');
    } else {
      setSectionMode('predictions');
      setNavMode(pendingMatches.length > 0 ? 'pending' : 'date');
    }
    initialSectionSetRef.current = true;
  }, [
    token,
    selectedPoolId,
    matches.length,
    predictionsReady,
    todayMatches.length,
    pendingMatches.length,
  ]);

  const prioritizedTodayMatches = useMemo(() => {
    const urgencyOrder = { live: 0, urgent: 1, warning: 2, normal: 3, locked: 4, done: 5 };
    return [...todayMatches].sort((a, b) => {
      return (urgencyOrder[getUrgency(a, now)] ?? 9) - (urgencyOrder[getUrgency(b, now)] ?? 9)
        || new Date(a.startsAt) - new Date(b.startsAt);
    });
  }, [todayMatches, now]);

  const hasLiveRefreshWindow = useMemo(() => {
    return todayMatches.some((match) => {
      const urgency = getUrgency(match, now);
      return urgency === 'live' || urgency === 'urgent' || urgency === 'warning';
    });
  }, [todayMatches, now]);

  useEffect(() => {
    if (!selectedPoolId || !token) return;

    async function refreshVisibleData() {
      if (document.visibilityState !== 'visible') return;
      const intervalMs = hasLiveRefreshWindow ? 60_000 : 5 * 60_000;
      if (Date.now() - lastAutoRefreshRef.current < intervalMs) return;
      lastAutoRefreshRef.current = Date.now();
      try {
        await Promise.all([
          loadPublic({ fresh: hasLiveRefreshWindow }),
          loadPoolData(selectedPoolId, token, { silent: true }),
        ]);
      } catch (err) {
        addToast(err.message, 'error');
      }
    }

    const id = setInterval(refreshVisibleData, 30_000);
    const onVisible = () => refreshVisibleData();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [hasLiveRefreshWindow, loadPoolData, loadPublic, selectedPoolId, token]);

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

  const knockoutMatches = useMemo(() => {
    return [...matches]
      .filter((m) => isKnockoutMatch(m))
      .sort((a, b) => (a.matchNumber ?? 0) - (b.matchNumber ?? 0));
  }, [matches]);

  const knockoutByStage = useMemo(() => {
    const filtered = matchFilter === 'all'
      ? knockoutMatches
      : knockoutMatches.filter((m) => isPendingMatch(m));
    return groupMatchesByKnockoutStage(filtered);
  }, [knockoutMatches, matchFilter, now, predictions]);

  const resultsByStage = useMemo(() => {
    return groupMatchesByKnockoutStage(resultsMatches.filter((m) => isKnockoutMatch(m)));
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
  const canRenderCachedSession = Boolean(sessionSnapshot?.user && user && profile && selectedPoolId);
  if (!authReady && !canRenderCachedSession) {
    if (!showSessionLoader) {
      return <main className="shell" aria-busy="true" />;
    }

    return (
      <main className="shell">
        <div className="authWrap">
          <img src="/hero-banner.png" className="authBanner" alt="" aria-hidden="true" />
          <div className="authCard">
            <div className="authHeader">
              <div className="authLogo">B</div>
              <h2>{APP_NAME}</h2>
              <p>Restaurando sessão…</p>
            </div>
            <div className="predsLoading">Carregando dados do usuário…</div>
          </div>
        </div>
      </main>
    );
  }

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
            <h1>{APP_NAME}</h1>
            <p>{COMPETITION_NAME}</p>
          </div>
        </div>
        <div className="topbarActions">
          {user && (
            <Link className="topbarLink" href="/hoje" title="Jogos de hoje e ranking">
              <CalendarDays size={15} />
              <span>Hoje</span>
            </Link>
          )}
          {profile?.role === 'admin' && (
            <button
              type="button"
              className="topbarLink"
              onClick={forceSyncScores}
              disabled={syncingScores || !token}
              title="Sincronizar placares agora"
              aria-label="Sincronizar placares agora"
            >
              <RefreshCw size={15} />
              <span>{syncingScores ? 'Sync...' : 'Sync'}</span>
            </button>
          )}
          {profile?.role === 'admin' && (
            <Link className="topbarLink" href="/admin/placares" title="Editar placares manualmente">
              <Settings size={15} />
              <span>Admin</span>
            </Link>
          )}
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
              <h2>{APP_NAME}</h2>
              <p>{COMPETITION_NAME}</p>
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
            <div className="heroContent">
              <div className="heroMeta">
                <span className="badge active">Bolão ativo</span>
                {activePool?.inviteCode && (
                  <span className="badge inviteCode">#{activePool.inviteCode}</span>
                )}
              </div>
              <h2>{activePool?.name ?? 'Carregando…'}</h2>
              <p className="heroSub">{COMPETITION_NAME}</p>
            </div>
            <img src="/hero-banner.png" className="heroBanner" alt="" aria-hidden="true" />
            <div className="heroActions">
              <button className="btnIcon danger" title="Sair"
                aria-label="Sair" onClick={handleSignOut}>
                <LogOut size={17} />
              </button>
            </div>
          </section>

          {/* ── Account Summary ──────────────────────── */}
          <section className="summaryPanel">
            <div className="summaryUserCard">
              <div className="summaryIcon"><Shield size={16} /></div>
              <div className="summaryUserText">
                <span className="metricLabel">Jogador</span>
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
                <div className="profileMetaRow">
                  <span className="rolePill">{profile?.role ?? 'player'}</span>
                  <button
                    className="dangerLink"
                    disabled={!token}
                    onClick={() => { setDeleteConfirmEmail(''); setDeleteAccountModal(true); }}
                    title="Excluir conta permanentemente"
                  >
                    excluir conta
                  </button>
                </div>
              </div>
            </div>

            <div className="summaryStats">
              <div className="summaryStat">
                <div className="summaryStatHead">
                  <span className="metricLabel">Pontos</span>
                  <Trophy size={14} />
                </div>
                <div className="summaryValueRow">
                  <span className="summaryValue">{myPoints}</span>
                  {myPosition ? <span className="summaryRank">{myPosition}º lugar</span> : null}
                </div>
                <div className="summarySub">total acumulado</div>
              </div>
              <button
                className={`summaryStat summaryAction${!predictionsLoading && pendingMatches.length > 0 ? ' danger' : ''}`}
                onClick={selectPendingPredictions}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') selectPendingPredictions();
                }}
                disabled={predictionsLoading}
                title={predictionsLoading ? 'Buscando palpites' : 'Ver palpites pendentes'}
              >
                <div className="summaryStatHead">
                  <span className="metricLabel">Pendentes</span>
                  <CalendarDays size={14} />
                </div>
                <div className="summaryValue">{predictionsLoading ? '...' : pendingMatches.length}</div>
                <div className="summarySub">
                  {predictionsLoading
                    ? 'buscando dados'
                    : pendingMatches.length === 0
                    ? 'tudo em dia'
                    : `jogo${pendingMatches.length > 1 ? 's' : ''} sem palpite`}
                </div>
              </button>
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
                onClick={() => selectSection('predictions')}>
                Palpites
                {!predictionsLoading && pendingMatches.length > 0 && (
                  <span className="countBadge">{pendingMatches.length}</span>
                )}
              </button>
              <button role="tab" aria-selected={sectionMode === 'today'}
                className={sectionMode === 'today' ? 'active' : ''}
                onClick={() => selectSection('today')}>
                Hoje
                {prioritizedTodayMatches.length > 0 && (
                  <span className="countBadge neutral">{prioritizedTodayMatches.length}</span>
                )}
              </button>
              <button role="tab" aria-selected={sectionMode === 'results'}
                className={sectionMode === 'results' ? 'active' : ''}
                onClick={() => selectSection('results')}>
                Resultados
              </button>
            </div>

            {/* Prediction mode tabs */}
            {sectionMode === 'predictions' && (
              <div className="subFilterBar sectionSubTabs" role="tablist">
                <button role="tab" aria-selected={navMode === 'group'}
                  className={navMode === 'group' ? 'active' : ''}
                  onClick={() => setNavMode('group')}>
                Fase de Grupos
                </button>
                <button role="tab" aria-selected={navMode === 'knockout'}
                  className={navMode === 'knockout' ? 'active' : ''}
                  onClick={() => setNavMode('knockout')}>
                Mata-mata
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
                  {!predictionsLoading && pendingMatches.length > 0 && (
                    <span className="countBadge">{pendingMatches.length}</span>
                  )}
                </button>
              </div>
            )}

            {/* Sub-filter: Todos / Pendentes (only for group and date views) */}
            {sectionMode === 'predictions' && (navMode === 'group' || navMode === 'date' || navMode === 'knockout') && (
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
                  {!predictionsLoading && pendingMatches.length > 0 && (
                    <span className="countBadge">{pendingMatches.length}</span>
                  )}
                </button>
              </div>
            )}

            {sectionMode === 'predictions' && predictionsLoading && (
              <div className="matchList">
                <div className="predsLoading">Buscando seus palpites...</div>
              </div>
            )}

            {/* ── Por Grupo ─────────────────────────── */}
            {sectionMode === 'predictions' && !predictionsLoading && navMode === 'group' && (
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
            {sectionMode === 'predictions' && !predictionsLoading && navMode === 'date' && (
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

            {/* ── Mata-mata ────────────────────────── */}
            {sectionMode === 'predictions' && !predictionsLoading && navMode === 'knockout' && (
              <div className="matchList">
                {knockoutMatches.length === 0 ? (
                  <div className="emptyState">Jogos de mata-mata ainda não disponíveis.</div>
                ) : knockoutByStage.length === 0 ? (
                  <div className="emptyState">Nenhum jogo de mata-mata neste filtro.</div>
                ) : knockoutByStage.map(({ key, label, matches: stageMatches }) => (
                  <div key={key}>
                    <div className="dateSep stageSep">{label}</div>
                    {stageMatches.map((m) => (
                      <MatchCard key={m.id} match={m}
                        urgency={getUrgency(m, now)}
                        showGroup
                        {...matchCardShared} />
                    ))}
                  </div>
                ))}
              </div>
            )}

            {/* ── Pendentes ─────────────────────────── */}
            {sectionMode === 'predictions' && !predictionsLoading && navMode === 'pending' && (
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
                  <button role="tab" aria-selected={resultsMode === 'knockout'}
                    className={resultsMode === 'knockout' ? 'active' : ''}
                    onClick={() => setResultsMode('knockout')}>
                    Mata-mata
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
                  ) : resultsMode === 'knockout' ? (
                    resultsByStage.length === 0 ? (
                      <div className="emptyState">Nenhum resultado de mata-mata ainda.</div>
                    ) : resultsByStage.map(({ key, label, matches: stageMatches }) => (
                      <div key={key}>
                        <div className="dateSep stageSep">{label}</div>
                        {stageMatches.map((m) => (
                          <MatchCard key={m.id} match={m}
                            urgency={getUrgency(m, now)}
                            showGroup
                            variant="score"
                            {...matchCardShared} />
                        ))}
                      </div>
                    ))
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
            {visibleLeaderboard.length ? (
              <>
                <div className="rankHeader">
                  <span />{/* posição */}
                  <span />{/* nome */}
                  <span className="rankHeaderPts" title="Pontuação total">Pts</span>
                  <span className="rankHeaderStat" title="Placares exatos">E</span>
                </div>
                <ol className="leaderboard">
                  {visibleLeaderboard.map((row, i) => {
                    const rank = getDenseLeaderboardRank(visibleLeaderboard, i);
                    return (
                      <li key={row.userId} className={row.userId === profile?.id ? 'me' : ''}>
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

          {/* ── Full-width: Tabela ───────────────────── */}
          <section className="panel groupsPanel">
            <div className="panelTitle">
              <div className="titleIcon"><Users size={13} /></div>
              <h2>{tableMode === 'bracket' ? 'Chaveamento' : 'Tabela'}</h2>
              <div className="panelSwitch" role="tablist" aria-label="Visualização da tabela">
                <button
                  role="tab"
                  aria-selected={tableMode === 'groups'}
                  className={tableMode === 'groups' ? 'active' : ''}
                  onClick={() => setTableMode('groups')}
                >
                  Grupos
                </button>
                <button
                  role="tab"
                  aria-selected={tableMode === 'bracket'}
                  className={tableMode === 'bracket' ? 'active' : ''}
                  onClick={() => setTableMode('bracket')}
                >
                  Mata-mata
                </button>
              </div>
            </div>
            {tableMode === 'groups' ? (
              <div className="groupsGrid">
                {groups.map((g) => (
                  <div key={g.group} className="groupBox">
                    <div className="groupBoxHead">Grupo {g.group}</div>
                    <div className="groupTableHead">
                      <span>Time</span>
                      <span>P</span>
                      <span>J</span>
                      <span>V</span>
                      <span>E</span>
                      <span>D</span>
                      <span>SG</span>
                    </div>
                    {(g.table?.length ? g.table : g.teams).map((team) => (
                      <div key={team.id ?? team.teamId ?? team.teamCode ?? team.name} className="groupTeam">
                        <span className="groupTeamName">
                          <span className="groupTeamCode">{team.teamCode ?? team.code}</span>
                          {team.teamName ?? team.name}
                        </span>
                        <span>{team.points ?? 0}</span>
                        <span>{team.played ?? 0}</span>
                        <span>{team.won ?? 0}</span>
                        <span>{team.drawn ?? 0}</span>
                        <span>{team.lost ?? 0}</span>
                        <span>{team.goalsDiff ?? 0}</span>
                      </div>
                    ))}
                  </div>
                ))}
                {groups.length === 0 && (
                  <div className="emptyState">Carregando grupos…</div>
                )}
              </div>
            ) : (
              <KnockoutBracket matches={knockoutMatches} teams={teams} />
            )}
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
