import React, { useState } from 'react';
import { scoreMatchup } from '../lib/matchupScore';
import type { Role, StatsData } from '../lib/matchupScore';

interface MatchupScorerProps {
  data: StatsData;
}

const ROLES: Role[] = ["E", "S", "W", "D"];

export const MatchupScorer: React.FC<MatchupScorerProps> = ({ data }) => {
  const [teamA, setTeamA] = useState<Role[]>(["E", "E", "E"]);
  const [teamB, setTeamB] = useState<Role[]>(["W", "W", "W"]);

  const updateRole = (team: 'A' | 'B', index: number, role: Role) => {
    if (team === 'A') {
      const newTeam = [...teamA];
      newTeam[index] = role;
      setTeamA(newTeam);
    } else {
      const newTeam = [...teamB];
      newTeam[index] = role;
      setTeamB(newTeam);
    }
  };

  const result = scoreMatchup(teamA, teamB, data);

  const renderDropdowns = (team: 'A' | 'B', currentRoles: Role[]) => (
    <div className="flex gap-2">
      {currentRoles.map((role, idx) => (
        <select
          key={idx}
          value={role}
          onChange={(e) => updateRole(team, idx, e.target.value as Role)}
          className="bg-black border border-terminal-green text-terminal-green p-2 text-sm outline-none"
        >
          {ROLES.map(r => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
      ))}
    </div>
  );

  return (
    <div className="terminal-card flex flex-col gap-6 p-4">
      <h2 className="text-xl font-bold text-terminal-green uppercase border-b border-terminal-green pb-2">Single Matchup Scorer</h2>
      
      <div className="flex flex-col md:flex-row justify-between gap-8">
        <div className="flex flex-col gap-2">
          <label className="text-sm font-bold text-cyan-400">Team A Roles</label>
          {renderDropdowns('A', teamA)}
          <div className="text-xs opacity-50 mt-1">Canonical: {result.canonicalA}</div>
        </div>

        <div className="flex items-center justify-center font-bold text-lg opacity-50">VS</div>

        <div className="flex flex-col gap-2">
          <label className="text-sm font-bold text-yellow-400">Team B Roles</label>
          {renderDropdowns('B', teamB)}
          <div className="text-xs opacity-50 mt-1">Canonical: {result.canonicalB}</div>
        </div>
      </div>

      <div className="bg-green-900/10 border border-green-900/30 p-4 mt-4 grid grid-cols-1 md:grid-cols-3 gap-4 text-center">
        <div>
          <div className="text-xs opacity-60 uppercase mb-1">Win Probability (Team A)</div>
          <div className="text-3xl font-black text-[#00ff41]">
            {result.predicted_win_pct.toFixed(1)}%
          </div>
        </div>
        <div>
          <div className="text-xs opacity-60 uppercase mb-1">Confidence Model</div>
          <div className="text-xl font-bold mt-1">
            {(result.confidence * 100).toFixed(1)}%
          </div>
          <div className="text-[10px] opacity-40 mt-1">
            {result.used_h2h ? `H2H Data Used (${result.debug.gamesAB} games)` : 'Baseline Only'}
          </div>
        </div>
        <div>
          <div className="text-xs opacity-60 uppercase mb-1">Safe Score</div>
          <div className="text-xl font-bold mt-1 text-cyan-400">
            {result.safe_score.toFixed(1)}
          </div>
        </div>
      </div>
    </div>
  );
};
