import React, { useState, useEffect, useMemo } from 'react';
import pako from 'pako';
import { fetchLatest, fetchPartition } from './utils/data-fetcher';
import type { MatchData, DFSStats, MokiPlayer, ChampionTrait, Scheme, MokiSpecialty, SynergyGridRow, WindowGridRow } from './types';
import { calculateDFSPoints } from './utils/dfs-scoring';
import { generatePredictionGrid, generateTripleWindowGrid, calculatePredictiveAdvantage, generateSynergyGrid } from './utils/predictive-engine';
import { MATCHUP_WIN_RATES } from './utils/composition-data';
import { filterByScheme, sortByScheme, isChampionInScheme } from './utils/scheme-logic';
import { MatchupScorer } from './components/MatchupScorer';
import { ScheduleCompare } from './components/ScheduleCompare';
import { scoreMatchup } from './lib/matchupScore';
import type { StatsData, Role } from './lib/matchupScore';
import { Zap, Loader2, BarChart3, Binary, LayoutGrid, Target, Sparkles, Activity, User, Calendar, Columns, ChevronDown, ChevronUp, UserSearch, TrendingUp, AlertTriangle, Users, ArrowLeft, Calculator } from 'lucide-react';

type SortKey = 'total_points' | 'win_rate' | 'avg_eliminations' | 'avg_wart' | 'avg_deposits' | 'volatility';
type WindowSortKey = 'w1Points' | 'w2Points' | 'w3Points' | 'totalPoints';
type SynergySortKey = 'w1Synergy' | 'w2Synergy' | 'w3Synergy' | 'totalSynergy';
type ViewMode = 'STATS' | 'PREDICTIONS' | 'DETAIL' | 'SCORER';
type GridMode = 'WINDOWS' | 'MATRIX' | 'SYNERGY';

