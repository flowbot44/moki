import type { MatchData, DFSStats, PredictiveMatchup, MokiPlayer, MokiSpecialty, SynergyGridRow, WindowGridRow } from '../types';
import { COMPOSITION_WIN_RATES } from './composition-data';
import { scoreMatchup } from '../lib/matchupScore';
import type { StatsData, Role } from '../lib/matchupScore';

export interface ChampGridRow {
  championName: string;
  matches: {
    oppName: string;
    adv: number;
    xPoints: number;
  }[];
  totalAdv: number;
  totalXPoints: number;
}

const getTeamComposition = (players: MokiPlayer[], mokiSpecialties: Record<string, MokiSpecialty>) => {
  return players.map(p => mokiSpecialties[p.token_id.toString()] || 'BALANCED').sort().join(',');
};

const getRoleChar = (spec: MokiSpecialty): Role => {
  if (spec === 'ELIM_SPECIALIST') return 'E';
  if (spec === 'GACHA_SPECIALIST') return 'D';
  if (spec === 'WART_SPECIALIST') return 'W';
  return 'S';
};

export const calculatePredictiveAdvantage = (
  match: MatchData,
  allStats: DFSStats[],
  mokiSpecialties: Record<string, MokiSpecialty>,
  counterMap: Record<string, { wins: number; games: number }> = {}
): PredictiveMatchup => {
  const teamA = match.players.filter(p => p.team === 1);
  const teamB = match.players.filter(p => p.team === 2);

  const getTeamScore = (players: MokiPlayer[], opponents: MokiPlayer[]) => {
    const champion = players.find(p => p.is_champion);
    const oppChampion = opponents.find(p => p.is_champion);
    const comp = getTeamComposition(players, mokiSpecialties);

    // 1. Composition Baseline (Weight: 35%)
    let compWR = COMPOSITION_WIN_RATES[comp] || 0.5;
    
    // 2. Bayesian Champion Form (Weight: 35%)
    const champStats = allStats.find(s => s.moki_id === champion?.moki_id);
    const games = champStats?.games_played || 0;
    const rawWR = (champStats?.win_rate || 50) / 100;
    const bayesianWR = ( (games * rawWR) + (10 * 0.5) ) / (games + 10);

    // 3. Momentum Factor (Weight: 15%)
    const momentum = (champStats?.momentum || 0) / 100;

    // 4. Head-to-Head Counter (Weight: 15%)
    let counterMod = 0;
    if (champion && oppChampion) {
      const matchupKey = `${champion.name} vs ${oppChampion.name}`;
      const headToHead = counterMap[matchupKey];
      if (headToHead && headToHead.games >= 2) {
        counterMod = (headToHead.wins / headToHead.games) - 0.5;
      }
    }

    return (compWR * 0.35) + (bayesianWR * 0.35) + (momentum * 0.15) + (counterMod * 0.15);
  };

  const scoreA = getTeamScore(teamA, teamB);
  const scoreB = getTeamScore(teamB, teamA);

  const total = scoreA + scoreB;
  const winProbabilityA = (scoreA / total) * 100;
  const finalProbA = Math.max(5, Math.min(95, winProbabilityA));
  const finalProbB = 100 - finalProbA;

  const calculatePoints = (prob: number, players: MokiPlayer[]) => {
    const champion = players.find(p => p.is_champion);
    if (!champion) return 0;
    const stats = allStats.find(s => s.moki_id === champion.moki_id);
    const winPoints = (prob / 100) * 300;
    if (!stats) return winPoints;

    const statPoints = (stats.avg_eliminations * 80) + 
                       (stats.avg_deposits * 50) + 
                       (Math.floor(stats.avg_wart / 80) * 45);
    return winPoints + statPoints;
  };

  return {
    matchId: match.match.match_id,
    matchDate: match.match.match_date,
    teamA: { players: teamA, winProbability: finalProbA, pointsExpected: calculatePoints(finalProbA, teamA) },
    teamB: { players: teamB, winProbability: finalProbB, pointsExpected: calculatePoints(finalProbB, teamB) },
    advantage: finalProbA - 50
  };
};

