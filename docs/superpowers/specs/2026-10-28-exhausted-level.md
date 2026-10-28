# Exhausted best level: imbalance shows ±1.00

Status: open, waiting for a decision.

## Symptom

About 17% of market updates report a best level with 0 shares. In the dashboard:

- imbalance jumps to exactly +1.00 or −1.00;
- the spread on that update describes a level nobody can trade at.

## Example

ALFA's book, using the numbers from TASK.md:

```
bid $101.96 × 600 | ask $102.00 × 400
```

One update for ALFA runs these steps (`Generator.NextBatch`):

1. **Maker improves the ask by 1¢.** It spends $1,000 → 9 shares at $101.99. The book is one level per side, so the new level replaces the old one:
   ```
   bid $101.96 × 600 | ask $101.99 × 9        (the 400 @ $102.00 are forgotten)
   ```
2. **Taker buys for $2,000.** It wants 19 shares, the level has 9, so it fills 9 @ $101.99.
3. **Snapshot after the fill is emitted:**
   ```
   trade 9 @ $101.99,  bid $101.96 × 600 | ask $101.99 × 0
   imbalance = (600 − 0) / (600 + 0) = +1.00
   ```
4. **ALFA's next update** (which may come several batches later) runs `refresh`. The empty ask moves one gap further out:
   ```
   ask $102.04 × <fresh depth>
   ```
   In a real book it would fall back to $102.00 × 400.

## Root cause

An improving maker creates a thin best level that holds only its own order ($100–$5,000). A taker order is the same size, so it empties that level about half the time. The one-level book has no memory of the level behind it.

Measured over 200,000 updates (seed 42, 50 instruments):

| Config change | Updates with a 0-share level |
|---|---|
| defaults (`ImproveChancePct` 30) | 17.2% |
| spread ×10 (`MaxSpreadBps` 200) | 17.3% |
| depth ×5 | 16.6% |
| `ImproveChancePct` 10 | 7.5% |
| `ImproveChancePct` 0 | 0.2% |

- Spread width has no effect, because it changes prices, not shares.
- Depth has almost no effect, because a fresh deep level is rarely the one that runs out.
- The improve step is the cause.

A second effect of the same cause: `refresh` moves *away* from the old price instead of back to it. That's part of why spreads sit near the cap and prices are volatile at high rates.

## How real systems handle it

- **The book has many levels.** When the best ask is used up, the next resting level becomes the best ask immediately. A best level with 0 shares never exists, because a level only exists while it has shares.
- **Trades and quotes are separate messages** (e.g. Nasdaq ITCH, consolidated TAQ):
  ```
  TRADE  ALFA 9 @ $101.99
  QUOTE  ALFA bid $101.96 × 600 / ask $102.00 × 400
  ```
  When trades and quotes are combined for analysis (e.g. Lee–Ready trade classification), each trade is matched with the **prevailing quote**, the one in force just before the trade. So the trade price is always that quote's bid or ask.
- **Imbalance** is computed from levels that have shares, often summed over several levels.

## Constraints from TASK.md

- "Each update represents one simulated trade and a current bid/ask snapshot."
- "Choose each trade price from that update's bid or ask."
- Book quantities must be nonnegative. 0 is allowed, so the current output is valid, just unrealistic.

## Options

| | Change | Fake ±1.00 | TASK.md "price from that update's bid/ask" | Fixes price drift |
|---|---|---|---|---|
| A | Keep, document | 17% | yes | no |
| B | Lower `ImproveChancePct` | rarer (7.5% at 10) | yes | partly |
| C | Emit the **pre-trade quote** (prevailing quote) | never | yes | no |
| D | Remember the level behind the best (one extra level per side) | rarer | yes | yes |
| E | After the fill, promote the next level and emit it | never | no: price is the level hit, not the emitted ask | yes |

- **C** is small: in `NextBatch`, take the bid/ask snapshot before `takerTrade`. W08/W10 and the quantity-after-fill tests change. The book is still corrected on the instrument's next update.
- **D** fixes the cause:
  - When a maker improves, the old best moves into a "behind" slot.
  - `refresh` restores the behind level first, and only creates a new level one gap out when there's none.
  - This changes `book.go` and the W-requirements for refresh and maker.
- **C + D** together: no fake ±1.00 values, quotes that match the prevailing quote in real data, and prices that come back to where liquidity actually rests.

## Recommendation

**C** is enough for the dashboard metrics. Add **D** if the price path should also look realistic.
