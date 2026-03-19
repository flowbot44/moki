import React, { useState, useEffect, useMemo } from 'react';
import { Routes, Route, useNavigate, useLocation, useParams, Navigate } from 'react-router-dom';
import { fetchLatest, fetchPartition, DATA_URL } from './utils/data-fetcher';
import type { MatchData, DFSStats, MokiPlayer, ChampionTrait, Scheme, MokiSpecialty } from './types';
import type { MokiStats } from './utils/stat-mapper';
import { calculateDFSPoints } from './utils/dfs-scoring';
import { generateTripleWindowGrid, calculatePredictiveAdvantage, generateSynergyGrid } from './utils/predictive-engine';
import { runTrueBacktest } from './utils/backtest-logic';
import { filterByScheme, sortByScheme, isChampionInScheme } from './utils/scheme-logic';
import { scoreMatchup } from './lib/matchupScore';
import type { StatsData, Role } from './lib/matchupScore';
import { Zap, Loader2, BarChart3, Binary, LayoutGrid, Target, Activity, Calendar, UserSearch, TrendingUp, AlertTriangle, ArrowLeft } from 'lucide-react';

type SortKey = 'total_points' | 'win_rate' | 'avg_eliminations' | 'avg_wart' | 'avg_deposits' | 'volatility' | 'momentum';
type WindowSortKey = 'w1Points' | 'w2Points' | 'w3Points' | 'totalPoints';
type SynergySortKey = 'w1Synergy' | 'w2Synergy' | 'w3Synergy' | 'totalSynergy';
type GridMode = 'xDFS' | 'COMPOSITE' | 'SYNERGY';
type CompositeSortKey = 'w1' | 'w2' | 'w3' | 'total';

