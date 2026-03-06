const pako = require('pako');

const DATA_URL = 'https://flowbot44.github.io/grand-arena-builder-skill/data';

async function deepSynergy() {
  console.log("Deep Dive: Analyzing Class & Stat-Based Synergies...");
  
  const latestRes = await fetch(`${DATA_URL}/latest.json`);
  const latest = await latestRes.json();
  const partitions = latest.partitions.filter(p => p.match_count > 0).slice(-7);
  
  const mokiProfiles = {};
  const matches = [];

  for (const p of partitions) {
    const res = await fetch(`${DATA_URL}/${p.url}`);
    const buf = await res.arrayBuffer();
    const decompressed = pako.ungzip(new Uint8Array(buf), { to: 'string' });
    const data = JSON.parse(decompressed);
    matches.push(...data);

    data.forEach(m => {
      m.players.forEach(p => {
        if (!mokiProfiles[p.moki_id]) {
          mokiProfiles[p.moki_id] = { games: 0, elims: 0, deps: 0, wart: 0, class: p.class };
        }
        const perf = m.performances.find(pf => pf.moki_id === p.moki_id);
        if (perf) {
          mokiProfiles[p.moki_id].games++;
          mokiProfiles[p.moki_id].elims += perf.eliminations || 0;
          mokiProfiles[p.moki_id].deps += perf.deposits || 0;
          mokiProfiles[p.moki_id].wart += perf.wart_distance || 0;
        }
      });
    });
  }

  Object.keys(mokiProfiles).forEach(id => {
    const p = mokiProfiles[id];
    const avgE = p.elims / p.games;
    const avgD = p.deps / p.games;
    const avgW = p.wart / p.games;
    
    if (avgE > 1.0) p.specialty = 'ELIM_SPECIALIST';
    else if (avgD > 2.0) p.specialty = 'GACHA_SPECIALIST';
    else if (avgW > 100) p.specialty = 'WART_SPECIALIST';
    else p.specialty = 'BALANCED';
  });

  const synergyResults = {};

  matches.filter(m => m.match.state === 'scored').forEach(m => {
    [1, 2].forEach(teamNum => {
      const team = m.players.filter(p => p.team === teamNum);
      const champion = team.find(p => p.is_champion);
      const teammates = team.filter(p => !p.is_champion);
      const isWinner = m.match.team_won === teamNum;

      if (champion) {
        teammates.forEach(tm => {
          const profile = mokiProfiles[tm.moki_id];
          if (!profile) return;

          const classKey = `${champion.name}|${profile.class}`;
          synergyResults[classKey] = synergyResults[classKey] || { wins: 0, games: 0 };
          synergyResults[classKey].games++;
          if (isWinner) synergyResults[classKey].wins++;

          const specKey = `${champion.name}|${profile.specialty}`;
          synergyResults[specKey] = synergyResults[specKey] || { wins: 0, games: 0 };
          synergyResults[specKey].games++;
          if (isWinner) synergyResults[specKey].wins++;
        });
      }
    });
  });

  console.log("\n--- TOP CLASS SYNERGIES ---");
  Object.entries(synergyResults)
    .filter(([key, data]) => data.games > 30 && !key.includes('SPECIALIST') && !key.includes('BALANCED'))
    .sort((a, b) => (b[1].wins/b[1].games) - (a[1].wins/a[1].games))
    .slice(0, 5)
    .forEach(([key, data]) => {
      console.log(`  ${key}: ${((data.wins/data.games)*100).toFixed(1)}% WR`);
    });

  console.log("\n--- TOP SPECIALTY SYNERGIES ---");
  Object.entries(synergyResults)
    .filter(([key, data]) => data.games > 30 && (key.includes('SPECIALIST') || key.includes('BALANCED')))
    .sort((a, b) => (b[1].wins/b[1].games) - (a[1].wins/a[1].games))
    .slice(0, 5)
    .forEach(([key, data]) => {
      console.log(`  ${key}: ${((data.wins/data.games)*100).toFixed(1)}% WR`);
    });
}

deepSynergy();
