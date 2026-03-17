import type { MatchData, DFSStats, PredictiveMatchup, MokiPlayer, MokiSpecialty, SynergyGridRow, WindowGridRow } from '../types';
import { COMPOSITION_WIN_RATES } from './composition-data';
import { scoreMatchup } from '../lib/matchupScore';
import { compareTeamStats, type MokiStats } from './stat-mapper';
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
  allStats: Record<string, DFSStats>,
  mokiSpecialties: Record<string, MokiSpecialty>,
  counterMap: Record<string, { wins: number; games: number }> = {},
  statsData?: StatsData,
  statMap?: Record<string, MokiStats>
): PredictiveMatchup => {
  const teamA = match.players.filter(p => p.team === 1);
  const teamB = match.players.filter(p => p.team === 2);

  const getTeamScore = (players: MokiPlayer[], opponents: MokiPlayer[]) => {
    // 1. History (Weight: 70%) — champion is the team identity in Grand Arena
    const teamWR = players.reduce((sum, p) => {
        const s = allStats[p.moki_id];
        const g = s?.games_played || 0;
        const r = (s?.win_rate || 50) / 100;
        const bayesWR = g > 0 ? r : 0.5;
        const w = p.is_champion ? 1.0 : 0.0;
        return sum + bayesWR * w;
    }, 0);

    // 2. Stats (Weight: 30%) — archetype matchup model
    let statScore = 0.5;
    if (statMap) {
      const myTeamStats = players.map(p => statMap[p.token_id.toString()] || { strength: 250, speed: 250, defense: 250, dexterity: 250, fortitude: 250 });
      const oppTeamStats = opponents.map(p => statMap[p.token_id.toString()] || { strength: 250, speed: 250, defense: 250, dexterity: 250, fortitude: 250 });
      statScore = compareTeamStats(myTeamStats, oppTeamStats);
    }

    return (teamWR * 0.70) + (statScore * 0.30);
  };

  const scoreA = getTeamScore(teamA, teamB);
  const scoreB = getTeamScore(teamB, teamA);

  const total = scoreA + scoreB;
  let winProbabilityA = 50;
  if (total > 0 && !isNaN(total)) {
    winProbabilityA = (scoreA / total) * 100;
  }
  
  if (isNaN(winProbabilityA)) winProbabilityA = 50;

  const compKeyA = getTeamComposition(teamA, mokiSpecialties);

  // Composition baseline: blend in team A's historical team-1 win rate by composition (20% weight)
  const compBaseA = COMPOSITION_WIN_RATES[compKeyA];
  if (compBaseA !== undefined) {
    winProbabilityA = winProbabilityA * 0.80 + (compBaseA * 100) * 0.20;
  }

  // Champion H2H: blend in directional win rate for this specific champion matchup
  const champA_player = teamA.find(p => p.is_champion);
  const champB_player = teamB.find(p => p.is_champion);

  if (champA_player?.name && champB_player?.name) {
    const h2hKey = `${champA_player.name} vs ${champB_player.name}`;
    const h2h = counterMap[h2hKey];
    if (h2h && h2h.games >= 5) {
      const h2hWR = (h2h.wins / h2h.games) * 100;
      // More evidence = more weight — champion H2H is the strongest directional signal
      const h2hWeight = h2h.games >= 20 ? 0.50 : h2h.games >= 10 ? 0.40 : 0.25;
      winProbabilityA = winProbabilityA * (1 - h2hWeight) + h2hWR * h2hWeight;
    }
  }

  // Composition H2H: use historical matchup win rates for this exact role composition pair
  if (statsData?.headToHead) {
    const teamARoles = teamA.map(p => getRoleChar((mokiSpecialties[p.token_id.toString()] || 'BALANCED') as MokiSpecialty)).sort().join("+");
    const teamBRoles = teamB.map(p => getRoleChar((mokiSpecialties[p.token_id.toString()] || 'BALANCED') as MokiSpecialty)).sort().join("+");
    const forwardKey = `${teamARoles}|${teamBRoles}`;
    const reverseKey = `${teamBRoles}|${teamARoles}`;
    const fwd = statsData.headToHead[forwardKey];
    const rev = statsData.headToHead[reverseKey];
    let compWR: number | null = null;
    const gamesCount = fwd?.games || rev?.games || 0;
    if (fwd && fwd.games >= 8) {
      compWR = (fwd.winsA / fwd.games) * 100;
    } else if (rev && rev.games >= 8) {
      compWR = ((rev.games - rev.winsA) / rev.games) * 100;
    }
    if (compWR !== null) {
      const compWeight = gamesCount >= 15 ? 0.30 : 0.20;
      winProbabilityA = winProbabilityA * (1 - compWeight) + compWR * compWeight;
    }
  }

  // Team performance comparison: actual in-game stats (all members) vs opponent team
  const teamAPerf = teamA.reduce((acc, p) => {
    const s = allStats[p.moki_id];
    if (s && s.games_played >= 5) {
      acc.elim += s.avg_eliminations; acc.depo += s.avg_deposits; acc.wart += s.avg_wart; acc.count++;
    }
    return acc;
  }, { elim: 0, depo: 0, wart: 0, count: 0 });
  const teamBPerf = teamB.reduce((acc, p) => {
    const s = allStats[p.moki_id];
    if (s && s.games_played >= 5) {
      acc.elim += s.avg_eliminations; acc.depo += s.avg_deposits; acc.wart += s.avg_wart; acc.count++;
    }
    return acc;
  }, { elim: 0, depo: 0, wart: 0, count: 0 });
  if (teamAPerf.count >= 3 && teamBPerf.count >= 3) {
    const ae = teamAPerf.elim / teamAPerf.count, be = teamBPerf.elim / teamBPerf.count;
    const ad = teamAPerf.depo / teamAPerf.count, bd = teamBPerf.depo / teamBPerf.count;
    const aw = teamAPerf.wart / teamAPerf.count, bw = teamBPerf.wart / teamBPerf.count;
    const perfScore = ((ae / (ae + be + 0.001)) + (ad / (ad + bd + 0.001)) + (aw / (aw + bw + 0.001))) / 3;
    winProbabilityA = winProbabilityA * 0.90 + (perfScore * 100) * 0.10;
  }

  // Team 1 (A) structural advantage: wins ~60% of matches historically.
  // Shift center to 62%, amplify stat+H2H signal at 1.5x.
  const statSignal = winProbabilityA - 50;
  const finalProbA = Math.max(2, Math.min(98, 62 + statSignal * 1.5));
  const finalProbB = 100 - finalProbA;

  const calculatePoints = (prob: number, players: MokiPlayer[]) => {
    const champion = players.find(p => p.is_champion);
    if (!champion) return 0;
    const stats = allStats[champion.moki_id];
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
  allStats: Record<string, DFSStats>,
  counterMap: any = {},
  statsData?: StatsData,
  statMap?: Record<string, MokiStats>
): ChampGridRow[] => {
  return displayChampions.map(champ => {
    const champMatches = scheduledMatches
      .filter(m => m.players.some(p => p.moki_id === champ.moki_id))
      .sort((a, b) => a.match.match_id.localeCompare(b.match.match_id))
      .slice(0, 10);

    const matchResults = champMatches.map(m => {
      const pred = calculatePredictiveAdvantage(m, allStats, mokiSpecialties, counterMap, statsData, statMap);
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
  allStats: Record<string, DFSStats>,
  counterMap: any = {},
  statsData?: StatsData,
  statMap?: Record<string, MokiStats>
): WindowGridRow[] => {
  return displayChampions.map(champ => {
    const champMatches = scheduledMatches
      .filter(m => m.players.some(p => p.moki_id === champ.moki_id))
      .sort((a, b) => a.match.match_id.localeCompare(b.match.match_id));

    const getWindowPoints = (matchesSlice: MatchData[]) => {
      return matchesSlice.reduce((sum, m) => {
        const pred = calculatePredictiveAdvantage(m, allStats, mokiSpecialties, counterMap, statsData, statMap);
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
