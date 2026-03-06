const pako = require('pako');

const DATA_URL = 'https://flowbot44.github.io/grand-arena-builder-skill/data';

async function checkPairings() {
  console.log("Analyzing pairing frequency...");
  
  const latestRes = await fetch(`${DATA_URL}/latest.json`);
  const latest = await latestRes.json();
  const partitions = latest.partitions.filter(p => p.match_count > 0).slice(-7);
  
  const pairingCounts = {};

  for (const p of partitions) {
    const res = await fetch(`${DATA_URL}/${p.url}`);
    const buf = await res.arrayBuffer();
    const decompressed = pako.ungzip(new Uint8Array(buf), { to: 'string' });
    const matches = JSON.parse(decompressed);

    matches.forEach(m => {
      [1, 2].forEach(teamNum => {
        const team = m.players.filter(p => p.team === teamNum);
        const champion = team.find(p => p.is_champion);
        const nonChamps = team.filter(p => !p.is_champion);
        
        if (champion) {
          nonChamps.forEach(nc => {
            const key = `${champion.name}|${nc.moki_id}`;
            pairingCounts[key] = (pairingCounts[key] || 0) + 1;
          });
        }
      });
    });
  }

  const occurrences = Object.values(pairingCounts);
  const totalPairs = occurrences.length;
  const repeatPairs = occurrences.filter(c => c > 1).length;
  
  console.log("\n--- PAIRING ANALYSIS ---");
  console.log("Total Unique Pairs:", totalPairs);
  console.log("Repeated Pairs:", repeatPairs);
  
  const freq = {};
  occurrences.forEach(c => freq[c] = (freq[c] || 0) + 1);
  console.log("\nFrequency Distribution:");
  Object.keys(freq).sort((a,b) => b-a).forEach(count => {
    console.log(`  Seen ${count} times: ${freq[count]} pairs`);
  });
}

checkPairings();