const App: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('STATS');
  const [gridMode, setGridMode] = useState<GridMode>('SYNERGY');
  const [matches, setMatches] = useState<MatchData[]>([]);
  const [championsStats, setChampionsStats] = useState<DFSStats[]>([]);
  const [championTraits, setChampionTraits] = useState<ChampionTrait[]>([]);
  const [schemes, setSchemes] = useState<Scheme[]>([]);
  const [synergyMap, setSynergyMap] = useState<Record<string, { wins: number; games: number }>>({});
  const [counterMap, setCounterMap] = useState<Record<string, { wins: number; games: number }>>({});
  const [mokiSpecialties, setMokiSpecialties] = useState<Record<string, MokiSpecialty>>({});
  const [error, setError] = useState<string | null>(null);
  
  const [sortConfig, setSortConfig] = useState<{ key: SortKey; direction: 'desc' | 'asc' }>({ key: 'total_points', direction: 'desc' });
  const [windowSortConfig, setWindowSortConfig] = useState<{ key: WindowSortKey; direction: 'desc' | 'asc' }>({ key: 'totalPoints', direction: 'desc' });
  const [synergySortConfig, setSynergySortConfig] = useState<{ key: SynergySortKey; direction: 'desc' | 'asc' }>({ key: 'totalSynergy', direction: 'desc' });
  const [minWinRate, setMinWinRate] = useState<number>(0);
  const [selectedSchemeName, setSelectedSchemeName] = useState<string>('');
  const [selectedSpecialty, setSelectedSpecialty] = useState<string>('');
  const [targetStartDate, setTargetStartDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [selectedChampion, setSelectedChampion] = useState<string | null>(null);

  // --- Helpers ---
  const getChampionTraitSchemes = (name: string) => {
    return schemes.filter(s => (s.traits || s.exactTraits) && isChampionInScheme(name, s, championTraits));
  };

  const getChampSpecialtyLabel = (name: string) => {
    const stats = championsStats.find(s => s.name === name);
    let tokenId = stats?.token_id;
    
    if (!tokenId) {
      const champMatch = matches.find(m => m.players.some(p => p.name === name && p.is_champion));
      const player = champMatch?.players.find(p => p.name === name);
      tokenId = player?.token_id;
    }

    if (!tokenId) return 'N/A';
    const spec = mokiSpecialties[tokenId.toString()];
    if (spec === 'ELIM_SPECIALIST') return 'ELIM';
    if (spec === 'GACHA_SPECIALIST') return 'DEPO';
    if (spec === 'WART_SPECIALIST') return 'WART';
    return 'SUPP';
  };

  const getVolatilityIcon = (vol: number) => {
    if (vol > 150) return <AlertTriangle size={12} className="text-red-500" />;
    if (vol > 80) return <Activity size={12} className="text-yellow-500" />;
    return <Zap size={12} className="text-[#00ff41] opacity-50" />;
  };

  const getHeatColor = (adv: number) => {
    if (adv > 10) return 'bg-[#00ff41] text-[#0d0208] font-bold';
    if (adv > 5) return 'bg-[#00cc34] text-[#0d0208]';
    if (adv > 0) return 'bg-[#008f25] text-white';
    if (adv > -5) return 'bg-[#1a331e] text-[#00ff41] opacity-80';
    return 'bg-[#3d0d0d] text-[#ff3131]';
  };

  const getSynergyHeatColor = (diff: number) => {
    if (diff >= 2) return 'bg-[#00ff41] text-[#0d0208] font-bold';
    if (diff >= 1) return 'bg-[#00cc34] text-[#0d0208]';
    if (diff > 0) return 'bg-[#008f25] text-white';
    if (diff === 0) return 'bg-black text-terminal-green opacity-40';
    if (diff <= -2) return 'bg-[#3d0d0d] text-[#ff3131]';
    return 'bg-[#1a331e] text-[#00ff41] opacity-80';
  };

  const getWindowHeatColor = (points: number) => {
    if (points > 3500) return 'bg-[#00ff41] text-[#0d0208] font-bold shadow-[inset_0_0_10px_rgba(0,0,0,0.5)]';
    if (points > 3000) return 'bg-[#00cc34] text-[#0d0208]';
    if (points > 2000) return 'bg-[#008f25] text-white';
    return 'bg-[#1a331e] text-[#00ff41] opacity-60';
  };

  useEffect(() => {
    const init = async () => {
      try {
        setLoading(true);
        const latest = await fetchLatest();
        const mokiTotalsUrl = `https://flowbot44.github.io/grand-arena-builder-skill/data/${latest.moki_totals.url}`;
        const [mokiStatsRes, traitsRes, schemesRes] = await Promise.all([
          fetch(mokiTotalsUrl), fetch('/champions.json'), fetch('/schemes.json')
        ]);
        const mokiBaseStats = await mokiStatsRes.json();
        const traits = await traitsRes.json();
        const schemeList = await schemesRes.json();
        setChampionTraits(traits);
        setSchemes(schemeList);

        const specialties: Record<string, MokiSpecialty> = {};
        mokiBaseStats.data.forEach((m: any) => {
          const str = m.totals.strength || 0;
          const dex = m.totals.dexterity || 0;
          const def = m.totals.defense || 0;
          const sorted = [{ type: 'ELIM_SPECIALIST', val: str }, { type: 'GACHA_SPECIALIST', val: dex }, { type: 'WART_SPECIALIST', val: def }].sort((a, b) => b.val - a.val);
          if (Math.abs(sorted[0].val - sorted[1].val) <= 5) specialties[m.tokenId.toString()] = 'BALANCED';
          else specialties[m.tokenId.toString()] = sorted[0].type as MokiSpecialty;
        });
        setMokiSpecialties(specialties);

        const activePartitions = latest.partitions.filter((p: any) => p.match_count > 0).slice(-7);
        const allData = await Promise.all(activePartitions.map((p: any) => fetchPartition(p.url)));
        const flatData = allData.flat();
        setMatches(flatData);
        processStats(flatData, specialties);
      } catch (err) {
        setError('CRITICAL_SYSTEM_ERROR: UNABLE TO RETRIEVE CAREER_DATA');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    init();
  }, []);

  const processStats = (data: MatchData[], specialties: Record<string, MokiSpecialty>) => {
    const statsMap: { [id: string]: DFSStats & { wins: number; recentWins: number; recentGames: number; scores: number[] } } = {};
    const synergies: Record<string, { wins: number; games: number }> = {};
    const counters: Record<string, { wins: number; games: number }> = {};
    const allDates = Array.from(new Set(data.map(m => m.match.match_date))).sort();
    const recentThreshold = allDates.slice(-2)[0] || "";

    data.filter(m => m.match.state === 'scored').forEach((m) => {
      const isWinner = m.match.team_won;
      const isRecent = m.match.match_date >= recentThreshold;
      const team1 = m.players.filter(p => p.team === 1);
      const team2 = m.players.filter(p => p.team === 2);

      const processLineup = (players: MokiPlayer[], teamNum: number, opponents: MokiPlayer[]) => {
        const teamWon = isWinner === teamNum;
        const champion = players.find(p => p.is_champion);
        const oppChampion = opponents.find(p => p.is_champion);
        const teammates = players.filter(p => !p.is_champion);

        players.forEach((p) => {
          if (!statsMap[p.moki_id]) {
            statsMap[p.moki_id] = {
              moki_id: p.moki_id, token_id: p.token_id, name: p.name, is_champion: p.is_champion === 1,
              total_points: 0, games_played: 0, avg_deposits: 0, avg_eliminations: 0, avg_wart: 0, 
              win_rate: 0, wins: 0, recentWins: 0, recentGames: 0, momentum: 0, confidence: 0, volatility: 0, scores: []
            };
          }
          const stats = statsMap[p.moki_id];
          const performance = m.performances.find((perf) => perf.moki_id === p.moki_id);
          const score = calculateDFSPoints(performance, m.match, teamNum);
          stats.total_points += score;
          stats.scores.push(score);
          stats.games_played += 1;
          if (teamWon) stats.wins += 1;
          if (isRecent) {
            stats.recentGames += 1;
            if (teamWon) stats.recentWins += 1;
          }
          if (performance) {
            stats.avg_deposits += performance.deposits || 0;
            stats.avg_eliminations += performance.eliminations || 0;
            stats.avg_wart += performance.wart_distance || 0;
          }
        });

        if (champion) {
          teammates.forEach(tm => {
            const spec = specialties[tm.token_id.toString()] || 'BALANCED';
            const specKey = `${champion.name}|${spec}`;
            synergies[specKey] = synergies[specKey] || { wins: 0, games: 0 };
            synergies[specKey].games++;
            if (teamWon) synergies[specKey].wins++;
            const classKey = `${champion.name}|${tm.class}`;
            synergies[classKey] = synergies[classKey] || { wins: 0, games: 0 };
            synergies[classKey].games++;
            if (teamWon) synergies[classKey].wins++;
          });
          if (oppChampion) {
            const matchup = `${champion.name} vs ${oppChampion.name}`;
            counters[matchup] = counters[matchup] || { wins: 0, games: 0 };
            counters[matchup].games++;
            if (teamWon) counters[matchup].wins++;
          }
        }
      };
      processLineup(team1, 1, team2);
      processLineup(team2, 2, team1);
    });

    const finalized = Object.values(statsMap).map(s => {
      const overallWR = (s.wins / s.games_played) * 100;
      const recentWR = s.recentGames > 0 ? (s.recentWins / s.recentGames) * 100 : overallWR;
      const avg = s.total_points / s.games_played;
      const squareDiffs = s.scores.map(score => Math.pow(score - avg, 2));
      const variance = squareDiffs.reduce((a, b) => a + b, 0) / s.games_played;
      return {
        ...s, win_rate: overallWR, momentum: recentWR - overallWR,
        confidence: Math.min(100, (s.games_played / 50) * 100),
        volatility: Math.sqrt(variance),
        avg_deposits: s.avg_deposits / s.games_played,
        avg_eliminations: s.avg_eliminations / s.games_played,
        avg_wart: s.avg_wart / s.games_played,
      };
    });

    setChampionsStats(finalized.filter(s => s.is_champion));
    setSynergyMap(synergies);
    setCounterMap(counters);
  };

  const availableFutureDates = useMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    const dates = Array.from(new Set(matches.filter(m => m.match.state === 'scheduled' && m.match.match_date >= today).map(m => m.match.match_date))).sort();
    return dates;
  }, [matches]);

  const selectedScheme = useMemo(() => schemes.find(s => s.name === selectedSchemeName), [schemes, selectedSchemeName]);

  const groupedSchemes = useMemo(() => {
    const trait = schemes.filter(s => s.traits || s.exactTraits).sort((a, b) => a.name.localeCompare(b.name));
    const match = schemes.filter(s => !s.traits && !s.exactTraits).sort((a, b) => a.name.localeCompare(b.name));
    return { trait, match };
  }, [schemes]);

  const filteredAndSorted = useMemo(() => {
    let result = championsStats.filter(s => s.win_rate >= minWinRate);
    if (selectedScheme) result = filterByScheme(result, selectedScheme, championTraits);
    if (selectedSpecialty) {
      result = result.filter(s => mokiSpecialties[s.token_id.toString()] === selectedSpecialty);
    }
    return selectedScheme ? sortByScheme(result, selectedScheme) : [...result].sort((a, b) => {
      const modifier = sortConfig.direction === 'asc' ? 1 : -1;
      return (a[sortConfig.key] < b[sortConfig.key]) ? -modifier : modifier;
    });
  }, [championsStats, selectedScheme, selectedSpecialty, minWinRate, championTraits, sortConfig, mokiSpecialties]);

  const predictionGrid = useMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    const startFilter = targetStartDate || today;
    const scheduled = matches.filter(m => m.match.state === 'scheduled' && m.match.match_date >= startFilter);
    const grid = generatePredictionGrid(scheduled, filteredAndSorted, mokiSpecialties, championsStats, counterMap);
    const hasStatSort = selectedScheme && selectedScheme.sortKey;
    return hasStatSort ? grid : [...grid].sort((a, b) => b.totalXPoints - a.totalXPoints);
  }, [matches, targetStartDate, filteredAndSorted, mokiSpecialties, championsStats, selectedScheme, counterMap]);

  const tripleWindowGrid = useMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    const startFilter = targetStartDate || today;
    const allDailyMatches = matches.filter(m => m.match.match_date === startFilter);
    const grid = generateTripleWindowGrid(allDailyMatches, filteredAndSorted, mokiSpecialties, championsStats, counterMap);
    return [...grid].sort((a, b) => {
      const modifier = windowSortConfig.direction === 'asc' ? 1 : -1;
      return (a[windowSortConfig.key] < b[windowSortConfig.key]) ? -modifier : modifier;
    });
  }, [matches, targetStartDate, filteredAndSorted, mokiSpecialties, championsStats, windowSortConfig, counterMap]);

  const statsData = useMemo<StatsData>(() => {
    const composition: Record<string, { wins: number; games: number }> = {};
    const headToHead: Record<string, { winsA: number; games: number }> = {};

    const getRoleChar = (spec: MokiSpecialty): Role => {
      if (spec === 'ELIM_SPECIALIST') return 'E';
      if (spec === 'GACHA_SPECIALIST') return 'D';
      if (spec === 'WART_SPECIALIST') return 'W';
      return 'S';
    };

    matches.filter(m => m.match.state === 'scored').forEach(m => {
      const team1Roles = m.players.filter(p => p.team === 1).map(p => getRoleChar(mokiSpecialties[p.token_id.toString()] || 'BALANCED')).sort();
      const team2Roles = m.players.filter(p => p.team === 2).map(p => getRoleChar(mokiSpecialties[p.token_id.toString()] || 'BALANCED')).sort();
      
      const comp1 = team1Roles.join("+");
      const comp2 = team2Roles.join("+");

      // Update compositions
      composition[comp1] = composition[comp1] || { wins: 0, games: 0 };
      composition[comp2] = composition[comp2] || { wins: 0, games: 0 };
      composition[comp1].games++;
      composition[comp2].games++;
      if (m.match.team_won === 1) composition[comp1].wins++;
      if (m.match.team_won === 2) composition[comp2].wins++;

      // Update head-to-head
      const h2hKey = `${comp1}|${comp2}`;
      headToHead[h2hKey] = headToHead[h2hKey] || { winsA: 0, games: 0 };
      headToHead[h2hKey].games++;
      if (m.match.team_won === 1) headToHead[h2hKey].winsA++;
    });

    return { composition, headToHead };
  }, [matches, mokiSpecialties]);

  const synergyGrid = useMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    const startFilter = targetStartDate || today;
    const scheduled = matches.filter(m => m.match.state === 'scheduled' && m.match.match_date >= startFilter);
    const grid = generateSynergyGrid(scheduled, filteredAndSorted, mokiSpecialties, statsData);
    return [...grid].sort((a, b) => {
      const modifier = synergySortConfig.direction === 'asc' ? 1 : -1;
      return (a[synergySortConfig.key] < b[synergySortConfig.key]) ? -modifier : modifier;
    });
  }, [matches, targetStartDate, filteredAndSorted, mokiSpecialties, synergySortConfig, statsData]);

  const predictionAccuracy = useMemo(() => {
    const scored = matches.filter(m => m.match.state === 'scored' && m.match.team_won !== null);
    if (scored.length === 0) return 0;
    let correct = 0;
    scored.forEach(m => {
      const pred = calculatePredictiveAdvantage(m, championsStats, mokiSpecialties, counterMap);
      const predictedWinner = pred.advantage > 0 ? 1 : 2;
      if (m.match.team_won === predictedWinner) correct++;
    });
    return (correct / scored.length) * 100;
  }, [matches, championsStats, mokiSpecialties, counterMap]);

  const handleWindowSort = (key: WindowSortKey) => {
    setWindowSortConfig(prev => ({ key, direction: prev.key === key && prev.direction === 'desc' ? 'asc' : 'desc' }));
  };

  const handleSynergySort = (key: SynergySortKey) => {
    setSynergySortConfig(prev => ({ key, direction: prev.key === key && prev.direction === 'desc' ? 'asc' : 'desc' }));
  };

  const handleSort = (key: SortKey) => {
    setSortConfig(prev => ({ key, direction: prev.key === key && prev.direction === 'desc' ? 'asc' : 'desc' }));
  };

  const handleSelectChampion = (name: string) => {
    console.log('handleSelectChampion triggered for:', name);
    setSelectedChampion(name);
    setViewMode('DETAIL');
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen text-terminal-green font-mono">
        <div className="text-2xl animate-pulse"><Loader2 className="animate-spin inline mr-2" /> BOOTING_SYSTEM_v3.3...</div>
      </div>
    );
  }

  return (
    <div className="p-2 md:p-4 w-full max-w-[98vw] mx-auto overflow-hidden">
      <header className="terminal-header flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4 px-2">
        <div>
          <h1 className="text-3xl font-bold tracking-tighter text-terminal-green uppercase italic shadow-green-500/20 shadow-sm">Grand_Arena // Role_Engine_v3.3</h1>
          <div className="text-sm opacity-70 flex flex-wrap items-center gap-4 font-mono">
            <span>STATUS: <span className="text-white">ONLINE</span></span>
            <span className="flex items-center gap-1 text-cyan-400"><TrendingUp size={14} /> FULL_WIDTH_OPTIMIZED</span>
            <span className="text-cyan-400 border border-cyan-900 px-1 text-[10px]">v3.3_WIDE_STABLE</span>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setViewMode('STATS')} className={`terminal-button flex items-center gap-2 ${viewMode === 'STATS' ? 'bg-green-900/40 shadow-[0_0_10px_rgba(0,255,65,0.3)]' : ''}`}><BarChart3 size={16} /> CORE_STATS</button>
          <button onClick={() => setViewMode('PREDICTIONS')} className={`terminal-button flex items-center gap-2 ${viewMode === 'PREDICTIONS' ? 'bg-green-900/40 shadow-[0_0_10px_rgba(0,255,65,0.3)]' : ''}`}><Binary size={16} /> ADVANTAGE_GRID</button>
          <button onClick={() => setViewMode('SCORER')} className={`terminal-button flex items-center gap-2 ${viewMode === 'SCORER' ? 'bg-green-900/40 shadow-[0_0_10px_rgba(0,255,65,0.3)]' : ''}`}><Calculator size={16} /> MATCHUP_LAB</button>
        </div>
      </header>

      {viewMode !== 'DETAIL' && viewMode !== 'SCORER' && (
        <div className="terminal-card mb-8 grid grid-cols-1 md:grid-cols-3 gap-8 bg-green-900/5 items-center border-double border-4">
          <div className="flex flex-col gap-2">
            <label className="text-[10px] font-bold flex items-center gap-2 opacity-70"><Target className="text-cyan-400" size={14} /> SCHEME_FOCUS</label>
            <select value={selectedSchemeName} onChange={(e) => setSelectedSchemeName(e.target.value)} className="w-full text-sm p-2 font-mono border border-terminal-green bg-black text-terminal-green outline-none">
              <option value="">-- ALL_CHAMPIONS --</option>
              <optgroup label="[ TRAIT_BASED ]" className="bg-black text-cyan-400">
                {groupedSchemes.trait.map(s => <option key={s.name} value={s.name}>{s.name.toUpperCase()}</option>)}
              </optgroup>
              <optgroup label="[ MATCH_BASED ]" className="bg-black text-yellow-400">
                {groupedSchemes.match.map(s => <option key={s.name} value={s.name}>{s.name.toUpperCase()}</option>)}
              </optgroup>
            </select>
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-[10px] font-bold flex items-center gap-2 opacity-70"><UserSearch className="text-yellow-400" size={14} /> ROLE_FILTER</label>
            <select value={selectedSpecialty} onChange={(e) => setSelectedSpecialty(e.target.value)} className="w-full text-sm p-2 font-mono border border-terminal-green bg-black text-terminal-green outline-none">
              <option value="">-- ALL_ROLES --</option>
              <option value="ELIM_SPECIALIST">ELIMINATORS</option>
              <option value="GACHA_SPECIALIST">DEPOSITERS</option>
              <option value="WART_SPECIALIST">WART_RIDERS</option>
              <option value="BALANCED">SUPPORT</option>
            </select>
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-[10px] font-bold opacity-70 uppercase">Win_Rate_Threshold (%)</label>
            <input type="range" min="0" max="100" step="5" value={minWinRate} onChange={(e) => setMinWinRate(Number(e.target.value))} className="w-full accent-terminal-green" />
            <div className="text-right text-[10px] font-mono">{minWinRate}% MIN_WR</div>
          </div>
        </div>
      )}

      {viewMode === 'STATS' && (
        <section className="w-full">
          <h2 className="text-xl mb-4 border-b border-terminal-green flex items-center gap-2 text-terminal-green font-black"><LayoutGrid className="text-yellow-400" size={20} /> HISTORIC_7DAY_DATALINK</h2>
          <div className="terminal-card !p-0 border-t-0 w-full overflow-x-auto">
            <table className="w-full text-left border-collapse font-mono text-xs">
              <thead>
                <tr className="border-b border-terminal-green bg-green-900/20 uppercase">
                  <th className="p-4 border-r border-green-900/30 min-w-[200px]">Champion_ID</th>
                  <th className="p-4 border-r border-green-900/30 cursor-pointer hover:bg-green-900/40" onClick={() => handleSort('win_rate')}>
                    Win_Rate {sortConfig.key === 'win_rate' && <span className="text-cyan-400">{sortConfig.direction === 'desc' ? '▼' : '▲'}</span>}
                  </th>
                  <th className="p-4 border-r border-green-900/30 cursor-pointer hover:bg-green-900/40" onClick={() => handleSort('volatility')}>
                    Volatility {sortConfig.key === 'volatility' && <span className="text-cyan-400">{sortConfig.direction === 'desc' ? '▼' : '▲'}</span>}
                  </th>
                  <th className="p-4 border-r border-green-900/30 cursor-pointer hover:bg-green-900/40" onClick={() => handleSort('momentum')}>
                    Momentum {sortConfig.key === 'momentum' && <span className="text-cyan-400">{sortConfig.direction === 'desc' ? '▼' : '▲'}</span>}
                  </th>
                  <th className="p-4 border-r border-green-900/30 text-center cursor-pointer hover:bg-green-900/40" onClick={() => handleSort('avg_eliminations')}>
                    Elims {sortConfig.key === 'avg_eliminations' && <span className="text-cyan-400">{sortConfig.direction === 'desc' ? '▼' : '▲'}</span>}
                  </th>
                  <th className="p-4 border-r border-green-900/30 text-center cursor-pointer hover:bg-green-900/40" onClick={() => handleSort('avg_deposits')}>
                    Deps {sortConfig.key === 'avg_deposits' && <span className="text-cyan-400">{sortConfig.direction === 'desc' ? '▼' : '▲'}</span>}
                  </th>
                  <th className="p-4 border-r border-green-900/30 text-center cursor-pointer hover:bg-green-900/40" onClick={() => handleSort('avg_wart')}>
                    Wart {sortConfig.key === 'avg_wart' && <span className="text-cyan-400">{sortConfig.direction === 'desc' ? '▼' : '▲'}</span>}
                  </th>
                  <th className="p-4 bg-green-900/30 text-right cursor-pointer hover:bg-green-900/60" onClick={() => handleSort('total_points')}>
                    Total_DFS {sortConfig.key === 'total_points' && <span className="text-cyan-400">{sortConfig.direction === 'desc' ? '▼' : '▲'}</span>}
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredAndSorted.map((champ) => (
                  <tr key={champ.moki_id} className="border-b border-green-900/10 hover-row transition-all">
                    <td className="p-4 font-bold border-r border-green-900/10 cursor-pointer hover:bg-green-900/10" onClick={() => handleSelectChampion(champ.name)}>
                      <div className="flex items-center gap-2"><Sparkles size={12} className="text-yellow-500 opacity-50" /> {champ.name}</div>
                      <div className="text-[9px] opacity-40 mt-1">ROLE: {getChampSpecialtyLabel(champ.name)}</div>
                    </td>
                    <td className="p-4 border-r border-green-900/10">{champ.win_rate.toFixed(1)}%</td>
                    <td className="p-4 border-r border-green-900/10"><div className="flex items-center gap-2">{getVolatilityIcon(champ.volatility)} {champ.volatility.toFixed(1)}</div></td>
                    <td className={`p-4 border-r border-green-900/10 ${champ.momentum > 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {champ.momentum > 0 ? '+' : ''}{champ.momentum.toFixed(1)}%
                    </td>
                    <td className="p-4 border-r border-green-900/10 text-center">{champ.avg_eliminations.toFixed(1)}</td>
                    <td className="p-4 border-r border-green-900/10 text-center">{champ.avg_deposits.toFixed(1)}</td>
                    <td className="p-4 border-r border-green-900/10 text-center">{champ.avg_wart.toFixed(1)}</td>
                    <td className="p-4 positive font-bold text-right">+{champ.total_points.toFixed(0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {viewMode === 'PREDICTIONS' && (
        <section className="w-full">
          <div className="flex justify-between items-center mb-4 border-b border-terminal-green pb-2 px-2">
            <div className="flex items-center gap-4 flex-wrap">
              <h2 className="text-xl flex items-center gap-2 text-terminal-green font-black"><Binary className="text-cyan-400" size={20} /> PREDICTIVE_MATRICES</h2>
              {predictionAccuracy > 0 && <div className="text-[10px] font-mono border border-cyan-900 px-2 py-0.5 bg-cyan-900/10 text-cyan-400">ACCURACY: {predictionAccuracy.toFixed(1)}%</div>}
              <div className="flex bg-black border border-terminal-green p-0.5">
                <button onClick={() => setGridMode('WINDOWS')} className={`px-3 py-1 text-[9px] font-mono flex items-center gap-1 ${gridMode === 'WINDOWS' ? 'bg-green-900/60 text-white' : 'opacity-40'}`}><Columns size={10} /> WINDOW_SORTER</button>
                <button onClick={() => setGridMode('MATRIX')} className={`px-3 py-1 text-[9px] font-mono flex items-center gap-1 ${gridMode === 'MATRIX' ? 'bg-green-900/60 text-white' : 'opacity-40'}`}><LayoutGrid size={10} /> 10_GAME_MATRIX</button>
                <button onClick={() => setGridMode('SYNERGY')} className={`px-3 py-1 text-[9px] font-mono flex items-center gap-1 ${gridMode === 'SYNERGY' ? 'bg-green-900/60 text-white' : 'opacity-40'}`}><Users size={10} /> SYNERGY_SCORE</button>
              </div>
            </div>
            <div className="flex items-center gap-2 font-mono text-[10px]">
              <Calendar size={12} className="text-cyan-400"/> START_POINT:
              <select value={targetStartDate} onChange={(e) => setTargetStartDate(e.target.value)} className="bg-black border border-terminal-green text-terminal-green text-[10px] p-1 outline-none">
                <option value="">-- LATEST_PENDING --</option>
                {availableFutureDates.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
          </div>

          <div className="terminal-card !p-0 border-t-0 shadow-lg w-full overflow-x-auto">
            {gridMode === 'WINDOWS' ? (
              <table className="w-full border-collapse font-mono text-xs">
                <thead>
                  <tr className="border-b border-terminal-green bg-green-900/20 text-center uppercase">
                    <th className="p-4 text-left min-w-[250px] sticky left-0 bg-black border-r border-terminal-green z-10">Champion_ID</th>
                    <th className="p-4 border-r border-green-900/30 cursor-pointer hover:bg-green-900/40" onClick={() => handleWindowSort('w1Points')}>W1_POINTS {windowSortConfig.key === 'w1Points' && <span className="text-cyan-400">{windowSortConfig.direction === 'desc' ? '▼' : '▲'}</span>}</th>
                    <th className="p-4 border-r border-green-900/30 cursor-pointer hover:bg-green-900/40" onClick={() => handleWindowSort('w2Points')}>W2_POINTS {windowSortConfig.key === 'w2Points' && <span className="text-cyan-400">{windowSortConfig.direction === 'desc' ? '▼' : '▲'}</span>}</th>
                    <th className="p-4 border-r border-green-900/30 cursor-pointer hover:bg-green-900/40" onClick={() => handleWindowSort('w3Points')}>W3_POINTS {windowSortConfig.key === 'w3Points' && <span className="text-cyan-400">{windowSortConfig.direction === 'desc' ? '▼' : '▲'}</span>}</th>
                    <th className="p-4 bg-green-900/40 font-black cursor-pointer hover:bg-green-900/60" onClick={() => handleWindowSort('totalPoints')}>TOTAL_DAY_EV {windowSortConfig.key === 'totalPoints' && <span className="text-cyan-400">{windowSortConfig.direction === 'desc' ? '▼' : '▲'}</span>}</th>
                  </tr>
                </thead>
                <tbody>
                  {tripleWindowGrid.map((row) => (
                    <tr key={row.championName} className="border-b border-green-900/20 hover-row transition-colors group">
                      <td className="p-4 sticky left-0 bg-black border-r border-terminal-green z-10 cursor-pointer hover:bg-green-900/10" onClick={() => handleSelectChampion(row.championName)}>
                        <div className="font-bold text-sm">{row.championName} <span className="opacity-40 text-[9px] italic">[{getChampSpecialtyLabel(row.championName)}]</span></div>
                        <div className="flex flex-wrap gap-1 mt-2 items-center">
                          {getChampionTraitSchemes(row.championName).map((s, idx, arr) => (
                            <React.Fragment key={s.name}>
                              <span className="text-[8px] px-1 border border-cyan-900 text-cyan-400 uppercase leading-none py-0.5 bg-cyan-950/20">{s.name.split(' ')[0]}</span>
                              {idx < arr.length - 1 && <span className="text-cyan-900 text-[8px]">|</span>}
                            </React.Fragment>
                          ))}
                        </div>
                      </td>
                      <td className={`p-6 border-r border-green-900/10 text-center transition-all ${getWindowHeatColor(row.w1Points)}`}>
                        <div className="text-2xl font-black tracking-widest">{row.w1Points.toFixed(0)}</div>
                      </td>
                      <td className={`p-6 border-r border-green-900/10 text-center transition-all ${getWindowHeatColor(row.w2Points)}`}>
                        <div className="text-2xl font-black tracking-widest">{row.w2Points.toFixed(0)}</div>
                      </td>
                      <td className={`p-6 border-r border-green-900/10 text-center transition-all ${getWindowHeatColor(row.w3Points)}`}>
                        <div className="text-2xl font-black tracking-widest">{row.w3Points.toFixed(0)}</div>
                      </td>
                      <td className="p-4 font-bold text-center text-lg positive border-l border-green-900/30 bg-green-950/10">+{row.totalPoints.toFixed(0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : gridMode === 'MATRIX' ? (
              <table className="w-full border-collapse font-mono text-xs">
                <thead>
                  <tr className="border-b border-terminal-green bg-green-900/20 text-center uppercase">
                    <th className="p-4 text-left min-w-[250px] sticky left-0 bg-black border-r border-terminal-green z-10">Champion_ID</th>
                    {[...Array(10)].map((_, i) => (<th key={i} className="p-4 border-r border-green-900/30">M{i+1}</th>))}
                    <th className="p-4 bg-green-900/40 font-black">TOTAL_EV_PTS</th>
                  </tr>
                </thead>
                <tbody>
                  {predictionGrid.map((row) => (
                    <tr key={row.championName} className="border-b border-green-900/20 hover-row transition-colors group">
                      <td className="p-4 sticky left-0 bg-black border-r border-terminal-green z-10 cursor-pointer hover:bg-green-900/10" onClick={() => handleSelectChampion(row.championName)}>
                        <div className="font-bold text-sm">{row.championName} <span className="opacity-40 text-[9px] italic">[{getChampSpecialtyLabel(row.championName)}]</span></div>
                        <div className="flex flex-wrap gap-1 mt-2 items-center">
                          {getChampionTraitSchemes(row.championName).map((s, idx, arr) => (
                            <React.Fragment key={s.name}>
                              <span className="text-[8px] px-1 border border-cyan-900 text-cyan-400 uppercase leading-none py-0.5 bg-cyan-950/20">{s.name.split(' ')[0]}</span>
                              {idx < arr.length - 1 && <span className="text-cyan-900 text-[8px]">|</span>}
                            </React.Fragment>
                          ))}
                        </div>
                      </td>
                      {row.matches.map((m, i) => (
                        <td key={i} className={`p-2 border-r border-green-900/10 text-center transition-all ${getHeatColor(m.adv)}`}>
                          <div className="truncate w-full max-w-[60px] mx-auto opacity-50 text-[8px]">{m.oppName.split(' ')[0]}</div>
                          <div className="font-bold text-sm">{m.xPoints.toFixed(0)}</div>
                        </td>
                      ))}
                      {[...Array(Math.max(0, 10 - row.matches.length))].map((_, i) => (<td key={i + row.matches.length} className="p-2 border-r border-green-900/10 opacity-10 text-center">N/A</td>))}
                      <td className="p-4 font-bold text-center text-sm positive bg-green-950/10">+{row.totalXPoints.toFixed(0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <table className="w-full border-collapse font-mono text-xs">
                <thead>
                  <tr className="border-b border-terminal-green bg-green-900/20 text-center uppercase">
                    <th className="p-4 text-left min-w-[250px] sticky left-0 bg-black border-r border-terminal-green z-10">Champion_ID</th>
                    <th className="p-4 border-r border-green-900/30 cursor-pointer hover:bg-green-900/40" onClick={() => handleSynergySort('w1Synergy')}>W1_SYN {synergySortConfig.key === 'w1Synergy' && <span className="text-cyan-400">{synergySortConfig.direction === 'desc' ? '▼' : '▲'}</span>}</th>
                    <th className="p-4 border-r border-green-900/30 cursor-pointer hover:bg-green-900/40" onClick={() => handleSynergySort('w2Synergy')}>W2_SYN {synergySortConfig.key === 'w2Synergy' && <span className="text-cyan-400">{synergySortConfig.direction === 'desc' ? '▼' : '▲'}</span>}</th>
                    <th className="p-4 border-r border-green-900/30 cursor-pointer hover:bg-green-900/40" onClick={() => handleSynergySort('w3Synergy')}>W3_SYN {synergySortConfig.key === 'w3Synergy' && <span className="text-cyan-400">{synergySortConfig.direction === 'desc' ? '▼' : '▲'}</span>}</th>
                    <th className="p-4 bg-green-900/40 font-black cursor-pointer hover:bg-green-900/60" onClick={() => handleSynergySort('totalSynergy')}>TOTAL_SYN_DIFF {synergySortConfig.key === 'totalSynergy' && <span className="text-cyan-400">{synergySortConfig.direction === 'desc' ? '▼' : '▲'}</span>}</th>
                  </tr>
                </thead>
                <tbody>
                  {synergyGrid.map((row) => (
                    <tr key={row.championName} className="border-b border-green-900/20 hover-row transition-colors group">
                      <td className="p-4 sticky left-0 bg-black border-r border-terminal-green z-10 cursor-pointer hover:bg-green-900/10" onClick={() => handleSelectChampion(row.championName)}>
                        <div className="font-bold text-sm">{row.championName} <span className="opacity-40 text-[9px] italic">[{getChampSpecialtyLabel(row.championName)}]</span></div>
                        <div className="flex flex-wrap gap-1 mt-2 items-center">
                          {getChampionTraitSchemes(row.championName).map((s, idx, arr) => (
                            <React.Fragment key={s.name}>
                              <span className="text-[8px] px-1 border border-cyan-900 text-cyan-400 uppercase leading-none py-0.5 bg-cyan-950/20">{s.name.split(' ')[0]}</span>
                              {idx < arr.length - 1 && <span className="text-cyan-900 text-[8px]">|</span>}
                            </React.Fragment>
                          ))}
                        </div>
                      </td>
                      <td className={`p-6 border-r border-green-900/10 text-center transition-all ${getSynergyHeatColor(row.w1Synergy / 10)}`}>
                        <div className="text-2xl font-black tracking-widest">{row.w1Synergy > 0 ? '+' : ''}{row.w1Synergy.toFixed(1)}</div>
                      </td>
                      <td className={`p-6 border-r border-green-900/10 text-center transition-all ${getSynergyHeatColor(row.w2Synergy / 10)}`}>
                        <div className="text-2xl font-black tracking-widest">{row.w2Synergy > 0 ? '+' : ''}{row.w2Synergy.toFixed(1)}</div>
                      </td>
                      <td className={`p-6 border-r border-green-900/10 text-center transition-all ${getSynergyHeatColor(row.w3Synergy / 10)}`}>
                        <div className="text-2xl font-black tracking-widest">{row.w3Synergy > 0 ? '+' : ''}{row.w3Synergy.toFixed(1)}</div>
                      </td>
                      <td className={`p-4 font-bold text-center text-lg border-l border-green-900/30 bg-green-950/10 ${row.totalSynergy > 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {row.totalSynergy > 0 ? '+' : ''}{row.totalSynergy.toFixed(1)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      )}

      {viewMode === 'SCORER' && (
        <section className="w-full flex flex-col gap-8">
          <h2 className="text-xl border-b border-terminal-green flex items-center gap-2 text-terminal-green font-black pb-2 px-2"><Calculator className="text-cyan-400" size={20} /> MATCHUP_SIMULATOR_LAB</h2>
          <div className="flex flex-col gap-8">
            <MatchupScorer data={statsData} />
            <ScheduleCompare data={statsData} />
          </div>
        </section>
      )}

      {viewMode === 'DETAIL' && selectedChampion && (
        <ChampionDetailView 
          championName={selectedChampion} 
          matches={matches} 
          mokiSpecialties={mokiSpecialties} 
          statsData={statsData}
          onBack={() => setViewMode('PREDICTIONS')}
          getChampSpecialtyLabel={getChampSpecialtyLabel}
          getSynergyHeatColor={getSynergyHeatColor}
        />
      )}

      <footer className="mt-12 pt-4 border-t border-terminal-green text-center text-[9px] opacity-40 font-mono tracking-widest uppercase">
        System_Protocol_v3.3 // Neural_Network_Stable // Wide_Width_Mapping_Active
      </footer>
    </div>
  );
};

interface ChampionDetailViewProps {
  championName: string;
  matches: MatchData[];
  mokiSpecialties: Record<string, MokiSpecialty>;
  statsData: StatsData;
  onBack: () => void;
  getChampSpecialtyLabel: (name: string) => string;
  getSynergyHeatColor: (diff: number) => string;
}

const ChampionDetailView: React.FC<ChampionDetailViewProps> = ({ championName, matches, mokiSpecialties, statsData, onBack, getChampSpecialtyLabel, getSynergyHeatColor }) => {
  const [activeTab, setActiveTab] = useState<'PAST' | 'FUTURE'>('FUTURE');
  const [expandedMatch, setExpandedMatch] = useState<string | null>(null);
  
  const getMatchupDetails = (teamPlayers: MokiPlayer[], oppPlayers: MokiPlayer[]) => {
    const getRoleChar = (spec: MokiSpecialty): Role => {
      if (spec === 'ELIM_SPECIALIST') return 'E';
      if (spec === 'GACHA_SPECIALIST') return 'D';
      if (spec === 'WART_SPECIALIST') return 'W';
      return 'S';
    };

    const myRoles = teamPlayers.map(p => getRoleChar(mokiSpecialties[p.token_id.toString()] || 'BALANCED'));
    const oppRoles = oppPlayers.map(p => getRoleChar(mokiSpecialties[p.token_id.toString()] || 'BALANCED'));
    
    const result = scoreMatchup(myRoles, oppRoles, statsData);
    return {
      result,
      score: (result.predicted_win_pct - 50) / 10,
      myRoles,
      oppRoles
    };
  };

  const pastGames = useMemo(() => {
    return matches.filter(m => 
      m.match.state === 'scored' && 
      m.players.some(p => p.name === championName)
    ).sort((a, b) => b.match.match_date.localeCompare(a.match.match_date)).slice(0, 10);
  }, [championName, matches]);

  const futureGames = useMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    return matches.filter(m => 
      m.match.state === 'scheduled' && 
      m.match.match_date >= today &&
      m.players.some(p => p.name === championName)
    ).sort((a, b) => a.match.match_id.localeCompare(b.match.match_id)).slice(0, 30);
  }, [championName, matches]);

  const renderMatchList = (matchList: MatchData[], isPast: boolean) => (
    <div className="terminal-card !p-0 overflow-x-auto">
      <table className="w-full border-collapse font-mono text-xs">
        <thead>
          <tr className="border-b border-terminal-green bg-green-900/10 uppercase text-left">
            <th className="p-4 w-10"></th>
            <th className="p-4">Match_ID</th>
            <th className="p-4">Date</th>
            <th className="p-4">Opponent</th>
            {isPast && <th className="p-4 text-right">Result</th>}
            <th className="p-4 text-right">Matchup_Score</th>
          </tr>
        </thead>
        <tbody>
          {matchList.map((m, i) => {
            const team1 = m.players.filter(p => p.team === 1);
            const team2 = m.players.filter(p => p.team === 2);
            const me = m.players.find(p => p.name === championName);
            const isTeam1 = me?.team === 1;
            const myTeam = isTeam1 ? team1 : team2;
            const oppTeam = isTeam1 ? team2 : team1;
            
            const { result, score, myRoles, oppRoles } = getMatchupDetails(myTeam, oppTeam);
            const oppChamp = m.players.find(p => p.is_champion && p.name !== championName);
            const won = isPast ? m.match.team_won === me?.team : null;
            const isExpanded = expandedMatch === m.match.match_id;

            return (
              <React.Fragment key={m.match.match_id}>
                <tr 
                  className={`border-b border-green-900/5 hover:bg-green-900/10 transition-colors cursor-pointer ${isExpanded ? 'bg-green-900/20' : ''}`}
                  onClick={() => setExpandedMatch(isExpanded ? null : m.match.match_id)}
                >
                  <td className="p-4 text-center opacity-40">
                    {isExpanded ? '▼' : '▶'}
                  </td>
                  <td className="p-4 opacity-40">{isPast ? 'HIST' : 'PROJ'}_{i+1}</td>
                  <td className="p-4 whitespace-nowrap">{m.match.match_date}</td>
                  <td className="p-4 font-bold text-cyan-400">{oppChamp ? oppChamp.name : "Team"}</td>
                  {isPast && (
                    <td className={`p-4 text-right font-black ${won ? 'text-green-400' : 'text-red-400'}`}>
                      {won ? 'WIN' : 'LOSS'}
                    </td>
                  )}
                  <td className={`p-4 text-right font-bold ${getSynergyHeatColor(score)}`}>
                    {score > 0 ? '+' : ''}{score.toFixed(1)}
                  </td>
                </tr>
                {isExpanded && (
                  <tr className="bg-green-900/5 border-b border-green-900/20">
                    <td colSpan={isPast ? 6 : 5} className="p-6">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        <div className="md:col-span-2 mb-6">
                          <h4 className="text-terminal-green font-bold mb-3 uppercase border-b border-terminal-green/30 pb-1">Matchup_Composition_Comparison</h4>
                          <div className="grid grid-cols-[1fr_40px_1fr] bg-black/40 border border-terminal-green/10 rounded-lg overflow-hidden">
                            <div className="p-4 border-r border-terminal-green/5">
                              <div className="text-[10px] font-black text-terminal-green/60 uppercase tracking-widest mb-3 text-center">Ally_Lineup</div>
                              <div className="flex flex-wrap justify-center gap-2 items-center">
                                {myRoles.map((r, idx) => {
                                  const label = r === 'E' ? 'Eliminator' : r === 'D' ? 'Depositor' : r === 'W' ? 'Wart' : 'Support';
                                  const colorClass = r === 'E' ? 'bg-red-500/20 text-red-400 border-red-500/30' : r === 'D' ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' : r === 'W' ? 'bg-blue-500/20 text-blue-400 border-blue-500/30' : 'bg-terminal-green/20 text-terminal-green border-terminal-green/30';
                                  return (
                                    <React.Fragment key={idx}>
                                      <span className={`px-3 py-1 border font-bold rounded-sm text-[10px] uppercase tracking-tighter ${colorClass}`}>{label}</span>
                                      {idx < myRoles.length - 1 && <span className="opacity-20 text-[10px]">•</span>}
                                    </React.Fragment>
                                  );
                                })}
                              </div>
                            </div>

                            <div className="flex items-center justify-center bg-terminal-green/5 border-x border-terminal-green/10">
                              <span className="text-[10px] font-black opacity-30 -rotate-90 uppercase">VS</span>
                            </div>

                            <div className="p-4 border-l border-terminal-green/5">
                              <div className="text-[10px] font-black text-red-500/60 uppercase tracking-widest mb-3 text-center">Opponent_Lineup</div>
                              <div className="flex flex-wrap justify-center gap-2 items-center">
                                {oppRoles.map((r, idx) => {
                                  const label = r === 'E' ? 'Eliminator' : r === 'D' ? 'Depositor' : r === 'W' ? 'Wart' : 'Support';
                                  const colorClass = r === 'E' ? 'bg-red-500/20 text-red-400 border-red-500/30' : r === 'D' ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' : r === 'W' ? 'bg-blue-500/20 text-blue-400 border-blue-500/30' : 'bg-terminal-green/20 text-terminal-green border-terminal-green/30';
                                  return (
                                    <React.Fragment key={idx}>
                                      <span className={`px-3 py-1 border font-bold rounded-sm text-[10px] uppercase tracking-tighter ${colorClass}`}>{label}</span>
                                      {idx < oppRoles.length - 1 && <span className="opacity-20 text-[10px]">•</span>}
                                    </React.Fragment>
                                  );
                                })}
                              </div>
                            </div>
                          </div>
                        </div>

                        <div>
                          <h4 className="text-terminal-green font-bold mb-3 uppercase border-b border-terminal-green/30 pb-1">Probability_Metrics</h4>
                          <div className="space-y-2 text-[10px]">
                            <div className="flex justify-between">
                              <span className="opacity-60">Win_Probability_Raw:</span>
                              <span className="text-cyan-400 font-bold">{result.predicted_win_pct.toFixed(1)}%</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="opacity-60">System_Confidence:</span>
                              <span className="text-cyan-400 font-bold">{(result.confidence * 100).toFixed(1)}%</span>
                            </div>
                            <div className="flex justify-between border-t border-terminal-green/20 pt-2 mt-2">
                              <span className="opacity-60">Adjusted_Matchup_Score:</span>
                              <span className={`font-bold ${getSynergyHeatColor(score)}`}>{score.toFixed(1)}</span>
                            </div>
                          </div>
                        </div>
                        <div>
                          <h4 className="text-terminal-green font-bold mb-3 uppercase border-b border-terminal-green/30 pb-1">Reasoning_Engine</h4>
                          <div className="text-[10px] space-y-3">
                            <p className="opacity-80 leading-relaxed italic">
                              {result.used_h2h 
                                ? `Found ${result.debug.gamesAB} direct historical encounters between these specific compositions. Head-to-head win rate is ${(result.debug.winsA_vs_B / result.debug.gamesAB * 100).toFixed(1)}%.`
                                : `No direct head-to-head data available for these exact compositions. Score is based on general composition performance archetypes.`}
                            </p>
                            <div className="p-3 bg-black/40 border border-terminal-green/20 rounded">
                              <div className="flex justify-between mb-1">
                                <span className="opacity-50">Ally_Comp_Global_Winrate:</span>
                                <span>{(result.debug.p_smoothA * 100).toFixed(1)}%</span>
                              </div>
                              <div className="flex justify-between mb-1">
                                <span className="opacity-50">Opponent_Comp_Global_Winrate:</span>
                                <span>{(result.debug.p_smoothB * 100).toFixed(1)}%</span>
                              </div>
                              <div className="flex justify-between mt-2 border-t border-terminal-green/10 pt-1">
                                <span className="opacity-50 italic">Comp_vs_Comp_Expected:</span>
                                <span className="text-cyan-400">{(result.debug.p_exp * 100).toFixed(1)}%</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
          {matchList.length === 0 && (
            <tr>
              <td colSpan={isPast ? 6 : 5} className="p-12 text-center opacity-30 italic">NO_DATA_AVAILABLE_FOR_CURRENT_SELECTION</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="animate-in fade-in duration-500">
      <div className="flex justify-between items-center mb-6 border-b-2 border-terminal-green pb-4">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="terminal-button flex items-center gap-2">
            <ArrowLeft size={16} /> BACK_TO_FLEET
          </button>
          <div>
            <h2 className="text-2xl font-black text-terminal-green uppercase">CHAMPION_DEEP_DIVE: {championName}</h2>
            <div className="text-xs opacity-60 font-mono">ROLE: {getChampSpecialtyLabel(championName)} // LIVE_SYSTEM_PROJECTION</div>
          </div>
        </div>
      </div>

      <div className="flex bg-black border border-terminal-green mb-6 p-1 w-fit">
        <button onClick={() => setActiveTab('FUTURE')} className={`px-6 py-2 text-xs font-bold transition-all ${activeTab === 'FUTURE' ? 'bg-terminal-green text-black' : 'text-terminal-green hover:bg-green-900/20'}`}>NEXT_30_PROJECTION</button>
        <button onClick={() => setActiveTab('PAST')} className={`px-6 py-2 text-xs font-bold transition-all ${activeTab === 'PAST' ? 'bg-terminal-green text-black' : 'text-terminal-green hover:bg-green-900/20'}`}>LAST_10_HISTORY</button>
      </div>
      
      {activeTab === 'FUTURE' ? renderMatchList(futureGames, false) : renderMatchList(pastGames, true)}
    </div>
  );
};

export default App;