import type { MokiPerformance, MokiMatch } from '../types';

// Updated DFS Scoring System
export const DFS_SCORING = {
  WIN: 300,
  ELIMINATION: 80,
  DEPOSIT: 50,
  WART_UNIT_DISTANCE: 80,
  WART_POINTS_PER_UNIT: 45
};

export const calculateDFSPoints = (
  performance: MokiPerformance | undefined,
  match: MokiMatch,
  playerTeam: number
) => {
  let score = 0;

  // 300 points for a win
  if (match.state === 'scored' && match.team_won === playerTeam) {
    score += DFS_SCORING.WIN;
  }

  if (performance) {
    // 50 points for a deposit
    score += (performance.deposits || 0) * DFS_SCORING.DEPOSIT;
    
    // 80 points for an elim
    score += (performance.eliminations || 0) * DFS_SCORING.ELIMINATION;
    
    // 45 points for every 80 units of wart riding (no fractional points)
    const wartUnits = Math.floor((performance.wart_distance || 0) / DFS_SCORING.WART_UNIT_DISTANCE);
    score += wartUnits * DFS_SCORING.WART_POINTS_PER_UNIT;
  }

  return score;
};
