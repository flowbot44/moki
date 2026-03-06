export type Role = "E" | "S" | "W" | "D";

export interface StatsData {
  composition: Record<string, { wins: number; games: number }>;
  headToHead: Record<string, { winsA: number; games: number }>;
  totals?: { wins: number; games: number };
}

export interface MatchupScore {
  predicted_win_pct: number;
  confidence: number;
  safe_score: number;
  canonicalA: string;
  canonicalB: string;
  used_h2h: boolean;
  debug: {
    p0: number;
    p_smoothA: number;
    p_smoothB: number;
    RA: number;
    RB: number;
    p_exp: number;
    gamesAB: number;
    winsA_vs_B: number;
    p_h2h_smooth: number;
  };
}

export interface ScheduledGame {
  team: Role[];
  opponent: Role[];
  meta?: { date?: string; opponentName?: string };
}

export interface ScheduleOptions {
  K?: number;
  lambda?: number;
}

export interface ScheduleScore {
  expected_wins: number;
  expected_wins_adj: number;
  std_dev_wins: number;
  std_dev_wins_adj: number;
  chance_at_most_K: number;
  chance_at_most_K_adj: number;
  schedule_value_score: number;
  schedule_value_score_adj: number;
  top_3_easiest: (ScheduledGame & { p: number; p_adj: number })[];
  bottom_3_hardest: (ScheduledGame & { p: number; p_adj: number })[];
}

export interface ScheduleCompareResult {
  scheduleA: ScheduleScore;
  scheduleB: ScheduleScore;
}

export function canonicalizeComp(roles: Role[]): string {
  return [...roles].sort().join("+");
}

function clamp(val: number, min: number, max: number) {
  return Math.max(min, Math.min(max, val));
}

function sigmoid(x: number) {
  return 1 / (1 + Math.exp(-x));
}

export function scoreMatchup(teamA: Role[], teamB: Role[], data: StatsData): MatchupScore {
  const canonicalA = canonicalizeComp(teamA);
  const canonicalB = canonicalizeComp(teamB);

  let totalWins = 0;
  let totalGames = 0;
  if (data.totals) {
    totalWins = data.totals.wins;
    totalGames = data.totals.games;
  } else {
    for (const key in data.composition) {
      totalWins += data.composition[key].wins;
      totalGames += data.composition[key].games;
    }
  }

  const p0 = totalGames > 0 ? totalWins / totalGames : 0.5;

  const k = 50;
  const compA = data.composition[canonicalA] || { wins: 0, games: 0 };
  const compB = data.composition[canonicalB] || { wins: 0, games: 0 };

  const p_smoothA = clamp((compA.wins + k * p0) / (compA.games + k), 1e-6, 1 - 1e-6);
  const p_smoothB = clamp((compB.wins + k * p0) / (compB.games + k), 1e-6, 1 - 1e-6);

  const RA = Math.log(p_smoothA / (1 - p_smoothA));
  const RB = Math.log(p_smoothB / (1 - p_smoothB));

  const p_exp = sigmoid(RA - RB);

  let winsA_vs_B = 0;
  let gamesAB = 0;
  let used_h2h = false;

  const forwardKey = `${canonicalA}|${canonicalB}`;
  const reverseKey = `${canonicalB}|${canonicalA}`;

  if (data.headToHead[forwardKey]) {
    winsA_vs_B = data.headToHead[forwardKey].winsA;
    gamesAB = data.headToHead[forwardKey].games;
    used_h2h = true;
  } else if (data.headToHead[reverseKey]) {
    gamesAB = data.headToHead[reverseKey].games;
    winsA_vs_B = gamesAB - data.headToHead[reverseKey].winsA;
    used_h2h = true;
  }

  const k_h = 75;
  const p_h2h_smooth = used_h2h 
    ? (winsA_vs_B + k_h * p_exp) / (gamesAB + k_h)
    : p_exp;

  const predicted_win_pct = 100 * p_h2h_smooth;
  
  const tau = 100;
  const confidence = 1 - Math.exp(-gamesAB / tau);
  
  // Adjusted to be less conservative - removing the -15 penalty
  let safe_score = predicted_win_pct; 
  safe_score = clamp(safe_score, 0, 100);

  return {
    predicted_win_pct,
    confidence,
    safe_score,
    canonicalA,
    canonicalB,
    used_h2h,
    debug: {
      p0,
      p_smoothA,
      p_smoothB,
      RA,
      RB,
      p_exp,
      gamesAB,
      winsA_vs_B,
      p_h2h_smooth
    }
  };
}

export function poissonBinomial(probs: number[], K: number): number {
  if (probs.length === 0) return 1;
  const dp = new Array(probs.length + 1).fill(0);
  dp[0] = 1;
  
  for (const p of probs) {
    for (let j = probs.length; j > 0; j--) {
      dp[j] = dp[j] * (1 - p) + dp[j - 1] * p;
    }
    dp[0] = dp[0] * (1 - p);
  }
  
  let probAtMostK = 0;
  for (let j = 0; j <= Math.min(K, probs.length); j++) {
    probAtMostK += dp[j];
  }
  return probAtMostK;
}

export function scoreSchedule(games: ScheduledGame[], data: StatsData, opts?: ScheduleOptions): ScheduleScore {
  const K = opts?.K ?? 4;
  const lambda = opts?.lambda ?? 0.75;

  let expected_wins = 0;
  let expected_wins_adj = 0;
  let variance_wins = 0;
  let variance_wins_adj = 0;
  
  const rawProbs: number[] = [];
  const adjProbs: number[] = [];
  const gameDetails: (ScheduledGame & { p: number; p_adj: number })[] = [];

  for (const game of games) {
    const score = scoreMatchup(game.team, game.opponent, data);
    const p = score.predicted_win_pct / 100;
    const p_adj = 0.5 + score.confidence * (p - 0.5);

    rawProbs.push(p);
    adjProbs.push(p_adj);
    
    expected_wins += p;
    expected_wins_adj += p_adj;
    
    variance_wins += p * (1 - p);
    variance_wins_adj += p_adj * (1 - p_adj);

    gameDetails.push({ ...game, p, p_adj });
  }

  const std_dev_wins = Math.sqrt(variance_wins);
  const std_dev_wins_adj = Math.sqrt(variance_wins_adj);

  const chance_at_most_K = poissonBinomial(rawProbs, K);
  const chance_at_most_K_adj = poissonBinomial(adjProbs, K);

  const schedule_value_score = expected_wins - lambda * std_dev_wins;
  const schedule_value_score_adj = expected_wins_adj - lambda * std_dev_wins_adj;

  const sortedGames = [...gameDetails].sort((a, b) => b.p - a.p);
  const top_3_easiest = sortedGames.slice(0, 3);
  const bottom_3_hardest = sortedGames.slice().reverse().slice(0, 3);

  return {
    expected_wins,
    expected_wins_adj,
    std_dev_wins,
    std_dev_wins_adj,
    chance_at_most_K,
    chance_at_most_K_adj,
    schedule_value_score,
    schedule_value_score_adj,
    top_3_easiest,
    bottom_3_hardest
  };
}

export function compareSchedules(a: ScheduledGame[], b: ScheduledGame[], data: StatsData, opts?: ScheduleOptions): ScheduleCompareResult {
  return {
    scheduleA: scoreSchedule(a, data, opts),
    scheduleB: scoreSchedule(b, data, opts)
  };
}