const App: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [loading, setLoading] = useState(true);
  const [gridMode, setGridMode] = useState<GridMode>('COMPOSITE');
  const [selectedForCash, setSelectedForCash] = useState<string[]>([]);
  const [matches, setMatches] = useState<MatchData[]>([]);
  const [championsStats, setChampionsStats] = useState<DFSStats[]>([]);
  const [allPlayerStats, setAllPlayerStats] = useState<Record<string, DFSStats>>({});
  const [championTraits, setChampionTraits] = useState<ChampionTrait[]>([]);
  const [schemes, setSchemes] = useState<Scheme[]>([]);
  const [counterMap, setCounterMap] = useState<Record<string, { wins: number; games: number }>>({});
  const [mokiSpecialties, setMokiSpecialties] = useState<Record<string, MokiSpecialty>>({});
  const [statMap, setStatMap] = useState<Record<string, MokiStats>>({});
  const [error, setError] = useState<string | null>(null);
  
  const [sortConfig, setSortConfig] = useState<{ key: SortKey; direction: 'desc' | 'asc' }>({ key: 'total_points', direction: 'desc' });
  const [windowSortConfig, setWindowSortConfig] = useState<{ key: WindowSortKey; direction: 'desc' | 'asc' }>({ key: 'totalPoints', direction: 'desc' });
  const [synergySortConfig, setSynergySortConfig] = useState<{ key: SynergySortKey; direction: 'desc' | 'asc' }>({ key: 'totalSynergy', direction: 'desc' });
  const [compositeSortConfig, setCompositeSortConfig] = useState<{ key: CompositeSortKey; direction: 'desc' | 'asc' }>({ key: 'total', direction: 'desc' });
  const [minWinRate, setMinWinRate] = useState<number>(0);
  const [selectedSchemeName, setSelectedSchemeName] = useState<string>('');
  const [selectedSpecialty, setSelectedSpecialty] = useState<string>('');
  const [targetStartDate, setTargetStartDate] = useState<string>(new Date().toISOString().split('T')[0]);

  const getChampionTraitSchemes = (name: string) => {
    return schemes.filter(s => (s.traits || s.exactTraits) && isChampionInScheme(name, s, championTraits));
  };

  const getChampSpecialtyLabel = (mokiId: string) => {
    const stats = championsStats.find(s => s.moki_id === mokiId);
    let tokenId = stats?.token_id;
    if (!tokenId) {
      const champMatch = matches.find(m => m.players.some(p => p.moki_id === mokiId && p.is_champion));
      const player = champMatch?.players.find(p => p.moki_id === mokiId);
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

  const getCompositeHeatColor = (score: number) => {
    if (score > 75) return 'bg-[#00ff41] text-[#0d0208] font-bold shadow-[inset_0_0_10px_rgba(0,0,0,0.5)]';
    if (score > 60) return 'bg-[#00cc34] text-[#0d0208]';
    if (score > 45) return 'bg-[#008f25] text-white';
    return 'bg-[#1a331e] text-[#00ff41] opacity-60';
  };

  useEffect(() => {
    const init = async () => {
      try {
        setLoading(true);
        const latest = await fetchLatest();
        const mokiTotalsUrl = `${DATA_URL}/${latest.moki_totals.url}`;
        const [mokiStatsRes, traitsRes, schemesRes] = await Promise.all([
          fetch(mokiTotalsUrl), fetch('/moki/champions.json'), fetch('/moki/schemes.json')
        ]);
        const mokiBaseStats = await mokiStatsRes.json();
        const traits = await traitsRes.json();
        const schemeList = await schemesRes.json();
        setChampionTraits(traits);
        setSchemes(schemeList);

        const specialties: Record<string, MokiSpecialty> = {};
        const stats: Record<string, MokiStats> = {};
        mokiBaseStats.data.forEach((m: any) => {
          const str = m.totals.strength || 0;
          const dex = m.totals.dexterity || 0;
          const def = m.totals.defense || 0;
          const spd = m.totals.speed || 0;
          const fort = m.totals.fortitude || 0;
          
          stats[m.tokenId.toString()] = { strength: str, dexterity: dex, defense: def, speed: spd, fortitude: fort };

          const sorted = [{ type: 'ELIM_SPECIALIST', val: str }, { type: 'GACHA_SPECIALIST', val: dex }, { type: 'WART_SPECIALIST', val: def }].sort((a, b) => b.val - a.val);
          if (Math.abs(sorted[0].val - sorted[1].val) <= 5) specialties[m.tokenId.toString()] = 'BALANCED';
          else specialties[m.tokenId.toString()] = sorted[0].type as MokiSpecialty;
        });
        setMokiSpecialties(specialties);
        setStatMap(stats);

        const activePartitions = latest.partitions.filter((p: any) => p.match_count > 0).slice(-7);
        const allData = await Promise.all(activePartitions.map((p: any) => fetchPartition(p.url)));
        const flatData = allData.flat();

        // Build token_id -> matchStats lookup from already-loaded moki_totals
        const cumByToken: Record<number, any> = {};
        mokiBaseStats.data.forEach((m: any) => {
          if (m.matchStats) cumByToken[m.tokenId] = m.matchStats;
        });

        const matchMap = new Map<string, MatchData>();
        flatData.forEach(m => {
          const existing = matchMap.get(m.match.match_id);
          if (!existing || existing.match.state === 'scheduled') {
            matchMap.set(m.match.match_id, m);
          }
        });
        const uniqueMatches = Array.from(matchMap.values());
        setMatches(uniqueMatches);
        processStats(uniqueMatches, cumByToken);
      } catch (err) {
        setError('CRITICAL_SYSTEM_ERROR: UNABLE TO RETRIEVE CAREER_DATA');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    init();
  }, []);

  const processStats = (data: MatchData[], cumByToken: Record<number, any> = {}) => {
    const statsMap: { [id: string]: DFSStats & { wins: number; recentWins: number; recentGames: number; scores: number[] } } = {};
    const counters: Record<string, { wins: number; games: number }> = {};
    const scoredDates = Array.from(new Set(data.filter(m => m.match.state === 'scored').map(m => m.match.match_date))).sort();
    const recentThreshold = scoredDates.slice(-2)[0] || "";

    data.filter(m => m.match.state === 'scored').forEach((m) => {
      const isWinner = m.match.team_won;
      const team1 = m.players.filter(p => p.team === 1);
      const team2 = m.players.filter(p => p.team === 2);
      const isRecent = m.match.match_date >= recentThreshold;

      const processLineup = (players: MokiPlayer[], teamNum: number, opponents: MokiPlayer[]) => {
        const teamWon = isWinner === teamNum;
        const champion = players.find(p => p.is_champion);
        const oppChampion = opponents.find(p => p.is_champion);

        players.forEach((p) => {
          if (!statsMap[p.moki_id]) {
            statsMap[p.moki_id] = {
              moki_id: p.moki_id, token_id: p.token_id, name: p.name, is_champion: p.is_champion === 1,
              total_points: 0, games_played: 0, avg_deposits: 0, avg_eliminations: 0, avg_wart: 0, 
              win_rate: 0, wins: 0, recentWins: 0, recentGames: 0, momentum: 0, confidence: 0, volatility: 0, scores: []
            };
          }
          const stats = statsMap[p.moki_id];
          const performance = m.performances.find((perf) => perf.moki_id === p.moki_id || perf.token_id === p.token_id);
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

        if (champion && oppChampion) {
          const matchup = `${champion.name} vs ${oppChampion.name}`;
          counters[matchup] = counters[matchup] || { wins: 0, games: 0 };
          counters[matchup].games++;
          if (teamWon) counters[matchup].wins++;
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
      const cum = cumByToken[s.token_id];
      return {
        ...s, win_rate: overallWR, momentum: recentWR - overallWR,
        confidence: Math.min(100, (s.games_played / 50) * 100),
        volatility: Math.sqrt(variance),
        avg_deposits: cum ? cum.avgDeposits : (s.avg_deposits / s.games_played),
        avg_eliminations: cum ? cum.avgEliminations : (s.avg_eliminations / s.games_played),
        avg_wart: cum ? cum.avgWartDistance : (s.avg_wart / s.games_played),
      };
    });

    const statsRecord: Record<string, DFSStats> = {};
    finalized.forEach(s => { statsRecord[s.moki_id] = s; });

    setChampionsStats(finalized.filter(s => s.is_champion));
    setAllPlayerStats(statsRecord);
    setCounterMap(counters);
  };

  const availableFutureDates = useMemo(() => {
    const dates = Array.from(new Set(matches.map(m => m.match.match_date))).sort();
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
      composition[comp1] = composition[comp1] || { wins: 0, games: 0 };
      composition[comp2] = composition[comp2] || { wins: 0, games: 0 };
      composition[comp1].games++;
      composition[comp2].games++;
      if (m.match.team_won === 1) composition[comp1].wins++;
      if (m.match.team_won === 2) composition[comp2].wins++;
      const h2hKey = `${comp1}|${comp2}`;
      headToHead[h2hKey] = headToHead[h2hKey] || { winsA: 0, games: 0 };
      headToHead[h2hKey].games++;
      if (m.match.team_won === 1) headToHead[h2hKey].winsA++;
    });
    return { composition, headToHead };
  }, [matches, mokiSpecialties]);

  const tripleWindowGrid = useMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    const startFilter = targetStartDate || today;
    const allDailyMatches = matches.filter(m => m.match.match_date === startFilter);
    const grid = generateTripleWindowGrid(allDailyMatches, filteredAndSorted, mokiSpecialties, allPlayerStats, counterMap, statsData);
    return [...grid].sort((a, b) => {
      const modifier = windowSortConfig.direction === 'asc' ? 1 : -1;
      return (a[windowSortConfig.key] < b[windowSortConfig.key]) ? -modifier : modifier;
    });
  }, [matches, targetStartDate, filteredAndSorted, mokiSpecialties, allPlayerStats, windowSortConfig, counterMap, statsData]);

  const synergyGrid = useMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    const startFilter = targetStartDate || today;
    const allDailyMatches = matches.filter(m => m.match.match_date === startFilter);
    const grid = generateSynergyGrid(allDailyMatches, filteredAndSorted, mokiSpecialties, statsData);
    return [...grid].sort((a, b) => {
      const modifier = synergySortConfig.direction === 'asc' ? 1 : -1;
      return (a[synergySortConfig.key] < b[synergySortConfig.key]) ? -modifier : modifier;
    });
  }, [matches, targetStartDate, filteredAndSorted, mokiSpecialties, synergySortConfig, statsData]);

  // Unfiltered grids used only for stable normalization — scores must not shift when filters change
  const allChampionsWindowGrid = useMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    const startFilter = targetStartDate || today;
    const allDailyMatches = matches.filter(m => m.match.match_date === startFilter);
    return generateTripleWindowGrid(allDailyMatches, championsStats, mokiSpecialties, allPlayerStats, counterMap, statsData);
  }, [matches, targetStartDate, championsStats, mokiSpecialties, allPlayerStats, counterMap, statsData]);

  const allChampionsSynergyGrid = useMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    const startFilter = targetStartDate || today;
    const allDailyMatches = matches.filter(m => m.match.match_date === startFilter);
    return generateSynergyGrid(allDailyMatches, championsStats, mokiSpecialties, statsData);
  }, [matches, targetStartDate, championsStats, mokiSpecialties, statsData]);

  const compositeGrid = useMemo(() => {
    // Normalize over ALL champions so scores are stable regardless of active filter
    const xMapAll = new Map(allChampionsWindowGrid.map(r => [r.championName, r]));
    const sMapAll = new Map(allChampionsSynergyGrid.map(r => [r.championName, r]));
    const allNames = [...new Set([...xMapAll.keys(), ...sMapAll.keys()])];

    const allRaw = allNames.map(name => ({
      championName: name,
      xW1: xMapAll.get(name)?.w1Points ?? 0, xW2: xMapAll.get(name)?.w2Points ?? 0, xW3: xMapAll.get(name)?.w3Points ?? 0,
      sW1: sMapAll.get(name)?.w1Synergy ?? 0, sW2: sMapAll.get(name)?.w2Synergy ?? 0, sW3: sMapAll.get(name)?.w3Synergy ?? 0,
    }));

    const norm = (val: number, min: number, max: number) =>
      max === min ? 50 : ((val - min) / (max - min)) * 100;

    const xMin = Math.min(...allRaw.map(r => Math.min(r.xW1, r.xW2, r.xW3)));
    const xMax = Math.max(...allRaw.map(r => Math.max(r.xW1, r.xW2, r.xW3)));
    const sMin = Math.min(...allRaw.map(r => Math.min(r.sW1, r.sW2, r.sW3)));
    const sMax = Math.max(...allRaw.map(r => Math.max(r.sW1, r.sW2, r.sW3)));

    // Score all champions, then filter to only show the currently filtered set
    const visibleNames = new Set(filteredAndSorted.map(s => s.name));
    const rows = allRaw
      .filter(r => visibleNames.has(r.championName))
      .map(r => {
        const w1 = (norm(r.xW1, xMin, xMax) + norm(r.sW1, sMin, sMax)) / 2;
        const w2 = (norm(r.xW2, xMin, xMax) + norm(r.sW2, sMin, sMax)) / 2;
        const w3 = (norm(r.xW3, xMin, xMax) + norm(r.sW3, sMin, sMax)) / 2;
        return { championName: r.championName, w1, w2, w3, total: w1 + w2 + w3 };
      });

    return [...rows].sort((a, b) => {
      const mod = compositeSortConfig.direction === 'asc' ? 1 : -1;
      return (a[compositeSortConfig.key] < b[compositeSortConfig.key]) ? -mod : mod;
    });
  }, [allChampionsWindowGrid, allChampionsSynergyGrid, filteredAndSorted, compositeSortConfig]);

  const cashConflicts = useMemo(() => {
    if (selectedForCash.length < 2) return {};
    const today = new Date().toISOString().split('T')[0];
    const startFilter = targetStartDate || today;
    const scheduled = matches.filter(m => m.match.match_date === startFilter);

    const champWindows: Record<string, { w1: Set<string>; w2: Set<string>; w3: Set<string> }> = {};
    selectedForCash.forEach(name => {
      const champ = championsStats.find(s => s.name === name);
      if (!champ) return;
      const ms = scheduled
        .filter(m => m.players.some(p => p.moki_id === champ.moki_id))
        .sort((a, b) => a.match.match_id.localeCompare(b.match.match_id));
      champWindows[name] = {
        w1: new Set(ms.slice(0, 10).map(m => m.match.match_id)),
        w2: new Set(ms.slice(10, 20).map(m => m.match.match_id)),
        w3: new Set(ms.slice(20, 30).map(m => m.match.match_id)),
      };
    });

    const conflicts: Record<string, string[]> = {};
    for (let i = 0; i < selectedForCash.length; i++) {
      for (let j = i + 1; j < selectedForCash.length; j++) {
        const a = selectedForCash[i], b = selectedForCash[j];
        const aw = champWindows[a], bw = champWindows[b];
        if (!aw || !bw) continue;
        const hit = (['w1', 'w2', 'w3'] as const)
          .filter(w => [...aw[w]].some(id => bw[w].has(id)))
          .map(w => w.toUpperCase());
        if (hit.length) conflicts[`${a}|${b}`] = hit;
      }
    }
    return conflicts;
  }, [selectedForCash, matches, targetStartDate, championsStats]);

  const [predictionAccuracy, setPredictionAccuracy] = useState<number | null>(null);
  const [highConfAccuracy, setHighConfAccuracy] = useState<number | null>(null);

  useEffect(() => {
    if (loading || matches.length === 0 || Object.keys(mokiSpecialties).length === 0) return;

    // Defer the heavy backtest calculation
    const timer = setTimeout(() => {
      const results = runTrueBacktest(matches, mokiSpecialties, statMap);
      console.log(`True Backtest Results: ${results.correctPredictions}/${results.totalMatches} correct. Accuracy: ${results.accuracy.toFixed(1)}%. High Conf: ${results.highConfidenceAccuracy.toFixed(1)}%`);
      setPredictionAccuracy(results.accuracy);
      setHighConfAccuracy(results.highConfidenceAccuracy);
    }, 500);

    return () => clearTimeout(timer);
  }, [matches, mokiSpecialties, statMap, loading]);

  const handleWindowSort = (key: WindowSortKey) => {
    setWindowSortConfig(prev => ({ key, direction: prev.key === key && prev.direction === 'desc' ? 'asc' : 'desc' }));
  };
  const handleSynergySort = (key: SynergySortKey) => {
    setSynergySortConfig(prev => ({ key, direction: prev.key === key && prev.direction === 'desc' ? 'asc' : 'desc' }));
  };
  const handleCompositeSort = (key: CompositeSortKey) => {
    setCompositeSortConfig(prev => ({ key, direction: prev.key === key && prev.direction === 'desc' ? 'asc' : 'desc' }));
  };
  const handleSort = (key: SortKey) => {
    setSortConfig(prev => ({ key, direction: prev.key === key && prev.direction === 'desc' ? 'asc' : 'desc' }));
  };
  const handleSelectChampion = (mokiId: string) => {
    navigate(`/champion/${mokiId}${location.search}`);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen text-terminal-green font-mono">
        <div className="text-2xl animate-pulse"><Loader2 className="animate-spin inline mr-2" /> BOOTING_SYSTEM_v5.1...</div>
      </div>
    );
  }

  const isDetailView = location.pathname.startsWith('/champion/');
  const isStatsView = location.pathname === '/stats';
  const isPredictionsView = location.pathname === '/' || (!isDetailView && !isStatsView);

  return (
    <div className="p-2 md:p-4 w-full max-w-[100vw] mx-auto overflow-x-hidden">
      <header className="terminal-header flex flex-col md:flex-row justify-between items-start md:items-center mb-6 md:mb-8 gap-4 px-2">
        <div onClick={() => navigate('/')} className="cursor-pointer w-full md:w-auto">
          <h1 className="text-xl md:text-3xl font-bold tracking-tighter text-terminal-green uppercase italic shadow-green-500/20 shadow-sm leading-tight">GRAND_ARENA // MATCH_ORACLE</h1>
          <div className="text-[10px] md:text-sm opacity-70 flex flex-wrap items-center gap-2 md:gap-4 font-mono mt-1">
            <span>STATUS: <span className="text-white">ONLINE</span></span>
            <span className="flex items-center gap-1 text-cyan-400"><TrendingUp size={12} className="md:w-3.5 md:h-3.5" /> MOBILE_OPTIMIZED</span>
            <span className="text-yellow-500 border border-yellow-900/50 px-1 text-[9px] md:text-[10px] bg-yellow-900/10 font-black uppercase">ALL_TIMES_UTC</span>
          </div>
        </div>
        <div className="flex gap-2 w-full md:w-auto">
          <button onClick={() => navigate('/stats')} className={`flex-1 md:flex-none terminal-button flex items-center justify-center gap-2 py-3 md:py-1.5 ${isStatsView ? 'bg-green-900/40 shadow-[0_0_10px_rgba(0,255,65,0.3)]' : ''}`}><BarChart3 size={16} /> <span className="hidden sm:inline">CORE_STATS</span><span className="sm:hidden">STATS</span></button>
          <button onClick={() => navigate('/')} className={`flex-1 md:flex-none terminal-button flex items-center justify-center gap-2 py-3 md:py-1.5 ${isPredictionsView ? 'bg-green-900/40 shadow-[0_0_10px_rgba(0,255,65,0.3)]' : ''}`}><Binary size={16} /> <span className="hidden sm:inline">ADVANTAGE_GRID</span><span className="sm:hidden">GRID</span></button>
        </div>
      </header>

      {error && (
        <div className="bg-red-900/20 border-2 border-red-500 text-red-400 p-4 mb-8 font-mono text-xs flex items-center gap-3 animate-pulse">
          <AlertTriangle size={20} className="shrink-0" />
          <div>
            <div className="font-black uppercase">System_Failure_Detected</div>
            <div>{error}</div>
          </div>
        </div>
      )}

      <Routes>
        <Route path="/stats" element={
          <section className="w-full">
            <div className="terminal-card mb-6 md:mb-8 grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-8 bg-green-900/5 items-center border-double border-4">
              <div className="flex flex-col gap-2">
                <label className="text-[10px] font-bold flex items-center gap-2 opacity-70"><Target className="text-cyan-400" size={14} /> SCHEME_FOCUS</label>
                <select value={selectedSchemeName} onChange={(e) => setSelectedSchemeName(e.target.value)} className="w-full text-xs md:text-sm p-2 font-mono border border-terminal-green bg-black text-terminal-green outline-none">
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
                <select value={selectedSpecialty} onChange={(e) => setSelectedSpecialty(e.target.value)} className="w-full text-xs md:text-sm p-2 font-mono border border-terminal-green bg-black text-terminal-green outline-none">
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
            <h2 className="text-lg md:text-xl mb-4 border-b border-terminal-green flex items-center gap-2 text-terminal-green font-black uppercase"><LayoutGrid className="text-yellow-400" size={20} /> Historic_7Day_Stats</h2>
            <div className="terminal-card !p-0 border-t-0 w-full overflow-x-auto custom-scrollbar">
              <table className="w-full text-left border-collapse font-mono text-[10px] md:text-xs">
                <thead>
                  <tr className="border-b border-terminal-green bg-green-900/20 uppercase whitespace-nowrap">
                    <th className="p-3 md:p-4 border-r border-green-900/30 sticky left-0 bg-black z-20 min-w-[140px] md:min-w-[200px]">Champion_ID</th>
                    <th className="p-3 md:p-4 border-r border-green-900/30 cursor-pointer hover:bg-green-900/40" onClick={() => handleSort('win_rate')}>WR% {sortConfig.key === 'win_rate' && <span>{sortConfig.direction === 'desc' ? '▼' : '▲'}</span>}</th>
                    <th className="p-3 md:p-4 border-r border-green-900/30 cursor-pointer hover:bg-green-900/40" onClick={() => handleSort('volatility')}>VOL {sortConfig.key === 'volatility' && <span>{sortConfig.direction === 'desc' ? '▼' : '▲'}</span>}</th>
                    <th className="p-3 md:p-4 border-r border-green-900/30 cursor-pointer hover:bg-green-900/40" onClick={() => handleSort('momentum')}>MOM {sortConfig.key === 'momentum' && <span>{sortConfig.direction === 'desc' ? '▼' : '▲'}</span>}</th>
                    <th className="p-3 md:p-4 border-r border-green-900/30 text-center cursor-pointer hover:bg-green-900/40" onClick={() => handleSort('avg_eliminations')}>ELIM {sortConfig.key === 'avg_eliminations' && <span>{sortConfig.direction === 'desc' ? '▼' : '▲'}</span>}</th>
                    <th className="p-3 md:p-4 border-r border-green-900/30 text-center cursor-pointer hover:bg-green-900/40" onClick={() => handleSort('avg_deposits')}>DEPO {sortConfig.key === 'avg_deposits' && <span>{sortConfig.direction === 'desc' ? '▼' : '▲'}</span>}</th>
                    <th className="p-3 md:p-4 border-r border-green-900/30 text-center cursor-pointer hover:bg-green-900/40" onClick={() => handleSort('avg_wart')}>WART {sortConfig.key === 'avg_wart' && <span>{sortConfig.direction === 'desc' ? '▼' : '▲'}</span>}</th>
                    <th className="p-3 md:p-4 bg-green-900/30 text-right cursor-pointer hover:bg-green-900/60" onClick={() => handleSort('total_points')}>DFS {sortConfig.key === 'total_points' && <span>{sortConfig.direction === 'desc' ? '▼' : '▲'}</span>}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAndSorted.map((champ) => (
                    <tr key={champ.moki_id} className="border-b border-green-900/10 hover-row transition-all whitespace-nowrap">
                      <td className="p-3 md:p-4 border-r border-green-900/10 cursor-pointer hover:bg-green-900/20 sticky left-0 bg-black z-10" onClick={() => handleSelectChampion(champ.moki_id)}>
                        <div className="font-bold text-xs md:text-sm whitespace-nowrap">{champ.name} <span className="opacity-40 text-[9px] font-normal uppercase">[{getChampSpecialtyLabel(champ.moki_id)}]</span></div>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {getChampionTraitSchemes(champ.name).map((s, idx, arr) => (
                            <React.Fragment key={s.name}>
                              <span className="text-[8px] text-cyan-400 uppercase leading-none py-0.5">{s.name.split(' ')[0]}</span>
                              {idx < arr.length - 1 && <span className="text-cyan-900 text-[8px] self-center">|</span>}
                            </React.Fragment>
                          ))}
                        </div>
                      </td>
                      <td className="p-3 md:p-4 border-r border-green-900/10">{champ.win_rate.toFixed(1)}%</td>
                      <td className="p-3 md:p-4 border-r border-green-900/10"><div className="flex items-center gap-1 md:gap-2">{getVolatilityIcon(champ.volatility)} {champ.volatility.toFixed(1)}</div></td>
                      <td className={`p-3 md:p-4 border-r border-green-900/10 ${champ.momentum > 0 ? 'text-green-400' : 'text-red-400'}`}>{champ.momentum > 0 ? '+' : ''}{champ.momentum.toFixed(1)}%</td>
                      <td className="p-3 md:p-4 border-r border-green-900/10 text-center">{champ.avg_eliminations.toFixed(1)}</td>
                      <td className="p-3 md:p-4 border-r border-green-900/10 text-center">{champ.avg_deposits.toFixed(1)}</td>
                      <td className="p-3 md:p-4 border-r border-green-900/10 text-center">{champ.avg_wart.toFixed(1)}</td>
                      <td className="p-3 md:p-4 positive font-bold text-right">+{champ.total_points.toFixed(0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        } />
        <Route path="/" element={
          <section className="w-full">
            <div className="terminal-card mb-4 grid grid-cols-2 gap-4 sm:gap-6 bg-green-900/5 border-double border-4 py-3 px-4">
              {/* Col 1: scheme + role */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <label className="text-[10px] font-bold flex items-center gap-1 opacity-70 shrink-0 w-24"><Target className="text-cyan-400" size={12} /> SCHEME</label>
                  <select value={selectedSchemeName} onChange={(e) => setSelectedSchemeName(e.target.value)} className="flex-1 text-xs p-1.5 font-mono border border-terminal-green bg-black text-terminal-green outline-none">
                    <option value="">-- ALL --</option>
                    <optgroup label="[ TRAIT_BASED ]" className="bg-black text-cyan-400">
                      {groupedSchemes.trait.map(s => <option key={s.name} value={s.name}>{s.name.toUpperCase()}</option>)}
                    </optgroup>
                    <optgroup label="[ MATCH_BASED ]" className="bg-black text-yellow-400">
                      {groupedSchemes.match.map(s => <option key={s.name} value={s.name}>{s.name.toUpperCase()}</option>)}
                    </optgroup>
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-[10px] font-bold flex items-center gap-1 opacity-70 shrink-0 w-24"><UserSearch className="text-yellow-400" size={12} /> ROLE</label>
                  <select value={selectedSpecialty} onChange={(e) => setSelectedSpecialty(e.target.value)} className="flex-1 text-xs p-1.5 font-mono border border-terminal-green bg-black text-terminal-green outline-none">
                    <option value="">-- ALL_ROLES --</option>
                    <option value="ELIM_SPECIALIST">ELIMINATORS</option>
                    <option value="GACHA_SPECIALIST">DEPOSITERS</option>
                    <option value="WART_SPECIALIST">WART_RIDERS</option>
                    <option value="BALANCED">SUPPORT</option>
                  </select>
                </div>
              </div>
              {/* Col 2: win rate slider */}
              <div className="flex flex-col justify-center gap-1">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-bold opacity-70 uppercase">Win_Rate_Threshold</label>
                  <span className="text-[11px] font-black font-mono text-terminal-green">{minWinRate}%</span>
                </div>
                <input type="range" min="0" max="100" step="5" value={minWinRate} onChange={(e) => setMinWinRate(Number(e.target.value))} className="w-full accent-terminal-green" />
                <div className="flex justify-between text-[9px] font-mono opacity-40">
                  <span>0%</span><span>25%</span><span>50%</span><span>75%</span><span>100%</span>
                </div>
              </div>
            </div>
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-4 border-b border-terminal-green pb-2 px-2 gap-4">
              <div className="flex items-center gap-4 flex-wrap">
              <h2 className="text-lg md:text-xl flex items-center gap-2 text-terminal-green font-black uppercase"><Binary className="text-cyan-400" size={20} /> WIN_PROBABILITY // MATCHUP_MATRIX</h2>
              <div className="flex gap-1">
                {(['COMPOSITE', 'SYNERGY', 'xDFS'] as GridMode[]).map(mode => (
                  <button key={mode} onClick={() => setGridMode(mode)} className={`text-[9px] font-mono px-2 py-0.5 border transition-colors ${gridMode === mode ? 'border-terminal-green bg-green-900/40 text-terminal-green' : 'border-green-900/40 text-green-700 hover:border-green-700'}`}>
                    {mode}
                  </button>
                ))}
              </div>
              <div className="text-[9px] font-mono opacity-60 border-l border-green-900/30 pl-3">
                {gridMode === 'COMPOSITE' && <span><span className="text-terminal-green">COMPOSITE</span> — blends xDFS + SYNERGY, normalized 0–100. Best single ranking for cash picks.</span>}
                {gridMode === 'SYNERGY' && <span><span className="text-cyan-400">SYNERGY</span> — role composition matchup edge (E/D/W/S). Favors teams with structural archetype advantages vs opponents.</span>}
                {gridMode === 'xDFS' && <span><span className="text-yellow-400">xDFS</span> — expected DFS pts per window (win prob × 300 + avg stat scoring). Favors high-scoring depositors &amp; eliminators.</span>}
              </div>
              <div className="flex gap-2">
                <div className="text-[10px] font-mono border border-cyan-900 px-2 py-0.5 bg-cyan-950/20 text-cyan-400">
                  {predictionAccuracy !== null ? `TOTAL_ACC: ${predictionAccuracy.toFixed(1)}%` : 'CALCULATING...'}
                </div>
                <div className="text-[10px] font-mono border border-yellow-900 px-2 py-0.5 bg-yellow-950/20 text-yellow-400">
                  {highConfAccuracy !== null ? `CONF_ACC: ${highConfAccuracy.toFixed(1)}%` : '---'}
                </div>
              </div>
              </div>
              <div className="flex items-center gap-2 font-mono text-[10px] w-full md:w-auto bg-green-900/10 p-2 md:p-0 rounded border md:border-0 border-green-900/30">
                <Calendar size={12} className="text-cyan-400 shrink-0"/> START_POINT:
                <select value={targetStartDate} onChange={(e) => setTargetStartDate(e.target.value)} className="bg-black border border-terminal-green text-terminal-green text-[10px] p-1 outline-none flex-1 md:flex-none">
                  {availableFutureDates.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
            </div>
            {/* Cash Game Lineup Builder */}
            {gridMode === 'COMPOSITE' && (
              <div className="mb-4 terminal-card border-yellow-900/50 bg-yellow-950/10">
                <div className="flex items-center justify-between mb-3">
                  <div className="text-[10px] font-black uppercase text-yellow-400 flex items-center gap-2">
                    <Target size={12} /> CASH_LINEUP_BUILDER <span className="font-normal opacity-60 text-[9px]">— click + to select up to 4 champions</span>
                  </div>
                  {selectedForCash.length > 0 && (
                    <button onClick={() => setSelectedForCash([])} className="text-[9px] font-mono border border-red-900/50 text-red-500 px-2 py-0.5 hover:bg-red-950/30">CLEAR</button>
                  )}
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
                  {[0, 1, 2, 3].map(i => {
                    const name = selectedForCash[i];
                    return (
                      <div key={i} className={`border p-2 text-[10px] font-mono min-h-[40px] flex items-center ${name ? 'border-terminal-green bg-green-950/20 text-terminal-green' : 'border-green-900/30 text-green-900'}`}>
                        {name ? <><span className="opacity-40 mr-1">{i+1}.</span>{name}</> : <span className="opacity-30">SLOT {i+1}</span>}
                      </div>
                    );
                  })}
                </div>
                {Object.keys(cashConflicts).length > 0 ? (
                  <div className="border border-red-900/50 bg-red-950/20 p-2">
                    <div className="text-[9px] font-black text-red-400 uppercase mb-1">⚠ CONFLICTS DETECTED — these pairs face each other (guaranteed split):</div>
                    {Object.entries(cashConflicts).map(([pair, windows]) => (
                      <div key={pair} className="text-[9px] font-mono text-red-300 flex items-center gap-2">
                        <span>{pair.replace('|', ' vs ')}</span>
                        <span className="opacity-60">in {windows.join(', ')}</span>
                      </div>
                    ))}
                  </div>
                ) : selectedForCash.length >= 2 ? (
                  <div className="text-[9px] font-mono text-terminal-green border border-green-900/30 px-2 py-1">✓ NO CONFLICTS — all selected champions have independent match outcomes</div>
                ) : (
                  <div className="text-[9px] font-mono opacity-30">Select 2+ champions to check for schedule conflicts</div>
                )}
              </div>
            )}
            <div className="terminal-card !p-0 border-t-0 shadow-lg w-full overflow-x-auto custom-scrollbar">
              {gridMode === 'xDFS' ? (
                <table className="w-full border-collapse font-mono text-[10px] md:text-xs">
                  <thead>
                    <tr className="border-b border-terminal-green bg-green-900/20 text-center uppercase whitespace-nowrap">
                      <th className="p-3 md:p-4 text-left min-w-[140px] md:min-w-[250px] sticky left-0 bg-black border-r border-terminal-green z-20">Champion_ID</th>
                      <th className="p-3 md:p-4 border-r border-green-900/30 cursor-pointer hover:bg-green-900/40 min-w-[80px]" onClick={() => handleWindowSort('w1Points')}>W1_1_UTC {windowSortConfig.key === 'w1Points' && <span className="text-cyan-400">{windowSortConfig.direction === 'desc' ? '▼' : '▲'}</span>}</th>
                      <th className="p-3 md:p-4 border-r border-green-900/30 cursor-pointer hover:bg-green-900/40 min-w-[80px]" onClick={() => handleWindowSort('w2Points')}>W2_9_UTC {windowSortConfig.key === 'w2Points' && <span className="text-cyan-400">{windowSortConfig.direction === 'desc' ? '▼' : '▲'}</span>}</th>
                      <th className="p-3 md:p-4 border-r border-green-900/30 cursor-pointer hover:bg-green-900/40 min-w-[80px]" onClick={() => handleWindowSort('w3Points')}>W3_17_UTC {windowSortConfig.key === 'w3Points' && <span className="text-cyan-400">{windowSortConfig.direction === 'desc' ? '▼' : '▲'}</span>}</th>
                      <th className="p-3 md:p-4 bg-green-900/40 font-black cursor-pointer hover:bg-green-900/60 min-w-[100px]" onClick={() => handleWindowSort('totalPoints')}>DAY_DFS {windowSortConfig.key === 'totalPoints' && <span className="text-cyan-400">{windowSortConfig.direction === 'desc' ? '▼' : '▲'}</span>}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tripleWindowGrid.map((row) => {
                      const champ = championsStats.find(s => s.name === row.championName);
                      return (
                        <tr key={row.championName} className="border-b border-green-900/20 hover-row transition-colors group whitespace-nowrap">
                          <td className="p-3 md:p-4 sticky left-0 bg-black border-r border-terminal-green z-10 cursor-pointer hover:bg-green-900/20" onClick={() => handleSelectChampion(champ?.moki_id || '')}>
                            <div className="font-bold text-xs md:text-sm whitespace-nowrap">{row.championName} <span className="opacity-40 text-[9px] font-normal uppercase">[{getChampSpecialtyLabel(champ?.moki_id || '')}]</span></div>
                            <div className="flex flex-wrap gap-1 mt-1">
                              {getChampionTraitSchemes(row.championName).map((s, idx, arr) => (
                                <React.Fragment key={s.name}>
                                  <span className="text-[8px] text-cyan-400 uppercase leading-none py-0.5">{s.name.split(' ')[0]}</span>
                                  {idx < arr.length - 1 && <span className="text-cyan-900 text-[8px] self-center">|</span>}
                                </React.Fragment>
                              ))}
                            </div>
                          </td>
                          <td onClick={() => handleSelectChampion(champ?.moki_id || '')} className={`p-4 md:p-6 border-r border-green-900/10 text-center transition-all cursor-pointer hover:brightness-125 ${getWindowHeatColor(row.w1Points)}`}><div className="text-lg md:text-2xl font-black tracking-widest">{row.w1Points.toFixed(0)}</div></td>
                          <td onClick={() => handleSelectChampion(champ?.moki_id || '')} className={`p-4 md:p-6 border-r border-green-900/10 text-center transition-all cursor-pointer hover:brightness-125 ${getWindowHeatColor(row.w2Points)}`}><div className="text-lg md:text-2xl font-black tracking-widest">{row.w2Points.toFixed(0)}</div></td>
                          <td onClick={() => handleSelectChampion(champ?.moki_id || '')} className={`p-4 md:p-6 border-r border-green-900/10 text-center transition-all cursor-pointer hover:brightness-125 ${getWindowHeatColor(row.w3Points)}`}><div className="text-lg md:text-2xl font-black tracking-widest">{row.w3Points.toFixed(0)}</div></td>
                          <td onClick={() => handleSelectChampion(champ?.moki_id || '')} className="p-3 md:p-4 font-bold text-center text-sm md:text-lg positive border-l border-green-900/30 bg-green-950/10 cursor-pointer hover:bg-green-900/20">+{row.totalPoints.toFixed(0)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : gridMode === 'COMPOSITE' ? (
                <table className="w-full border-collapse font-mono text-[10px] md:text-xs">
                  <thead>
                    <tr className="border-b border-terminal-green bg-green-900/20 text-center uppercase whitespace-nowrap">
                      <th className="p-2 w-8 sticky left-0 bg-black border-r border-green-900/40 z-20"></th>
                      <th className="p-3 md:p-4 text-left min-w-[140px] md:min-w-[220px] sticky left-8 bg-black border-r border-terminal-green z-20">Champion_ID</th>
                      <th className="p-3 md:p-4 border-r border-green-900/30 cursor-pointer hover:bg-green-900/40 min-w-[80px]" onClick={() => handleCompositeSort('w1')}>W1_1_UTC {compositeSortConfig.key === 'w1' && <span className="text-cyan-400">{compositeSortConfig.direction === 'desc' ? '▼' : '▲'}</span>}</th>
                      <th className="p-3 md:p-4 border-r border-green-900/30 cursor-pointer hover:bg-green-900/40 min-w-[80px]" onClick={() => handleCompositeSort('w2')}>W2_9_UTC {compositeSortConfig.key === 'w2' && <span className="text-cyan-400">{compositeSortConfig.direction === 'desc' ? '▼' : '▲'}</span>}</th>
                      <th className="p-3 md:p-4 border-r border-green-900/30 cursor-pointer hover:bg-green-900/40 min-w-[80px]" onClick={() => handleCompositeSort('w3')}>W3_17_UTC {compositeSortConfig.key === 'w3' && <span className="text-cyan-400">{compositeSortConfig.direction === 'desc' ? '▼' : '▲'}</span>}</th>
                      <th className="p-3 md:p-4 bg-green-900/40 font-black cursor-pointer hover:bg-green-900/60 min-w-[100px]" onClick={() => handleCompositeSort('total')}>EDGE_SCORE {compositeSortConfig.key === 'total' && <span className="text-cyan-400">{compositeSortConfig.direction === 'desc' ? '▼' : '▲'}</span>}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {compositeGrid.map((row) => {
                      const champ = championsStats.find(s => s.name === row.championName);
                      const isSelected = selectedForCash.includes(row.championName);
                      const toggleSelect = (e: React.MouseEvent) => {
                        e.stopPropagation();
                        setSelectedForCash(prev =>
                          prev.includes(row.championName)
                            ? prev.filter(n => n !== row.championName)
                            : prev.length < 4 ? [...prev, row.championName] : prev
                        );
                      };
                      return (
                        <tr key={row.championName} className={`border-b border-green-900/20 hover-row transition-colors group whitespace-nowrap ${isSelected ? 'bg-green-950/30' : ''}`}>
                          <td className="p-1 w-8 text-center sticky left-0 border-r border-green-900/40 z-10" style={{ backgroundColor: isSelected ? 'rgb(5,46,22)' : 'black' }}>
                            <button onClick={toggleSelect} className={`w-5 h-5 border text-[9px] font-black flex items-center justify-center transition-colors mx-auto ${isSelected ? 'border-terminal-green bg-terminal-green text-black' : 'border-green-900 text-green-900 hover:border-green-600'}`}>
                              {isSelected ? selectedForCash.indexOf(row.championName) + 1 : '+'}
                            </button>
                          </td>
                          <td className="p-3 md:p-4 sticky left-8 border-r border-terminal-green z-10 whitespace-nowrap" style={{ backgroundColor: isSelected ? 'rgb(5,46,22)' : 'black' }}>
                            <div className="font-bold text-xs md:text-sm cursor-pointer hover:text-terminal-green" onClick={() => handleSelectChampion(champ?.moki_id || '')}>{row.championName} <span className="opacity-40 text-[9px] font-normal uppercase">[{getChampSpecialtyLabel(champ?.moki_id || '')}]</span></div>
                            <div className="flex flex-wrap gap-1 mt-0.5">
                              {getChampionTraitSchemes(row.championName).map((s, idx, arr) => (
                                <React.Fragment key={s.name}>
                                  <span className="text-[8px] text-cyan-400 uppercase leading-none">{s.name.split(' ')[0]}</span>
                                  {idx < arr.length - 1 && <span className="text-cyan-900 text-[8px] self-center">|</span>}
                                </React.Fragment>
                              ))}
                            </div>
                          </td>
                          <td onClick={() => handleSelectChampion(champ?.moki_id || '')} className={`p-4 md:p-6 border-r border-green-900/10 text-center transition-all cursor-pointer hover:brightness-125 ${getCompositeHeatColor(row.w1)}`}><div className="text-lg md:text-2xl font-black tracking-widest">{row.w1.toFixed(0)}</div></td>
                          <td onClick={() => handleSelectChampion(champ?.moki_id || '')} className={`p-4 md:p-6 border-r border-green-900/10 text-center transition-all cursor-pointer hover:brightness-125 ${getCompositeHeatColor(row.w2)}`}><div className="text-lg md:text-2xl font-black tracking-widest">{row.w2.toFixed(0)}</div></td>
                          <td onClick={() => handleSelectChampion(champ?.moki_id || '')} className={`p-4 md:p-6 border-r border-green-900/10 text-center transition-all cursor-pointer hover:brightness-125 ${getCompositeHeatColor(row.w3)}`}><div className="text-lg md:text-2xl font-black tracking-widest">{row.w3.toFixed(0)}</div></td>
                          <td onClick={() => handleSelectChampion(champ?.moki_id || '')} className="p-3 md:p-4 font-bold text-center text-sm md:text-lg positive border-l border-green-900/30 bg-green-950/10 cursor-pointer hover:bg-green-900/20">{row.total.toFixed(0)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <table className="w-full border-collapse font-mono text-[10px] md:text-xs">
                  <thead>
                    <tr className="border-b border-terminal-green bg-green-900/20 text-center uppercase whitespace-nowrap">
                      <th className="p-3 md:p-4 text-left min-w-[140px] md:min-w-[250px] sticky left-0 bg-black border-r border-terminal-green z-20">Champion_ID</th>
                      <th className="p-3 md:p-4 border-r border-green-900/30 cursor-pointer hover:bg-green-900/40 min-w-[80px]" onClick={() => handleSynergySort('w1Synergy')}>W1_1_UTC {synergySortConfig.key === 'w1Synergy' && <span className="text-cyan-400">{synergySortConfig.direction === 'desc' ? '▼' : '▲'}</span>}</th>
                      <th className="p-3 md:p-4 border-r border-green-900/30 cursor-pointer hover:bg-green-900/40 min-w-[80px]" onClick={() => handleSynergySort('w2Synergy')}>W2_9_UTC {synergySortConfig.key === 'w2Synergy' && <span className="text-cyan-400">{synergySortConfig.direction === 'desc' ? '▼' : '▲'}</span>}</th>
                      <th className="p-3 md:p-4 border-r border-green-900/30 cursor-pointer hover:bg-green-900/40 min-w-[80px]" onClick={() => handleSynergySort('w3Synergy')}>W3_17_UTC {synergySortConfig.key === 'w3Synergy' && <span className="text-cyan-400">{synergySortConfig.direction === 'desc' ? '▼' : '▲'}</span>}</th>
                      <th className="p-3 md:p-4 bg-green-900/40 font-black cursor-pointer hover:bg-green-900/60 min-w-[100px]" onClick={() => handleSynergySort('totalSynergy')}>SYN_DIFF {synergySortConfig.key === 'totalSynergy' && <span className="text-cyan-400">{synergySortConfig.direction === 'desc' ? '▼' : '▲'}</span>}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {synergyGrid.map((row) => {
                      const champ = championsStats.find(s => s.name === row.championName);
                      return (
                        <tr key={row.championName} className="border-b border-green-900/20 hover-row transition-colors group whitespace-nowrap">
                          <td className="p-3 md:p-4 sticky left-0 bg-black border-r border-terminal-green z-10 cursor-pointer hover:bg-green-900/20" onClick={() => handleSelectChampion(champ?.moki_id || '')}>
                            <div className="font-bold text-xs md:text-sm whitespace-nowrap">{row.championName} <span className="opacity-40 text-[9px] font-normal uppercase">[{getChampSpecialtyLabel(champ?.moki_id || '')}]</span></div>
                            <div className="flex flex-wrap gap-1 mt-1">
                              {getChampionTraitSchemes(row.championName).map((s, idx, arr) => (
                                <React.Fragment key={s.name}>
                                  <span className="text-[8px] text-cyan-400 uppercase leading-none py-0.5">{s.name.split(' ')[0]}</span>
                                  {idx < arr.length - 1 && <span className="text-cyan-900 text-[8px] self-center">|</span>}
                                </React.Fragment>
                              ))}
                            </div>
                          </td>
                          <td onClick={() => handleSelectChampion(champ?.moki_id || '')} className={`p-4 md:p-6 border-r border-green-900/10 text-center transition-all cursor-pointer hover:brightness-125 ${getSynergyHeatColor(row.w1Synergy / 10)}`}><div className="text-lg md:text-2xl font-black tracking-widest">{row.w1Synergy > 0 ? '+' : ''}{row.w1Synergy.toFixed(1)}</div></td>
                          <td onClick={() => handleSelectChampion(champ?.moki_id || '')} className={`p-4 md:p-6 border-r border-green-900/10 text-center transition-all cursor-pointer hover:brightness-125 ${getSynergyHeatColor(row.w2Synergy / 10)}`}><div className="text-lg md:text-2xl font-black tracking-widest">{row.w2Synergy > 0 ? '+' : ''}{row.w2Synergy.toFixed(1)}</div></td>
                          <td onClick={() => handleSelectChampion(champ?.moki_id || '')} className={`p-4 md:p-6 border-r border-green-900/10 text-center transition-all cursor-pointer hover:brightness-125 ${getSynergyHeatColor(row.w3Synergy / 10)}`}><div className="text-lg md:text-2xl font-black tracking-widest">{row.w3Synergy > 0 ? '+' : ''}{row.w3Synergy.toFixed(1)}</div></td>
                          <td onClick={() => handleSelectChampion(champ?.moki_id || '')} className={`p-3 md:p-4 font-bold text-center text-sm md:text-lg border-l border-green-900/30 bg-green-950/10 cursor-pointer hover:bg-green-900/20 ${row.totalSynergy > 0 ? 'text-green-400' : 'text-red-400'}`}>{row.totalSynergy > 0 ? '+' : ''}{row.totalSynergy.toFixed(1)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

          </section>
        } />
        <Route path="/champion/:mokiId" element={
          <ChampionDetailView 
            matches={matches} 
            mokiSpecialties={mokiSpecialties} 
            statsData={statsData}
            statMap={statMap}
            allStats={allPlayerStats}
            counterMap={counterMap}
            targetDate={targetStartDate}
            onBack={() => navigate(-1)}
            getChampSpecialtyLabel={getChampSpecialtyLabel}
            getSynergyHeatColor={getSynergyHeatColor}
          />
        } />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      <footer className="mt-8 md:mt-12 pt-4 border-t border-terminal-green text-center text-[8px] md:text-[9px] opacity-40 font-mono tracking-widest uppercase pb-4">System_Protocol_v5.1 // Neural_Network_Stable // Mobile_Mapping_Active</footer>
    </div>
  );
};

interface ChampionDetailViewProps {
  matches: MatchData[];
  mokiSpecialties: Record<string, MokiSpecialty>;
  statsData: StatsData;
  statMap: Record<string, MokiStats>;
  allStats: Record<string, DFSStats>;
  counterMap: Record<string, { wins: number; games: number }>;
  targetDate: string;
  onBack: () => void;
  getChampSpecialtyLabel: (mokiId: string) => string;
  getSynergyHeatColor: (diff: number) => string;
}

const ChampionDetailView: React.FC<ChampionDetailViewProps> = ({ matches, mokiSpecialties, statsData, statMap, allStats, counterMap, targetDate, onBack, getChampSpecialtyLabel, getSynergyHeatColor }) => {
  const { mokiId } = useParams<{ mokiId: string }>();
  const [expandedMatch, setExpandedMatch] = useState<string | null>(null);
  const championStats = mokiId ? allStats[mokiId] : null;
  const championName = championStats?.name || "Unknown Champion";

  const getMatchupDetails = (match: MatchData) => {
    const team1 = match.players.filter(p => p.team === 1);
    const team2 = match.players.filter(p => p.team === 2);
    const me = match.players.find(p => p.moki_id === mokiId);
    const isTeam1 = me?.team === 1;
    const myTeam = isTeam1 ? team1 : team2;
    const oppTeam = isTeam1 ? team2 : team1;
    const getRoleChar = (spec: MokiSpecialty): Role => {
      if (spec === 'ELIM_SPECIALIST') return 'E';
      if (spec === 'GACHA_SPECIALIST') return 'D';
      if (spec === 'WART_SPECIALIST') return 'W';
      return 'S';
    };
    const myRoles = myTeam.map(p => getRoleChar(mokiSpecialties[p.token_id.toString()] || 'BALANCED'));
    const oppRoles = oppTeam.map(p => getRoleChar(mokiSpecialties[p.token_id.toString()] || 'BALANCED'));
    const synResult = scoreMatchup(myRoles, oppRoles, statsData);
    const synergyScore = (synResult.safe_score - 50) / 10;
    const pred = calculatePredictiveAdvantage(match, allStats, mokiSpecialties, counterMap, statsData, statMap);
    const xPoints = isTeam1 ? pred.teamA.pointsExpected : pred.teamB.pointsExpected;
    const winProb = isTeam1 ? pred.teamA.winProbability : pred.teamB.winProbability;
    return { synResult, synergyScore, xPoints, winProb, myRoles, oppRoles };
  };

  const futureGames = useMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    const dateToFilter = targetDate || today;
    return matches.filter(m => m.match.match_date === dateToFilter && m.players.some(p => p.moki_id === mokiId))
      .sort((a, b) => a.match.match_id.localeCompare(b.match.match_id)).slice(0, 30);
  }, [mokiId, matches, targetDate]);

  const groupedFutureGames = useMemo(() => {
    const getGroupMetrics = (games: MatchData[]) => {
      return games.reduce((acc, m) => {
        const { synergyScore, xPoints } = getMatchupDetails(m);
        return { synergySum: acc.synergySum + synergyScore, xPointsSum: acc.xPointsSum + xPoints };
      }, { synergySum: 0, xPointsSum: 0 });
    };
    const w1 = futureGames.slice(0, 10);
    const w2 = futureGames.slice(10, 20);
    const w3 = futureGames.slice(20, 30);
    const m1 = getGroupMetrics(w1);
    const m2 = getGroupMetrics(w2);
    const m3 = getGroupMetrics(w3);
    return [
      { label: 'W1_1_UTC [MATCHES 1-10]', games: w1, synergySum: m1.synergySum, xPointsSum: m1.xPointsSum },
      { label: 'W2_9_UTC [MATCHES 11-20]', games: w2, synergySum: m2.synergySum, xPointsSum: m2.xPointsSum },
      { label: 'W3_17_UTC [MATCHES 21-30]', games: w3, synergySum: m3.synergySum, xPointsSum: m3.xPointsSum }
    ];
  }, [futureGames, mokiId, allStats, counterMap, statsData, mokiSpecialties]);

  const renderMatchList = (matchList: MatchData[], offset: number = 0) => (
    <div className="terminal-card !p-0 overflow-x-auto mb-4 border-l-4 border-l-terminal-green/30 custom-scrollbar">
      <table className="w-full border-collapse font-mono text-[10px] md:text-xs">
        <thead>
          <tr className="border-b border-terminal-green bg-green-900/10 uppercase text-left whitespace-nowrap">
            <th className="p-3 md:p-4 w-8 md:w-10"></th>
            <th className="p-3 md:p-4">ID</th>
            <th className="p-3 md:p-4">OPPONENT</th>
            <th className="p-3 md:p-4 text-center">xPTS</th>
            <th className="p-3 md:p-4 text-center">SYN</th>
            <th className="p-3 md:p-4 text-right">STATUS</th>
          </tr>
        </thead>
        <tbody>
          {matchList.map((m, i) => {
            const me = m.players.find(p => p.moki_id === mokiId);
            const { synResult, synergyScore, xPoints, winProb, myRoles, oppRoles } = getMatchupDetails(m);
            const oppChamp = m.players.find(p => p.is_champion && p.moki_id !== mokiId);
            const isScored = m.match.state === 'scored';
            const won = isScored ? m.match.team_won === me?.team : null;
            const isExpanded = expandedMatch === m.match.match_id;
            const isHighConf = winProb > 60 || winProb < 40;

            return (
              <React.Fragment key={m.match.match_id}>
                <tr className={`border-b border-green-900/5 hover:bg-green-900/10 transition-colors cursor-pointer whitespace-nowrap ${isExpanded ? 'bg-green-900/20' : ''}`} onClick={() => setExpandedMatch(isExpanded ? null : m.match.match_id)}>
                  <td className="p-3 md:p-4 text-center opacity-40">{isExpanded ? '▼' : '▶'}</td>
                  <td className="p-3 md:p-4">
                    <div className="flex items-center gap-2">
                      <span className="opacity-40">{i + 1 + offset}</span>
                      {isHighConf && <Zap size={10} className="text-yellow-400 fill-yellow-400 shadow-[0_0_8px_rgba(250,204,21,0.4)]" />}
                    </div>
                  </td>
                  <td className="p-3 md:p-4 font-bold text-cyan-400">{oppChamp ? oppChamp.name : "Team"}</td>
                  <td className="p-3 md:p-4 text-center font-black text-terminal-green">{xPoints.toFixed(0)}</td>
                  <td className={`p-3 md:p-4 text-center font-bold ${getSynergyHeatColor(synergyScore)}`}>{synergyScore.toFixed(1)}</td>
                  <td className={`p-3 md:p-4 text-right font-black ${!isScored ? 'text-yellow-500 opacity-50' : won ? 'text-green-400' : 'text-red-400'}`}>{!isScored ? 'SCHED' : won ? 'WIN' : 'LOSS'}</td>
                </tr>
                {isExpanded && (
                  <tr className="bg-green-900/5 border-b border-green-900/20">
                    <td colSpan={6} className="p-4 md:p-6">
                      <div className="flex flex-col gap-6 md:gap-8">
                        <div className="w-full">
                          <h4 className="text-terminal-green font-bold mb-3 uppercase border-b border-terminal-green/30 pb-1 text-[10px] md:text-xs">Composition_Comparison</h4>
                          <div className="grid grid-cols-1 md:grid-cols-[1fr_40px_1fr] bg-black/40 border border-terminal-green/10 rounded-lg overflow-hidden">
                            <div className="p-3 md:p-4 border-b md:border-b-0 md:border-r border-terminal-green/5">
                              <div className="text-[8px] md:text-[10px] font-black text-terminal-green/60 uppercase tracking-widest mb-2 text-center">Ally_Lineup</div>
                              <div className="flex flex-wrap justify-center gap-1.5 md:gap-2 items-center">
                                {myRoles.map((r, idx) => {
                                  const label = r === 'E' ? 'Elim' : r === 'D' ? 'Depo' : r === 'W' ? 'Wart' : 'Supp';
                                  const colorClass = r === 'E' ? 'bg-red-500/20 text-red-400 border-red-500/30' : r === 'D' ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' : r === 'W' ? 'bg-blue-500/20 text-blue-400 border-blue-500/30' : 'bg-terminal-green/20 text-terminal-green border-terminal-green/30';
                                  return (<span key={idx} className={`px-2 md:px-3 py-0.5 md:py-1 border font-bold rounded-sm text-[8px] md:text-[10px] uppercase tracking-tighter ${colorClass}`}>{label}</span>);
                                })}
                              </div>
                            </div>
                            <div className="flex items-center justify-center bg-terminal-green/5 py-1 md:py-0">
                              <span className="text-[8px] md:text-[10px] font-black opacity-30 uppercase md:-rotate-90">VS</span>
                            </div>
                            <div className="p-3 md:p-4 border-t md:border-t-0 md:border-l border-terminal-green/5">
                              <div className="text-[8px] md:text-[10px] font-black text-red-500/60 uppercase tracking-widest mb-2 text-center">Opp_Lineup</div>
                              <div className="flex flex-wrap justify-center gap-1.5 md:gap-2 items-center">
                                {oppRoles.map((r, idx) => {
                                  const label = r === 'E' ? 'Elim' : r === 'D' ? 'Depo' : r === 'W' ? 'Wart' : 'Supp';
                                  const colorClass = r === 'E' ? 'bg-red-500/20 text-red-400 border-red-500/30' : r === 'D' ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' : r === 'W' ? 'bg-blue-500/20 text-blue-400 border-blue-500/30' : 'bg-terminal-green/20 text-terminal-green border-terminal-green/30';
                                  return (<span key={idx} className={`px-2 md:px-3 py-0.5 md:py-1 border font-bold rounded-sm text-[8px] md:text-[10px] uppercase tracking-tighter ${colorClass}`}>{label}</span>);
                                })}
                              </div>
                            </div>
                          </div>
                        </div>
                        
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8">
                          <div>
                            <h4 className="text-terminal-green font-bold mb-3 uppercase border-b border-terminal-green/30 pb-1 text-[10px] md:text-xs">Probability_Metrics</h4>
                            <div className="space-y-2 text-[9px] md:text-[10px]">
                              <div className="flex justify-between"><span className="opacity-60">Win_Prob_Raw:</span><span className="text-cyan-400 font-bold">{synResult.predicted_win_pct.toFixed(1)}%</span></div>
                              <div className="flex justify-between"><span className="opacity-60">Data_Strength:</span><span className="text-cyan-400 font-bold">{(synResult.confidence * 100).toFixed(1)}%</span></div>
                              <div className="flex justify-between border-t border-terminal-green/20 pt-2 mt-2"><span className="opacity-60 uppercase">Adj_Syn_Score:</span><span className={`font-bold ${getSynergyHeatColor(synergyScore)}`}>{synergyScore.toFixed(1)}</span></div>
                            </div>
                          </div>
                          <div>
                            <h4 className="text-terminal-green font-bold mb-3 uppercase border-b border-terminal-green/30 pb-1 text-[10px] md:text-xs">Reasoning_Engine</h4>
                            <div className="text-[9px] md:text-[10px] space-y-3">
                              <p className="opacity-80 leading-relaxed italic">{synResult.used_h2h ? `Found ${synResult.debug.gamesAB} historical encounters. H2H WR is ${(synResult.debug.winsA_vs_B / synResult.debug.gamesAB * 100).toFixed(1)}%.` : `Using general performance archetypes (no direct H2H).`}</p>
                              <div className="p-2 md:p-3 bg-black/40 border border-terminal-green/20 rounded">
                                <div className="flex justify-between mb-1 opacity-50 italic"><span>Expected_WR:</span><span className="text-cyan-400">{(synResult.debug.p_exp * 100).toFixed(1)}%</span></div>
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
            <tr><td colSpan={6} className="p-12 text-center opacity-30 italic">NO_DATA_AVAILABLE_FOR_CURRENT_SELECTION</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 border-b-2 border-terminal-green pb-4 gap-4">
        <div className="flex items-center gap-3 md:gap-4">
          <button onClick={onBack} className="terminal-button flex items-center justify-center p-3 md:px-4 md:py-1.5 shrink-0"><ArrowLeft size={16} /></button>
          <div className="min-w-0">
            <h2 className="text-lg md:text-2xl font-black text-terminal-green uppercase truncate">{championName}</h2>
            <div className="text-[9px] md:text-xs opacity-60 font-mono flex flex-wrap gap-x-2">
              <span>{getChampSpecialtyLabel(mokiId || '')}</span>
              <span className="opacity-30">|</span>
              <span>{targetDate || 'LATEST'}</span>
            </div>
          </div>
        </div>
      </div>
      <div className="space-y-8 md:space-y-12">
        {groupedFutureGames.map((group, idx) => (
          <div key={idx}>
            <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-4 border-b border-terminal-green/30 pb-2 gap-2">
              <h3 className="text-xs md:text-sm font-black text-cyan-400 flex items-center gap-2 uppercase tracking-tighter"><LayoutGrid size={14} className="md:w-4 md:h-4" /> {group.label}</h3>
              <div className="flex gap-4 md:gap-6 items-center font-mono w-full md:w-auto">
                <div className="flex-1 md:flex-none text-[9px] md:text-[10px] flex justify-between md:block"><span className="opacity-60 mr-2 uppercase">xPTS:</span><span className="font-bold text-terminal-green border border-green-900 px-2 py-0.5 bg-green-950/20">{group.xPointsSum.toFixed(0)}</span></div>
                <div className="flex-1 md:flex-none text-[9px] md:text-[10px] flex justify-between md:block"><span className="opacity-60 mr-2 uppercase">SYN:</span><span className={`font-bold px-2 py-0.5 border ${getSynergyHeatColor(group.synergySum / 10)}`}>{group.synergySum > 0 ? '+' : ''}{group.synergySum.toFixed(1)}</span></div>
              </div>
            </div>
            {renderMatchList(group.games, idx * 10)}
          </div>
        ))}
      </div>
    </div>
  );
};

export default App;