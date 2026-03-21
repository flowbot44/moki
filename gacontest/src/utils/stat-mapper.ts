export interface MokiStats {
  strength: number;
  speed: number;
  defense: number;
  dexterity: number;
  fortitude: number;
}

/**
 * v5.4 - Post-patch recalibration (2026-03-17)
 * Reduced multipliers after Moki class-awareness update caused overconfidence.
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

    // STR = Buff form movement speed (primary combat stat)
    // DEF = Buff transformation time + Wart riding speed.
    //       Higher DEF → faster into Buff form → more elim opportunities.
    //       Contributes to both ELIM and WART.
    // FORT = respawn time + deposit speed
    const elim = (avg.str * 0.75) + (avg.def * 0.20) + (avg.fort * 0.05);
    // Gacha: DEX (carry speed) + FORT (deposit speed + respawn)
    const gacha = (avg.dex * 0.65) + (avg.fort * 0.35);
    // Wart: DEF (riding speed) dominant, STR secondary
    const wart = (avg.def * 0.65) + (avg.str * 0.35);

    return { elim, gacha, wart };
  };

  const a = getPower(teamA);
  const b = getPower(teamB);

  // Multiplicative multipliers for archetypes
  let multA = 1.0;
  let multB = 1.0;

  // Archetype advantage thresholds (v5.4 — recalibrated post-patch 2026-03-17)
  // Mokis now commit more decisively to class objectives, so advantages are real
  // but the extreme multipliers caused overconfidence (85% predicted → 64% actual)
  const ELIM_THRESHOLD = 25;
  const GACHA_THRESHOLD = 30;
  const WART_THRESHOLD = 45;

  if (a.elim > b.elim + ELIM_THRESHOLD) multA *= 1.3; // BULLY
  if (b.elim > a.elim + ELIM_THRESHOLD) multB *= 1.3;

  if (a.gacha > b.gacha + GACHA_THRESHOLD) multA *= 1.4; // SCORER
  if (b.gacha > a.gacha + GACHA_THRESHOLD) multB *= 1.4;

  if (a.wart > b.wart + WART_THRESHOLD) multA *= 2.5; // TANK
  if (b.wart > a.wart + WART_THRESHOLD) multB *= 2.5;

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
