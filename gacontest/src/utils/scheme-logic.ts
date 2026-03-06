import type { DFSStats, ChampionTrait, Scheme } from '../types';

export const isChampionInScheme = (
  championName: string,
  scheme: Scheme,
  championTraits: ChampionTrait[]
): boolean => {
  const traits = championTraits.find(t => t.name === championName)?.traits || [];
  
  // Check for exact matches
  const exactMatch = scheme.exactTraits?.some(keyword => 
    traits.some(t => t.toLowerCase() === keyword.toLowerCase())
  );

  // Check for partial matches
  const partialMatch = scheme.traits?.some(keyword => 
    traits.some(t => t.toLowerCase().includes(keyword.toLowerCase()))
  );

  return !!(exactMatch || partialMatch);
};

export const filterByScheme = (
  stats: DFSStats[],
  scheme: Scheme | undefined,
  championTraits: ChampionTrait[]
) => {
  if (!scheme) return stats;

  return stats.filter(s => {
    // If scheme has trait requirements, check them
    if (scheme.exactTraits || scheme.traits) {
      return isChampionInScheme(s.name, scheme, championTraits);
    }
    // If it's a stat-only scheme, it includes everyone by default for filtering
    return true;
  });
};

export const sortByScheme = (
  stats: DFSStats[],
  scheme: Scheme | undefined
) => {
  if (!scheme || !scheme.sortKey) {
    return [...stats].sort((a, b) => b.total_points - a.total_points);
  }

  return [...stats].sort((a, b) => {
    const valA = a[scheme.sortKey!] as number;
    const valB = b[scheme.sortKey!] as number;
    return valB - valA;
  });
};