export const generatePredictionGrid = (
  scheduledMatches: MatchData[],
  displayChampions: DFSStats[],
  mokiSpecialties: Record<string, MokiSpecialty>,
  allStats: DFSStats[],
  counterMap: any = {}
): ChampGridRow[] => {
  return displayChampions.map(champ => {
    const champMatches = scheduledMatches
      .filter(m => m.players.some(p => p.moki_id === champ.moki_id))
      .sort((a, b) => a.match.match_id.localeCompare(b.match.match_id))
      .slice(0, 10);

    const matchResults = champMatches.map(m => {
      const pred = calculatePredictiveAdvantage(m, allStats, mokiSpecialties, counterMap);
      const isTeamA = m.players.find(p => p.moki_id === champ.moki_id)?.team === 1;
      const relAdv = isTeamA ? pred.advantage : -pred.advantage;
      const xPoints = isTeamA ? pred.teamA.pointsExpected : pred.teamB.pointsExpected;
      const oppChamp = m.players.find(p => p.is_champion && p.moki_id !== champ.moki_id);
      return { oppName: oppChamp ? oppChamp.name : "Team", adv: relAdv, xPoints };
    });

    return {
      championName: champ.name,
      matches: matchResults,
      totalAdv: matchResults.reduce((sum, m) => sum + m.adv, 0),
      totalXPoints: matchResults.reduce((sum, m) => sum + m.xPoints, 0)
    };
  });
};

export const generateSynergyGrid = (
  scheduledMatches: MatchData[],
  displayChampions: DFSStats[],
  mokiSpecialties: Record<string, MokiSpecialty>,
  statsData: StatsData
): SynergyGridRow[] => {
  return displayChampions.map(champ => {
    const champMatches = scheduledMatches
      .filter(m => m.players.some(p => p.moki_id === champ.moki_id))
      .sort((a, b) => a.match.match_id.localeCompare(b.match.match_id));

    const getSynergyWindowPoints = (matchesSlice: MatchData[]) => {
      return matchesSlice.reduce((sum, m) => {
        const team1 = m.players.filter(p => p.team === 1);
        const team2 = m.players.filter(p => p.team === 2);
        
        const isTeam1 = m.players.find(p => p.moki_id === champ.moki_id)?.team === 1;
        const myTeam = isTeam1 ? team1 : team2;
        const oppTeam = isTeam1 ? team2 : team1;

        const myRoles = myTeam.map(p => getRoleChar(mokiSpecialties[p.token_id.toString()] || 'BALANCED'));
        const oppRoles = oppTeam.map(p => getRoleChar(mokiSpecialties[p.token_id.toString()] || 'BALANCED'));
        
        const matchup = scoreMatchup(myRoles, oppRoles, statsData);
        // Map win probability / safe score to a scale relative to 50
        // (safe_score - 50) / 10 gives a granular score where +1 is a strong advantage
        return sum + (matchup.safe_score - 50) / 10;
      }, 0);
    };

    const w1Synergy = getSynergyWindowPoints(champMatches.slice(0, 10));
    const w2Synergy = getSynergyWindowPoints(champMatches.slice(10, 20));
    const w3Synergy = getSynergyWindowPoints(champMatches.slice(20, 30));

    return {
      championName: champ.name,
      w1Synergy,
      w2Synergy,
      w3Synergy,
      totalSynergy: w1Synergy + w2Synergy + w3Synergy
    };
  });
};

export const generateTripleWindowGrid = (
  scheduledMatches: MatchData[],
  displayChampions: DFSStats[],
  mokiSpecialties: Record<string, MokiSpecialty>,
  allStats: DFSStats[],
  counterMap: any = {}
): WindowGridRow[] => {
  return displayChampions.map(champ => {
    const champMatches = scheduledMatches
      .filter(m => m.players.some(p => p.moki_id === champ.moki_id))
      .sort((a, b) => a.match.match_id.localeCompare(b.match.match_id));

    const getWindowPoints = (matchesSlice: MatchData[]) => {
      return matchesSlice.reduce((sum, m) => {
        const pred = calculatePredictiveAdvantage(m, allStats, mokiSpecialties, counterMap);
        const isTeamA = m.players.find(p => p.moki_id === champ.moki_id)?.team === 1;
        return sum + (isTeamA ? pred.teamA.pointsExpected : pred.teamB.pointsExpected);
      }, 0);
    };

    const w1Points = getWindowPoints(champMatches.slice(0, 10));
    const w2Points = getWindowPoints(champMatches.slice(10, 20));
    const w3Points = getWindowPoints(champMatches.slice(20, 30));

    return {
      championName: champ.name,
      w1Points,
      w2Points,
      w3Points,
      totalPoints: w1Points + w2Points + w3Points
    };
  });
};
