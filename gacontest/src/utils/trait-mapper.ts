import type { ChampionTrait } from '../types';

/**
 * A helper to quickly lookup traits by champion name
 */
export const createTraitMap = (champions: ChampionTrait[]) => {
  const map: Record<string, string[]> = {};
  champions.forEach(c => {
    map[c.name] = c.traits || [];
  });
  return map;
};

/**
 * Calculates a synergy score based on shared traits within a lineup
 */
export const calculateTraitSynergy = (lineupNames: string[], traitMap: Record<string, string[]>) => {
  const traitCounts: Record<string, number> = {};
  lineupNames.forEach(name => {
    const traits = traitMap[name] || [];
    traits.forEach(t => {
      // Ignore very common traits like "Common", "Normal", "Defender", "Striker" 
      // as they don't provide much "special" synergy
      if (['Common', 'Normal', 'Defender', 'Striker', 'Sprinter', 'Bruiser', 'Divine', 'Lucky'].includes(t)) return;
      
      traitCounts[t] = (traitCounts[t] || 0) + 1;
    });
  });

  // Calculate score: bonus for every trait shared by 2 or more mokis
  let bonus = 0;
  Object.values(traitCounts).forEach(count => {
    if (count >= 2) {
      bonus += (count - 1) * 0.05; // 5% boost per overlapping member
    }
  });

  return Math.min(0.25, bonus); // Cap at 25% boost
};
