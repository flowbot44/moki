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
        
        // Map actual game classes directly instead of deriving from stats.
        // Stat-based derivation misclassifies Sprinters (SPD primary) as WART.
        const CLASS_TO_SPECIALTY = {
          'Bruiser':  'ELIM_SPECIALIST',  // STR primary — Buff form fighter
          'Center':   'ELIM_SPECIALIST',  // STR+DEF, no DEX — ELIM+WART hybrid
          'Flanker':  'ELIM_SPECIALIST',  // STR+SPD, no FORT — ELIM focused
          'Striker':  'GACHA_SPECIALIST', // DEX primary — deposit runner
          'Grinder':  'GACHA_SPECIALIST', // FORT primary — deposit speed
          'Forward':  'GACHA_SPECIALIST', // DEX+FORT, no DEF — deposit hybrid
          'Defender': 'WART_SPECIALIST',  // DEF primary — wart rider
          'Anchor':   'WART_SPECIALIST',  // DEF+DEX, no SPD — wart+deposit hybrid
          'Support':  'BALANCED',         // no STR — utility/support
          'Sprinter': 'BALANCED',         // SPD primary — 46.3% WR, no archetype edge
        };

        mokiBaseStats.data.forEach((m) => {
          statMap[m.tokenId.toString()] = m.totals;

          // Class-based specialty — winsByType removed (team-dependent, not moki-dependent).
          // A GACHA moki on an ELIM-heavy team logs elim wins, causing misclassification.
          let specialty = CLASS_TO_SPECIALTY[m.class] || 'BALANCED';
          // Stat-conditional overrides for ambiguous classes
          if (m.class === 'Grinder')  specialty = (m.totals.strength||0)  > (m.totals.dexterity||0) ? 'ELIM_SPECIALIST'  : 'GACHA_SPECIALIST';
          if (m.class === 'Defender') specialty = (m.totals.defense||0)   > (m.totals.strength||0)  ? 'WART_SPECIALIST'  : 'ELIM_SPECIALIST';
          if (m.class === 'Sprinter') specialty = (m.totals.defense||0)   > (m.totals.dexterity||0) ? 'WART_SPECIALIST'  : 'GACHA_SPECIALIST';

          specialties[m.tokenId.toString()] = specialty;
        });

        const PATCH_DATE = '2026-03-17';

        const results    = runTrueBacktest(allMatches, specialties, statMap);
        const prePatch   = runTrueBacktest(allMatches, specialties, statMap, '1970-01-01'); // all history, eval only pre-patch
        // For pre-patch we restrict allMatches to before the patch so post-patch data doesn't pollute
        const preMatches  = allMatches.filter(m => (m.match.match_date || '').slice(0, 10) < PATCH_DATE);
        const postMatches = allMatches.filter(m => (m.match.match_date || '').slice(0, 10) >= PATCH_DATE);

        const prePatchResults  = runTrueBacktest(preMatches, specialties, statMap);
        const postPatchResults = runTrueBacktest(allMatches, specialties, statMap, PATCH_DATE);

        const printResults = (label, r) => {
            console.log(`\n========================================`);
            console.log(`${label}`);
            console.log(`========================================`);
            console.log(`Global Accuracy:       ${r.accuracy.toFixed(2)}%  (${r.correctPredictions}/${r.totalMatches})`);
            console.log(`High Conf Accuracy:    ${r.highConfidenceAccuracy.toFixed(2)}%  (${r.highConfidenceCorrect}/${r.highConfidenceMatches})`);
            console.log(`Log Loss:              ${r.logLoss.toFixed(4)}`);
            console.log(`Brier Score:           ${r.brierScore.toFixed(4)}`);
            console.log(`\nCALIBRATION: PRED_WIN% | ACTUAL_WIN% | COUNT`);
            r.calibration.bins.forEach((bin, i) => {
                if (bin.count > 0) {
                    const pred = (i * 10 + 5).toString().padStart(2);
                    const actual = (bin.actual * 100).toFixed(1).padStart(5);
                    const delta = ((bin.actual * 100) - (i * 10 + 5)).toFixed(1);
                    const sign = parseFloat(delta) >= 0 ? '+' : '';
                    console.log(`  ${pred}% avg  | ${actual}%  (${sign}${delta})  | n=${bin.count}`);
                }
            });
        };

        printResults('OVERALL BACKTEST (All Data)', results);
        printResults(`PRE-PATCH  (before ${PATCH_DATE})`, prePatchResults);
        printResults(`POST-PATCH (${PATCH_DATE} onward, full history)`, postPatchResults);

        console.log('\n========================================');
        console.log('PATCH IMPACT SUMMARY');
        console.log('========================================');
        const delta = postPatchResults.accuracy - prePatchResults.accuracy;
        const sign = delta >= 0 ? '+' : '';
        console.log(`Pre-patch accuracy:   ${prePatchResults.accuracy.toFixed(2)}%`);
        console.log(`Post-patch accuracy:  ${postPatchResults.accuracy.toFixed(2)}%`);
        console.log(`Delta:                ${sign}${delta.toFixed(2)}%`);
        console.log(`Post-patch matches evaluated: ${postPatchResults.totalMatches}`);
        console.log('========================================\n');

    } catch (err) {
        console.error("Backtest failed:", err);
    }
}

main();
