import type { MatchData, DFSStats, MokiSpecialty, MokiPlayer } from '../types';
import { calculatePredictiveAdvantage } from './predictive-engine';
import { calculateDFSPoints } from './dfs-scoring';
import type { StatsData, Role } from '../lib/matchupScore';
import type { MokiStats } from './stat-mapper';

export interface BacktestResult {
  totalMatches: number;
  correctPredictions: number;
  accuracy: number;
  highConfidenceMatches: number;
  highConfidenceCorrect: number;
  highConfidenceAccuracy: number;
  logLoss: number;
  brierScore: number;
  calibration: {
    bins: { range: [number, number]; expected: number; actual: number; count: number }[];
  };
}

const getRoleChar = (spec: MokiSpecialty): Role => {
  if (spec === 'ELIM_SPECIALIST') return 'E';
  if (spec === 'GACHA_SPECIALIST') return 'D';
  if (spec === 'WART_SPECIALIST') return 'W';
  return 'S';
};

/**
 * v4.12 - Filtered Cumulative Backtest with Confidence Metrics
 */
export const runTrueBacktest = (
  matches: MatchData[],
  mokiSpecialties: Record<string, MokiSpecialty>,
  statMap?: Record<string, MokiStats>
): BacktestResult => {
  const sortedMatches = [...matches].sort((a, b) => a.match.match_id.localeCompare(b.match.match_id));
  
  const statsMap: Record<string, DFSStats & { wins: number; scores: number[] }> = {};
  const counterMap: Record<string, { wins: number; games: number }> = {};
  const compositionWins: Record<string, { wins: number; games: number }> = {};
  const headToHead: Record<string, { winsA: number; games: number }> = {};

  let correct = 0;
  let totalValid = 0;
  let highConfCorrect = 0;
  let highConfTotal = 0;
  let totalLogLoss = 0;
  let totalBrierScore = 0;

  const bins = Array.from({ length: 10 }, (_, i) => ({
    range: [i * 10, (i + 1) * 10] as [number, number],
    expected: 0,
    actual: 0,
    count: 0
  }));

  sortedMatches.forEach((m) => {
    if (m.match.state !== 'scored' || m.match.team_won === null) return;

    // 1. PREDICT
    const statsData: StatsData = { composition: compositionWins, headToHead };
    
    // EXPERIENCE FILTER: Only predict if both champions have played at least 5 games
    const champA = m.players.find(p => p.team === 1 && p.is_champion);
    const champB = m.players.find(p => p.team === 2 && p.is_champion);
    
    const gamesA = statsMap[champA?.moki_id || '']?.games_played || 0;
    const gamesB = statsMap[champB?.moki_id || '']?.games_played || 0;

    if (gamesA >= 15 && gamesB >= 15) {
      const pred = calculatePredictiveAdvantage(m, statsMap, mokiSpecialties, counterMap, statsData, statMap);
      const probA = pred.teamA.winProbability / 100;
      const actualA = m.match.team_won === 1 ? 1 : 0;
      
      const predictedWinner = probA > 0.5 ? 1 : 2;
      const wasCorrect = m.match.team_won === predictedWinner;
      
      if (wasCorrect) correct++;

      // HIGH CONFIDENCE CHECK ( > 65% or < 35% )
      if (probA > 0.65 || probA < 0.35) {
          highConfTotal++;
          if (wasCorrect) highConfCorrect++;
      }

      const epsilon = 1e-15;
      const p = Math.max(epsilon, Math.min(1 - epsilon, probA));
      totalLogLoss -= (actualA * Math.log(p) + (1 - actualA) * Math.log(1 - p));
      totalBrierScore += Math.pow(probA - actualA, 2);

      // Calibration Binning
      const binIdx = Math.max(0, Math.min(9, Math.floor(probA * 10)));
      bins[binIdx].expected += probA;
      bins[binIdx].actual += actualA;
      bins[binIdx].count++;
      
      totalValid++;
    }

    // 2. UPDATE (Always update so we build history)
    const isWinner = m.match.team_won;
    const team1 = m.players.filter(p => p.team === 1);
    const team2 = m.players.filter(p => p.team === 2);

    const updateLineup = (players: MokiPlayer[], teamNum: number, opponents: MokiPlayer[]) => {
      const teamWon = isWinner === teamNum;
      const champion = players.find(p => p.is_champion);
      const oppChampion = opponents.find(p => p.is_champion);

      players.forEach((p) => {
        if (!statsMap[p.moki_id]) {
          statsMap[p.moki_id] = {
            moki_id: p.moki_id, token_id: p.token_id, name: p.name, is_champion: p.is_champion === 1,
            total_points: 0, games_played: 0, avg_deposits: 0, avg_eliminations: 0, avg_wart: 0,
            win_rate: 0, wins: 0, momentum: 0, confidence: 0, volatility: 0, scores: []
          };
          (statsMap[p.moki_id] as any).recentWins = [];
        }
        const stats = statsMap[p.moki_id];
        const performance = m.performances.find((perf) => perf.moki_id === p.moki_id || perf.token_id === p.token_id);
        const score = calculateDFSPoints(performance, m.match, teamNum);

        stats.total_points += score;
        stats.scores.push(score);
        stats.games_played += 1;
        if (teamWon) stats.wins += 1;

        if (performance) {
          stats.avg_deposits = ((stats.avg_deposits * (stats.games_played - 1)) + (performance.deposits || 0)) / stats.games_played;
          stats.avg_eliminations = ((stats.avg_eliminations * (stats.games_played - 1)) + (performance.eliminations || 0)) / stats.games_played;
          stats.avg_wart = ((stats.avg_wart * (stats.games_played - 1)) + (performance.wart_distance || 0)) / stats.games_played;
        }

        stats.win_rate = (stats.wins / stats.games_played) * 100;

        // Rolling recent form — last 5 game results
        const recentWins: number[] = (stats as any).recentWins;
        recentWins.push(teamWon ? 1 : 0);
        if (recentWins.length > 10) recentWins.shift();
        stats.momentum = recentWins.reduce((a, b) => a + b, 0) / recentWins.length;
      });

      if (champion && oppChampion) {
        const matchup = `${champion.name} vs ${oppChampion.name}`;
        counterMap[matchup] = counterMap[matchup] || { wins: 0, games: 0 };
        counterMap[matchup].games++;
        if (teamWon) counterMap[matchup].wins++;
      }

      const roles = players.map(p => getRoleChar(mokiSpecialties[p.token_id.toString()] || 'BALANCED')).sort().join("+");
      compositionWins[roles] = compositionWins[roles] || { wins: 0, games: 0 };
      compositionWins[roles].games++;
      if (teamWon) compositionWins[roles].wins++;
    };

    updateLineup(team1, 1, team2);
    updateLineup(team2, 2, team1);

    const roles1 = team1.map(p => getRoleChar(mokiSpecialties[p.token_id.toString()] || 'BALANCED')).sort().join("+");
    const roles2 = team2.map(p => getRoleChar(mokiSpecialties[p.token_id.toString()] || 'BALANCED')).sort().join("+");
    const h2hKey = `${roles1}|${roles2}`;
    headToHead[h2hKey] = headToHead[h2hKey] || { winsA: 0, games: 0 };
    headToHead[h2hKey].games++;
    if (isWinner === 1) headToHead[h2hKey].winsA++;
  });

  const finalTotal = totalValid > 0 ? totalValid : 1;
  const finalHighConfTotal = highConfTotal > 0 ? highConfTotal : 1;

  return {
    totalMatches: totalValid,
    correctPredictions: correct,
    accuracy: (correct / finalTotal) * 100,
    highConfidenceMatches: highConfTotal,
    highConfidenceCorrect: highConfCorrect,
    highConfidenceAccuracy: (highConfCorrect / finalHighConfTotal) * 100,
    logLoss: totalLogLoss / finalTotal,
    brierScore: totalBrierScore / finalTotal,
    calibration: {
      bins: bins.map(b => ({
        ...b,
        expected: b.count > 0 ? b.expected / b.count : 0,
        actual: b.count > 0 ? b.actual / b.count : 0
      }))
    }
  };
};
