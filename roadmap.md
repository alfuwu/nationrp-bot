# 🗺️ Atlas NationRP: Strategic Roadmap

This document outlines complex systems and future expansions for the Atlas bot. High-complexity tasks are recommended for advanced reasoning models.

## ✅ [IN PROGRESS] 📈 Advanced Economic Simulation
**Recommended Model**: Gemini 2.5 Pro / Claude Sonnet
- **Status**: **Phase 2 Active — v1.3.0**.
- **Building Production**: Farms/Livestock produce Food. Taverns/Barracks/Castle/Palace consume Food per day.
- **Terrain Multipliers**: Plains/Riverlands boost Food. Coastal boosts Wealth. Mountain/Hills boost Ores. Swamp penalizes Wealth.
- **Stability Economy Link**: `stabilityMultiplier` — soft curve 0.30→1.30 — ALL production is scaled by stability.
- **Servus Risk/Reward**: Owning Servus gives +2%/unit production bonus but drains -1 stability per 5 Servus. Rebellion fires at stab ≤ -5.
- **Vitale Market**: Styx Empire sells Vitale at dynamic prices. Pool = `admin_base + (10 × players)`. Price rises with weekly demand. Resets each Monday.
- **Treasury Management**: National wealth vs. liquid cash flow.
- **Food Rot** *(v1.3.0)*: 5% daily rot on food_surplus post-maintenance — prevents indefinite hoarding.
- **Tiered Pop Growth** *(v1.3.0)*: food≥1000 → +2%/day | food≥200 → +1.5%/day | food>0 → +1%/day | famine → -1%/day.
- **Building Wealth Gate** *(v1.3.0)*: Build/upgrade blocked if player has insufficient wealth — prevents debt.

## ✅ [IN PROGRESS] 👥 Population & Nobility (PF2e Inspired)
**Recommended Model**: Gemini 2.5 Pro / Claude Sonnet
- **Status**: **Phase 2 Implemented v1.2.0**.
- **Growth Logic**: Pop cap = `Σ(plots × 10) + building_bonuses`. Tiered growth by food level. Famine triggers degrowth.
- **Nobility System**: 1 Noble per 50 Commoners. Nobles consume Vitale (1 per 5 nobles/tick). Satisfied nobles give +2 Prestige. Unsatisfied give -2 Stab, -3 Prest.
- **Noble Revolt** *(Placeholder)*: At -3 Prestige with nobles present, revolt chance fires.
- **Recruitment**: `/atlas military` → Recruit — max 10% of commoners, scales down automatically as pop drops.

## 🏭 The Styx Empire Trade
- **Vitale Acquisition**: Vitale purchased via `/atlas empire` → Buy Vitale button. Dynamic price: `50 × (1 + demandRatio × 4)`. Pool resets weekly.
- **Admin Control**: `/admin set field:vitale_base value:N` sets the weekly base allocation.

## ✅ [COMPLETE] 🤝 Trade System Overhaul (v1.3.0)
- **One-Time Player Trade**: Now uses dropdown resource selectors (Step 1: give resource → Step 2: receive resource → Step 3: quantities modal). Food (`food_surplus`) is fully tradeable.
- **Trade Consent Flow**: One-time trades now send a proposal embed to the recipient with Accept/Decline buttons. No immediate execution.
- **Player Trade Routes**: Now use dropdown resource selectors (give → receive → amounts+duration modal). Sent as pending proposals to partner.
- **Faction Trade Preview**: Before opening amount modal, shows current exchange rate preview embed — Styx trades show live Vitale price.
- **`pending_trades` Table**: New DB table tracks one-time trade proposals with consent state.

## ⚔️ Regional Warfare & Conquest
**Recommended Model**: Gemini 2.5 Pro
- **Status**: Active — v1.3.0 patches applied.
- **Battle Modal Fix** *(v1.3.0)*: `warcomp` modal now uses 5-field format (`mil_militia` combined inf pool, cavalry, ranged, siege, mercs). Field IDs match submit handler.
- **Raid Result Embed** *(v1.3.0)*: `handleRaidWithdraw` now emits a proper result embed to attacker and notifies defender via DM.
- **safeReply** *(v1.3.0)*: `safeReply` helper in `helpers.js` — graceful deferred-interaction error handling.
- **Mercenaries**: Cost reduced to **150 coins/unit** — accessible early-game town defense without barracks.

## ⚔️ Colosseum
- **Rematch Button** *(v1.3.0)*: After a duel completes, a **⚔️ Rematch** button appears in the result embed. Either participant can request a rematch — creates a new duel and notifies opponent.
- **uid Scope Fix** *(v1.3.0)*: Fixed variable shadowing in `myduels` select handler.
- **Stance Error Safety** *(v1.3.0)*: `handleStanceSelect` wrapped in try/catch with `safeReply` fallback.

## 🤝 Dynamic Diplomacy Engine
**Recommended Model**: Gemini 2.5 Pro
- **Objective**: Intuitive GM-controlled faction relations.
- **Features**: Treaties, alliances, and the Styx Empire's favor.

## 🧹 Codebase Refactoring & Modularization
**Recommended Model**: Gemini 2.5 Pro (High)
- **Objective**: Further domain separation for economy and warfare modules.
- **Status**: Partially done — all 12 command files are domain-specific. Main `atlas.js` serves as router only.
- **Pending**: Split large `economy.js` (900+ lines) and `warfare.js` (1000+ lines) into sub-modules if needed.

---
*v1.3.0 — Last updated: 2026-05-23 — Simple tweaks: Gemini Flash. Complex systems: Gemini 2.5 Pro.*
