// Data Analysis Script v2
import fs from 'fs';
import pako from 'pako';

const DATA_URL = 'https://flowbot44.github.io/grand-arena-builder-skill/data';

async function fetchLatest() {
    const res = await fetch(`${DATA_URL}/latest.json`);
    return await res.json();
}

async function fetchPartition(url) {
    const res = await fetch(`${DATA_URL}/${url}`);
    const buffer = await res.arrayBuffer();
    const decompressed = pako.ungzip(new Uint8Array(buffer), { to: 'string' });
    return JSON.parse(decompressed);
}

async function main() {
    try {
        const latest = await fetchLatest();
        const partitions = latest.partitions.filter(p => p.match_count > 0).slice(-10); 
        
        console.log(`Analyzing ${partitions.length} partitions for win correlations...`);
        const allMatches = [];
        for (const p of partitions) {
            const data = await fetchPartition(p.url);
            allMatches.push(...data);
        }

        const statsByWinType = {}; // type -> { winners: Stats, losers: Stats, count: number }

        const statMap = {};
        const mokiTotalsUrl = `${DATA_URL}/${latest.moki_totals.url}`;
        const mokiRes = await fetch(mokiTotalsUrl);
        const mokiBaseStats = await mokiRes.json();
        mokiBaseStats.data.forEach(m => {
            statMap[m.tokenId.toString()] = m.totals;
        });

        allMatches.forEach(m => {
            if (m.match.state !== 'scored' || !m.match.win_type) return;
            
            const wt = m.match.win_type.toLowerCase();
            if (!statsByWinType[wt]) {
                statsByWinType[wt] = { 
                    winners: { str: 0, spd: 0, def: 0, dex: 0, fort: 0 },
                    losers: { str: 0, spd: 0, def: 0, dex: 0, fort: 0 },
                    count: 0 
                };
            }

            const winTeam = m.match.team_won;
            const winners = m.players.filter(p => p.team === winTeam);
            const losers = m.players.filter(p => p.team !== winTeam);

            winners.forEach(p => {
                const s = statMap[p.token_id.toString()];
                if (s) {
                    statsByWinType[wt].winners.str += s.strength || 0;
                    statsByWinType[wt].winners.spd += s.speed || 0;
                    statsByWinType[wt].winners.def += s.defense || 0;
                    statsByWinType[wt].winners.dex += s.dexterity || 0;
                    statsByWinType[wt].winners.fort += s.fortitude || 0;
                }
            });

            losers.forEach(p => {
                const s = statMap[p.token_id.toString()];
                if (s) {
                    statsByWinType[wt].losers.str += s.strength || 0;
                    statsByWinType[wt].losers.spd += s.speed || 0;
                    statsByWinType[wt].losers.def += s.defense || 0;
                    statsByWinType[wt].losers.dex += s.dexterity || 0;
                    statsByWinType[wt].losers.fort += s.fortitude || 0;
                }
            });

            statsByWinType[wt].count++;
        });

        console.log("\n========================================");
        console.log("WIN TYPE ANALYSIS: WINNERS VS LOSERS AVG STATS");
        console.log("========================================");
        
        Object.entries(statsByWinType).sort((a,b) => b[1].count - a[1].count).forEach(([type, data]) => {
            const n = data.count * 3; // 3 mokis per team
            console.log(`TYPE: ${type.toUpperCase()} (${data.count} games)`);
            console.log(`       STR     SPD     DEF     DEX     FORT`);
            console.log(`WIN:  ${(data.winners.str/n).toFixed(0).padStart(4)}    ${(data.winners.spd/n).toFixed(0).padStart(4)}    ${(data.winners.def/n).toFixed(0).padStart(4)}    ${(data.winners.dex/n).toFixed(0).padStart(4)}    ${(data.winners.fort/n).toFixed(0).padStart(4)}`);
            console.log(`LOSS: ${(data.losers.str/n).toFixed(0).padStart(4)}    ${(data.losers.spd/n).toFixed(0).padStart(4)}    ${(data.losers.def/n).toFixed(0).padStart(4)}    ${(data.losers.dex/n).toFixed(0).padStart(4)}    ${(data.losers.fort/n).toFixed(0).padStart(4)}`);
            
            const diff = {
                str: (data.winners.str - data.losers.str) / n,
                spd: (data.winners.spd - data.losers.spd) / n,
                def: (data.winners.def - data.losers.def) / n,
                dex: (data.winners.dex - data.losers.dex) / n,
                fort: (data.winners.fort - data.losers.fort) / n
            };
            console.log(`DIFF: ${diff.str.toFixed(1).padStart(4)}    ${diff.spd.toFixed(1).padStart(4)}    ${diff.def.toFixed(1).padStart(4)}    ${diff.dex.toFixed(1).padStart(4)}    ${diff.fort.toFixed(1).padStart(4)}`);
            console.log("----------------------------------------");
        });

    } catch (err) {
        console.error("Analysis failed:", err);
    }
}

main();
