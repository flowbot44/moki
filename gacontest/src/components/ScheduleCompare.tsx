import React, { useState } from 'react';
import { scoreSchedule } from '../lib/matchupScore';
import type { Role, ScheduledGame, StatsData, ScheduleOptions } from '../lib/matchupScore';

interface ScheduleCompareProps {
  data: StatsData;
}

const ROLES: Role[] = ["E", "S", "W", "D"];

const createEmptySchedule = (): ScheduledGame[] => {
  return Array.from({ length: 10 }).map((_, i) => ({
    team: ["E", "E", "E"],
    opponent: ["W", "W", "W"],
    meta: { opponentName: `Game ${i + 1}` }
  }));
};

export const ScheduleCompare: React.FC<ScheduleCompareProps> = ({ data }) => {
  const [scheduleA, setScheduleA] = useState<ScheduledGame[]>(createEmptySchedule());
  const [scheduleB, setScheduleB] = useState<ScheduledGame[]>(createEmptySchedule());
  const [options, setOptions] = useState<ScheduleOptions>({ K: 4, lambda: 0.75 });

  const updateGame = (sched: 'A' | 'B', index: number, field: 'team' | 'opponent', roleIndex: number, role: Role) => {
    const target = sched === 'A' ? scheduleA : scheduleB;
    const setter = sched === 'A' ? setScheduleA : setScheduleB;

    const newSched = [...target];
    newSched[index] = { ...newSched[index] };
    newSched[index][field] = [...newSched[index][field]];
    newSched[index][field][roleIndex] = role;
    
    setter(newSched);
  };

  const resA = scoreSchedule(scheduleA, data, options);
  const resB = scoreSchedule(scheduleB, data, options);

  const renderGameList = (title: string, schedule: ScheduledGame[], schedKey: 'A' | 'B') => (
    <div className="flex flex-col gap-4 bg-green-900/10 p-4 border border-green-900/30">
      <h3 className="text-lg font-bold text-cyan-400">{title}</h3>
      {schedule.map((game, i) => (
        <div key={i} className="flex flex-col gap-1 text-xs mb-2 border-b border-green-900/20 pb-2">
          <div className="opacity-50 font-bold mb-1">Game {i + 1}</div>
          <div className="flex gap-4 items-center">
            <div className="flex gap-1">
              <span className="opacity-60 mr-2 w-8">Team:</span>
              {game.team.map((r, rIdx) => (
                <select
                  key={`t-${rIdx}`}
                  value={r}
                  onChange={(e) => updateGame(schedKey, i, 'team', rIdx, e.target.value as Role)}
                  className="bg-black border border-terminal-green text-terminal-green p-1 outline-none"
                >
                  {ROLES.map(role => <option key={role} value={role}>{role}</option>)}
                </select>
              ))}
            </div>
            <span className="opacity-50">vs</span>
            <div className="flex gap-1">
              <span className="opacity-60 mr-2 w-8">Opp:</span>
              {game.opponent.map((r, rIdx) => (
                <select
                  key={`o-${rIdx}`}
                  value={r}
                  onChange={(e) => updateGame(schedKey, i, 'opponent', rIdx, e.target.value as Role)}
                  className="bg-black border border-terminal-green text-terminal-green p-1 outline-none"
                >
                  {ROLES.map(role => <option key={role} value={role}>{role}</option>)}
                </select>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <div className="terminal-card flex flex-col gap-6 p-4">
      <div className="flex justify-between items-center border-b border-terminal-green pb-2">
        <h2 className="text-xl font-bold text-terminal-green uppercase">10-Game Schedule Compare</h2>
        <div className="flex gap-4 text-xs font-mono">
          <label className="flex items-center gap-2">
            Target K:
            <input type="number" min="0" max="10" value={options.K} onChange={(e) => setOptions(prev => ({ ...prev, K: Number(e.target.value) }))} className="bg-black border border-terminal-green w-12 p-1 text-center" />
          </label>
          <label className="flex items-center gap-2">
            Lambda (λ):
            <input type="number" step="0.1" value={options.lambda} onChange={(e) => setOptions(prev => ({ ...prev, lambda: Number(e.target.value) }))} className="bg-black border border-terminal-green w-16 p-1 text-center" />
          </label>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {renderGameList('Schedule A', scheduleA, 'A')}
        {renderGameList('Schedule B', scheduleB, 'B')}
      </div>

      <div className="mt-8 border-t border-terminal-green pt-4">
        <h3 className="text-lg font-bold mb-4 uppercase">Metrics Comparison</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse font-mono text-sm">
            <thead>
              <tr className="border-b border-green-900/30 bg-green-900/20">
                <th className="p-3">Metric</th>
                <th className="p-3">Schedule A (Raw)</th>
                <th className="p-3 text-cyan-400">Sched A (Adj)</th>
                <th className="p-3">Schedule B (Raw)</th>
                <th className="p-3 text-cyan-400">Sched B (Adj)</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-green-900/10">
                <td className="p-3 opacity-70">Expected Wins</td>
                <td className="p-3 font-bold">{resA.expected_wins.toFixed(2)}</td>
                <td className="p-3 text-cyan-400 font-bold">{resA.expected_wins_adj.toFixed(2)}</td>
                <td className="p-3 font-bold">{resB.expected_wins.toFixed(2)}</td>
                <td className="p-3 text-cyan-400 font-bold">{resB.expected_wins_adj.toFixed(2)}</td>
              </tr>
              <tr className="border-b border-green-900/10">
                <td className="p-3 opacity-70">Std Dev (Volatility)</td>
                <td className="p-3">{resA.std_dev_wins.toFixed(2)}</td>
                <td className="p-3 text-cyan-400">{resA.std_dev_wins_adj.toFixed(2)}</td>
                <td className="p-3">{resB.std_dev_wins.toFixed(2)}</td>
                <td className="p-3 text-cyan-400">{resB.std_dev_wins_adj.toFixed(2)}</td>
              </tr>
              <tr className="border-b border-green-900/10">
                <td className="p-3 opacity-70">Chance ≤ {options.K} Wins</td>
                <td className="p-3">{(resA.chance_at_most_K * 100).toFixed(1)}%</td>
                <td className="p-3 text-cyan-400">{(resA.chance_at_most_K_adj * 100).toFixed(1)}%</td>
                <td className="p-3">{(resB.chance_at_most_K * 100).toFixed(1)}%</td>
                <td className="p-3 text-cyan-400">{(resB.chance_at_most_K_adj * 100).toFixed(1)}%</td>
              </tr>
              <tr className="border-b border-green-900/10 bg-green-900/5">
                <td className="p-3 font-bold text-terminal-green">Schedule Value Score</td>
                <td className="p-3 font-black text-lg">{resA.schedule_value_score.toFixed(2)}</td>
                <td className="p-3 font-black text-lg text-cyan-400">{resA.schedule_value_score_adj.toFixed(2)}</td>
                <td className="p-3 font-black text-lg">{resB.schedule_value_score.toFixed(2)}</td>
                <td className="p-3 font-black text-lg text-cyan-400">{resB.schedule_value_score_adj.toFixed(2)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mt-6">
        <div>
          <h4 className="font-bold text-cyan-400 mb-2 uppercase text-xs">Sched A: Extremes</h4>
          <div className="flex flex-col gap-2 opacity-80 text-xs">
            <div>
              <span className="text-terminal-green">Easiest:</span> 
              {resA.top_3_easiest.map(g => ` ${g.meta?.opponentName} (${(g.p*100).toFixed(0)}%)`).join(', ')}
            </div>
            <div>
              <span className="text-red-400">Hardest:</span> 
              {resA.bottom_3_hardest.map(g => ` ${g.meta?.opponentName} (${(g.p*100).toFixed(0)}%)`).join(', ')}
            </div>
          </div>
        </div>
        <div>
          <h4 className="font-bold text-cyan-400 mb-2 uppercase text-xs">Sched B: Extremes</h4>
          <div className="flex flex-col gap-2 opacity-80 text-xs">
            <div>
              <span className="text-terminal-green">Easiest:</span> 
              {resB.top_3_easiest.map(g => ` ${g.meta?.opponentName} (${(g.p*100).toFixed(0)}%)`).join(', ')}
            </div>
            <div>
              <span className="text-red-400">Hardest:</span> 
              {resB.bottom_3_hardest.map(g => ` ${g.meta?.opponentName} (${(g.p*100).toFixed(0)}%)`).join(', ')}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
