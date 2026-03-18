export interface MokiStats {
  strength: number;
  speed: number;
  defense: number;
  dexterity: number;
  fortitude: number;
}

/**
 * v5.3 - High-Impact Archetype Engine
 */

export const calculateStatSynergy = (teamA: MokiStats[], teamB: MokiStats[]) => {
  if (teamA.length === 0 || teamB.length === 0) return 0.5;

  const getPower = (team: MokiStats[]) => {
    const avg = {
      str: team.reduce((s, m) => s + (m.strength || 0), 0) / 3,
      def: team.reduce((s, m) => s + (m.defense || 0), 0) / 3,
      dex: team.reduce((s, m) => s + (m.dexterity || 0), 0) / 3,
      fort: team.reduce((s, m) => s + (m.fortitude || 0), 0) / 3,
    };

    // Data analysis: elim wins → STR dominant (+33.6), SPD negatively correlated (-18.0, removed)
    const elim = (avg.str * 0.85) + (avg.def * 0.1) + (avg.fort * 0.05);
    // Gacha: DEX+71.7, FORT+28.1 positive
    const gacha = (avg.dex * 0.7) + (avg.fort * 0.3);
    // Wart: DEF+94, STR+49 dominate
    const wart = (avg.def * 0.65) + (avg.str * 0.35);

    return { elim, gacha, wart };
  };

  const a = getPower(teamA);
  const b = getPower(teamB);

  // Multiplicative multipliers for archetypes
  let multA = 1.0;
  let multB = 1.0;

  // Archetype advantage thresholds (tuned from data analysis)
  // Elim threshold lowered: avg STR diff for elim winners is ~29 (under old 40 threshold)
  const ELIM_THRESHOLD = 20;
  const GACHA_THRESHOLD = 25;
  const WART_THRESHOLD = 35;

  if (a.elim > b.elim + ELIM_THRESHOLD) multA *= 1.4; // BULLY
  if (b.elim > a.elim + ELIM_THRESHOLD) multB *= 1.4;

  // Gacha/Wart advantages are decisive (DEX+71, DEF+94 in data) — higher multipliers
  if (a.gacha > b.gacha + GACHA_THRESHOLD) multA *= 1.8; // SCORER
  if (b.gacha > a.gacha + GACHA_THRESHOLD) multB *= 1.8;

  if (a.wart > b.wart + WART_THRESHOLD) multA *= 9.0; // TANK
  if (b.wart > a.wart + WART_THRESHOLD) multB *= 9.0;

  // Second win condition penalty: one-dimensional elim teams (high STR, low DEF) that earned
  // an elim multiplier lose some of that edge when the opponent has meaningful wart capability.
  // Pure bruisers can only win one way; if the opponent can pivot to wart they exploit that.

  const scoreA = (a.elim + a.gacha + a.wart) * multA;
  const scoreB = (b.elim + b.gacha + b.wart) * multB;

  return scoreA / (scoreA + scoreB);
};

export const compareTeamStats = (teamA: MokiStats[], teamB: MokiStats[]) => {
  return calculateStatSynergy(teamA, teamB);
};

export const calculateRolePotential = (s: MokiStats) => {
  return {
    elim: (s.strength * 0.7) + (s.speed * 0.3),
    depo: (s.dexterity * 0.7) + (s.fortitude * 0.3),
    wart: s.defense
  };
};
