export interface MokiPerformance {
  moki_id: string;
  token_id: number;
  match_id: string;
  match_date: string;
  deposits: number;
  eliminations: number;
  wart_distance: number;
  win_type: string;
}

export interface MokiPlayer {
  moki_id: string;
  token_id: number;
  name: string;
  class: string;
  image_url: string;
  is_champion: number;
  team: number;
}

export interface MokiMatch {
  match_id: string;
  match_date: string;
  state: 'scheduled' | 'scored';
  team_won: number | null;
  win_type: string | null;
  game_type: string;
}

export interface MatchData {
  match: MokiMatch;
  players: MokiPlayer[];
  performances: MokiPerformance[];
}

export type MokiSpecialty = 'ELIM_SPECIALIST' | 'GACHA_SPECIALIST' | 'WART_SPECIALIST' | 'BALANCED';

export interface ChampionTrait {
  id: number;
  name: string;
  traits: string[];
}

export interface Scheme {
  name: string;
  description: string;
  traits?: string[];
  exactTraits?: string[];
  sortKey?: keyof DFSStats;
}

export interface PredictiveMatchup {
  matchId: string;
  matchDate: string;
  teamA: {
    players: MokiPlayer[];
    winProbability: number;
    pointsExpected: number;
  };
  teamB: {
    players: MokiPlayer[];
    winProbability: number;
    pointsExpected: number;
  };
  advantage: number; // Positive means Team A has advantage
}

export interface WindowGridRow {
  championName: string;
  w1Points: number;
  w2Points: number;
  w3Points: number;
  totalPoints: number;
}

export interface SynergyGridRow {
  championName: string;
  w1Synergy: number;
  w2Synergy: number;
  w3Synergy: number;
  totalSynergy: number;
}

export interface DFSStats {
  moki_id: string;
  token_id: number;
  name: string;
  is_champion: boolean;
  total_points: number;
  games_played: number;
  avg_deposits: number;
  avg_eliminations: number;
  avg_wart: number;
  win_rate: number;
  momentum: number; // Difference between last 48h and last 7d
  confidence: number; // Based on sample size
  volatility: number; // Standard deviation of scores
}
