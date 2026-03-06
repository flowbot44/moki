import { describe, it, expect } from 'vitest';
import { 
  canonicalizeComp, 
  scoreMatchup, 
  poissonBinomial, 
  scoreSchedule
} from '../lib/matchupScore';
import type { Role, StatsData } from '../lib/matchupScore';

describe('canonicalizeComp', () => {
  it('sorts roles alphabetically and joins with +', () => {
    expect(canonicalizeComp(["W", "E", "E"])).toBe("E+E+W");
    expect(canonicalizeComp(["S", "D", "W"])).toBe("D+S+W");
    expect(canonicalizeComp(["E", "E", "E"])).toBe("E+E+E");
  });
});

describe('scoreMatchup', () => {
  const mockData: StatsData = {
    composition: {
      "E+E+W": { wins: 600, games: 1000 },
      "D+S+S": { wins: 400, games: 1000 },
    },
    headToHead: {
      "E+E+W|D+S+S": { winsA: 35, games: 50 }
    }
  };

  it('computes basic smoothed stats and falls back to h2h forward', () => {
    const score = scoreMatchup(["W", "E", "E"], ["S", "S", "D"], mockData);
    expect(score.canonicalA).toBe("E+E+W");
    expect(score.canonicalB).toBe("D+S+S");
    expect(score.used_h2h).toBe(true);
    
    // Check confidence uses the 50 h2h games. tau=100 -> 1 - exp(-0.5)
    const expectedConf = 1 - Math.exp(-50 / 100);
    expect(score.confidence).toBeCloseTo(expectedConf, 4);
    expect(score.predicted_win_pct).toBeGreaterThan(50); // E+E+W should be favored
  });

  it('uses reverse lookup for h2h correctly', () => {
    // A=D+S+S, B=E+E+W -> headToHead is stored as E+E+W|D+S+S
    const score = scoreMatchup(["S", "S", "D"], ["W", "E", "E"], mockData);
    expect(score.used_h2h).toBe(true);
    expect(score.debug.gamesAB).toBe(50);
    expect(score.debug.winsA_vs_B).toBe(15); // 50 - 35
  });

  it('handles no head-to-head data gracefully', () => {
    const score = scoreMatchup(["E", "E", "E"], ["S", "S", "D"], mockData);
    expect(score.used_h2h).toBe(false);
    expect(score.debug.gamesAB).toBe(0);
    expect(score.confidence).toBe(0); // exp(0) = 1, 1-1=0
    expect(score.safe_score).toBe(score.predicted_win_pct);
  });

  it('handles completely unknown compositions gracefully', () => {
    const score = scoreMatchup(["D", "D", "D"], ["W", "W", "W"], mockData);
    expect(score.used_h2h).toBe(false);
    // Since both have 0 games, p_smooth should be near p0 (0.5)
    // p_exp should be 0.5 -> 50%
    expect(score.predicted_win_pct).toBeCloseTo(50, 2);
  });
});

describe('poissonBinomial', () => {
  it('computes exact probability for small arrays', () => {
    const probs = [0.5, 0.5];
    // 0 wins: 0.25, 1 win: 0.5, 2 wins: 0.25
    expect(poissonBinomial(probs, 0)).toBeCloseTo(0.25, 4);
    expect(poissonBinomial(probs, 1)).toBeCloseTo(0.75, 4); // <= 1 win
    expect(poissonBinomial(probs, 2)).toBeCloseTo(1.0, 4);  // <= 2 wins
  });

  it('handles certainty', () => {
    const probs = [1.0, 1.0, 0.0];
    // exactly 2 wins is 100%
    expect(poissonBinomial(probs, 1)).toBeCloseTo(0.0, 4);
    expect(poissonBinomial(probs, 2)).toBeCloseTo(1.0, 4);
  });
});

describe('scoreSchedule', () => {
  const mockData: StatsData = {
    composition: {
      "E+E+W": { wins: 60, games: 100 },
      "D+S+S": { wins: 40, games: 100 },
    },
    headToHead: {}
  };

  const games = [
    { team: ["E", "E", "W"] as Role[], opponent: ["D", "S", "S"] as Role[] },
    { team: ["E", "E", "W"] as Role[], opponent: ["D", "S", "S"] as Role[] }
  ];

  it('computes expected wins and aggregates', () => {
    const schedule = scoreSchedule(games, mockData);
    // 2 games of the same matchup
    // p will be > 0.5 since E+E+W is better than D+S+S
    expect(schedule.expected_wins).toBeGreaterThan(1);
    expect(schedule.top_3_easiest.length).toBe(2);
    expect(schedule.bottom_3_hardest.length).toBe(2);
  });
});
