// Backtest Runner (Standalone CLI)
import fs from 'fs';
import pako from 'pako';
import { runTrueBacktest } from './src/utils/backtest-logic.ts';

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
        const partitions = latest.partitions.filter(p => p.match_count > 0);
        
        console.log(`Loading ${partitions.length} partitions...`);
        const allMatches = [];
        for (const p of partitions) {
            const data = await fetchPartition(p.url);
            allMatches.push(...data);
        }

        const specialties = {};
        const statMap = {};
        const mokiTotalsUrl = `${DATA_URL}/${latest.moki_totals.url}`;
        const mokiRes = await fetch(mokiTotalsUrl);
        const mokiBaseStats = await mokiRes.json();
        
        mokiBaseStats.data.forEach((m) => {
          statMap[m.tokenId.toString()] = m.totals;
          const str = m.totals.strength || 0;
          const dex = m.totals.dexterity || 0;
          const def = m.totals.defense || 0;
          const sorted = [{ type: 'ELIM_SPECIALIST', val: str }, { type: 'GACHA_SPECIALIST', val: dex }, { type: 'WART_SPECIALIST', val: def }].sort((a, b) => b.val - a.val);
          if (Math.abs(sorted[0].val - sorted[1].val) <= 5) specialties[m.tokenId.toString()] = 'BALANCED';
          else specialties[m.tokenId.toString()] = sorted[0].type;
        });

        const results = runTrueBacktest(allMatches, specialties, statMap);

        console.log("\n========================================");
        console.log("TRUE BACKTEST RESULTS (No Look-Ahead)");
        console.log("========================================");
        console.log(`Global Accuracy:  ${results.accuracy.toFixed(2)}%`);
        console.log(`High Conf Acc:    ${results.highConfidenceAccuracy.toFixed(2)}%`);
        
        console.log("\n========================================");
        console.log("CALIBRATION (Do probabilities match outcomes?)");
        console.log("========================================");
        console.log("PRED_WIN% | ACTUAL_WIN% | COUNT");
        results.calibration.bins.forEach((bin, i) => {
            if (bin.count > 0) {
                console.log(`${((i*10)+5).toString().padStart(2)}% avg   | ${(bin.actual * 100).toFixed(1).padStart(5)}%     | ${bin.count.toString().padStart(5)}`);
            }
        });
        console.log("========================================\n");

    } catch (err) {
        console.error("Backtest failed:", err);
    }
}

main();
