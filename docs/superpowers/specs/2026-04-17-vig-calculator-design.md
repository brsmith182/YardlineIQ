# Vig / No-Vig Calculator — Design Spec

**Date:** 2026-04-17
**Status:** Approved

---

## Overview

A two-sided vig/no-vig calculator that strips the sportsbook's juice from a pair of odds to reveal the true implied probabilities and fair (no-vig) odds on each side. Follows the same structure and design language as `kelly-calculator.html`.

---

## File

`public/vig-calculator.html` — self-contained single HTML file; all styles and JS inline, no external dependencies beyond the existing Google Fonts and Google Analytics tags.

---

## Scope

- Two-sided markets only (ATS, moneyline)
- No edge/EV calculation — purely a vig-stripping tool
- Multiple rows (slate view), consistent with Kelly calculator
- Toggle between American and Decimal odds input modes

---

## Inputs

### Odds Format Toggle
- Pill-style toggle matching the Kelly Normalized/Raw toggle
- Options: `American | Decimal`
- Switching format re-parses existing row values, converts them to the new format, and re-runs recalc

### Table Row Fields
| Field | Type | Notes |
|---|---|---|
| Matchup | Text input | Freetext label |
| Side A Odds | Number input | American (e.g. `-110`) or Decimal (e.g. `1.909`) |
| Side B Odds | Number input | Same format as Side A |

### Default State
- 5 pre-loaded rows at -110 / -110 (American) or 1.909 / 1.909 (Decimal)
- Default matchup labels: "Game 1", "Game 2", etc.

---

## Calculations

### Implied Probability Conversion

**American odds:**
- If odds > 0: `implied = 100 / (odds + 100)`
- If odds < 0: `implied = |odds| / (|odds| + 100)`

**Decimal odds:**
- `implied = 1 / odds`

### Vig Removal (Additive Method)
```
total  = impliedA + impliedB        // > 1.0 due to vig
noVigA = impliedA / total
noVigB = impliedB / total
vig%   = (total - 1) / total × 100
```

### Fair Odds (back-converted from no-vig probs, in active format)

**American:**
- If prob ≥ 0.5: `fair = -(prob / (1 - prob)) × 100` → negative integer
- If prob < 0.5: `fair = ((1 - prob) / prob) × 100`  → positive integer

**Decimal:**
- `fair = 1 / noVigProb`

---

## Table Columns

| # | Matchup | Odds A | Odds B | Vig % | Prob A | Prob B | Fair A | Fair B | × |
|---|---|---|---|---|---|---|---|---|---|

- Vig %, Prob A, Prob B, Fair A, Fair B are read-only computed outputs
- Prob A/B displayed as percentages (e.g. `52.4%`)
- Fair odds displayed in the active format (American or Decimal)

### Vig % Color Coding
| Range | Color |
|---|---|
| ≤ 4% | Green `#00ff88` |
| 4–6% | Amber `#ffcc00` |
| > 6% | Red `#ff6b6b` |

---

## Summary Cards (4, below table)

| Label | Value |
|---|---|
| Avg Vig % | Mean across all valid rows |
| Highest Vig | Max vig % on the slate |
| Lowest Vig | Min vig % on the slate |
| Total Lines | Count of valid rows |

---

## Editorial Sections

1. **What is vig (juice)?** — explains the sportsbook margin, why implied probs sum to >100%
2. **How to use this calculator** — numbered steps matching Kelly's style
3. **Why no-vig odds matter** — connecting fair odds to line shopping and CLV

---

## Mobile Behavior

| Breakpoint | Columns Hidden |
|---|---|
| ≤ 768px | Fair A, Fair B |
| ≤ 480px | Also Vig % |

Always visible: #, Matchup, Odds A, Odds B, Prob A, Prob B, ×

---

## Resources Page Update

- Change the Vig/No-Vig card from `div.tool-card.coming-soon` → `a.tool-card.live` with `href="/vig-calculator.html"`
- Update section count span: "1 live" → "2 live"
- Add `tool-card-link` arrow at the bottom of the card (matching Kelly card)

---

## Out of Scope

- Multi-way markets (futures)
- Edge/EV calculation against user's own probability
- Hedging calculator (separate future spec)
