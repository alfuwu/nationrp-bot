# 🗺️ Atlas NationRP: Strategic Roadmap

This document outlines complex systems and future expansions for the Atlas bot. High-complexity tasks are recommended for advanced reasoning models.

## ✅ [IN PROGRESS] 📈 Advanced Economic Simulation
**Recommended Model**: Claude Sonnet 4.5
- **Status**: **Phase 1 Implemented v1.2.0**.
- **Building Production**: Farms/Livestock produce Food. Taverns/Barracks/Castle/Palace consume Food per day.
- **Terrain Multipliers**: Plains/Riverlands boost Food. Coastal boosts Wealth. Mountain/Hills boost Ores. Swamp penalizes Wealth.
- **Stability Economy Link**: `stabilityMultiplier = (rate_stab + 10) / 20` — ALL production is scaled by stability.
- **Servus Risk/Reward**: Owning Servus gives +2%/unit production bonus but drains -1 stability per 5 Servus. Rebellion fires at stab ≤ -5.
- **Vitale Market**: Styx Empire sells Vitale at dynamic prices. Pool = `admin_base + (10 × players)`. Price rises with weekly demand. Resets each Monday.
- **Treasury Management**: National wealth vs. liquid cash flow.

## ✅ [IN PROGRESS] 👥 Population & Nobility (PF2e Inspired)
**Recommended Model**: Claude Sonnet 4.5
- **Status**: **Phase 2 Implemented v1.2.0**.
- **Growth Logic**: Pop cap = `Σ(plots × 10) + building_bonuses`. Growth = 1%/day. Famine triggers degrowth (-1%/day).
- **Nobility System**: 1 Noble per 50 Commoners. Nobles consume Vitale (1 per 5 nobles/tick). Satisfied nobles give +2 Prestige. Unsatisfied give -2 Stab, -3 Prest.
- **Noble Revolt** *(Placeholder)*: At -3 Prestige with nobles present, revolt chance fires. Defectors drawn from player's own `mil_strength` by prestige penalty ratio.
- **Recruitment**: `/atlas recruit` — Barracks required, max 10% of population, 50🪙/soldier.

## 🏭 The Styx Empire Trade
- **Vitale Acquisition**: Vitale purchased via `/atlas empire` → Buy Vitale button. Dynamic price: `50 × (1 + demandRatio × 4)`. Pool resets weekly.
- **Admin Control**: `/admin set field:vitale_base value:N` sets the weekly base allocation.

## ⚔️ Regional Warfare & Conquest
**Recommended Model**: Claude 3.5 Sonnet
- **Objective**: Tactical combat using recruited Militia inspired by wargame tabletop rules.
- **Features**: Deployment of military strength, terrain advantages, and diplomatic fallout.
- **Rebellion Suppression** *(Placeholder)*: Servus Rebellion and Noble Revolt events are currently placeholders. The "Deploy Military" and "Call for Loyalty" buttons will connect to the full combat resolution system once warfare is implemented. Currently resolves with a -1 stability placeholder penalty.
- **Recruitment**: `/atlas recruit` is already implemented — soldiers can be conscripted from the commoner population (max 10%) and maintained via food supply.

## 🤝 Dynamic Diplomacy Engine
**Recommended Model**: Claude 3.5 Sonnet
- **Objective**: Intuitive GM-controlled faction relations.
- **Features**: Treaties, alliances, and the Styx Empire's favor.

## 🧹 Codebase Refactoring & Modularization
**Recommended Model**: Gemini 3.1 Pro (High)
- **Objective**: Break down the monolithic `atlas.js` file (currently ~1900 lines) into smaller, domain-specific modules.
- **Target Architecture**:
  - `src/commands/town/` (Build, Upgrade, Demolish, Settle GUIs)
  - `src/commands/economy/` (Tax, Balance, Trade, Donate, Market)
  - `src/commands/character/` (Profile, Origins Modal, Submissions)
  - `src/commands/actions/` (Scout, Recruit)
- **Status**: **Planned**. To be executed before further feature bloat to maintain efficiency and reduce LLM token overhead during updates.

---
*Note: Simple feature requests and UI tweaks can be handled by Gemini 3 Flash.*
