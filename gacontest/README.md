# Moku Grand Arena // Pro_Predictor v3.3

A high-performance, terminal-themed DFS analytics platform for Moku Grand Arena. Optimized for ultra-wide displays and high-frequency contest windows.

## 🖥️ System Overview
The Pro_Predictor uses a **Hybrid Neural Model** to project Expected DFS Points (xDFS) by combining historical performance, real-time momentum, and team composition win rates.

### 📊 Scoring Logic (DFS Standard)
- **Victory**: +300 pts
- **Elimination**: +80 pts
- **Deposit**: +50 pts
- **Wart Riding**: +45 pts per 80 units (Floored, no partials)

---

## 🧠 v3.3 Prediction Engine (Hybrid Mode)
The prediction model has evolved through multiple iterations to maximize accuracy (currently tracking ~50-60% vs random 50%).

### 1. Bayesian Adjusted Win Rate
To eliminate noise from Mokis with small sample sizes (e.g., 1-0 records), we use a Bayesian prior of 10 games at 50% WR. This pulls low-confidence stats toward the mean until a significant sample is established.

### 2. Momentum Factor (Recency Bias)
The engine tracks performance deltas between the **last 48 hours** and the **last 7 days**. Mokis trending upwards are given a "Momentum Boost" in win probability to account for recent class buffs or meta shifts.

### 3. Role Engine (Base Stat Driven)
As of v3.3, Moki roles are determined dynamically using raw base stats (`moki_totals.json`):
- **SUPPORT**: Assigned if the top two stats (STR, DEX, DEF) differ by $\le 20$.
- **ELIMINATOR**: Assigned if STR is the highest.
- **DEPOSITOR**: Assigned if DEX is the highest.
- **WART RIDER**: Assigned if DEF is the highest.

### 4. Composition Matrix
Predictions factor in the team's role combination (e.g., *Eliminator + Support + Support*) and look up historical win rates for that specific archetype against the opponent's archetype.

---

## 🛠️ Key Features
- **Triple Window Grid**: The default view, projecting total points for the three daily contest windows (01:00, 09:00, 17:00 UTC).
- **Volatility Tracking**: Calculates the Standard Deviation of points over the last 7 days to identify "Safe" anchors vs "Boom/Bust" gambles.
- **Ultra-Wide Interface**: Optimized for 27" split-screen use with a full-width terminal aesthetic.
- **Dynamic Stats Sync**: Automatically pulls the latest stats from the GitHub data stream every session to ensure projections use current class values.

## 🚀 Deployment
This is a static React/Vite application. Recommended hosting:
- **Cloudflare Pages**: Best for global CDN performance.
- **GitHub Pages**: Best for keeping code and data in one ecosystem.

---
**STATUS**: DEPLOYMENT_STABLE // VERSION_3.3 // ROLE_ENGINE_ACTIVE
