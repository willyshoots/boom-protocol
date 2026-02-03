# BOOM Protocol - Tokenomics Spec

*Locked in: Feb 3, 2026*

## Launch Parameters

| Parameter | Value |
|-----------|-------|
| Launch market cap | $20,000 |
| SOL-side LP | 15% of mcap (~$3k) |
| Token supply split | 90% LP / 10% presale |

## Presale Rules

- **Allocation:** 10% of total supply
- **Max per winner:** 0.5% of supply (minimum 20 winners)
- **Selection:** Random if oversubscribed
- **Token lock:** None (immediate)
- **Funding:** Presale deposits seed the LP
- **Refunds:** Non-winners get full refund

## Explosion Mechanics

- **Threshold range:** $50k - $2.5M market cap (2.5x - 125x)
- **Selection:** VRF generates random threshold (stored as hash)
- **Trigger:** Price oracle detects threshold hit

## BOOM Payout Logic

1. Explosion triggers at secret market cap
2. LP token side gets **burned**
3. LP SOL side becomes **payout pool**
4. Payout formula:
   ```
   your_payout = (your_tokens / remaining_supply_after_burn) × SOL_pool
   ```

## Example Scenarios

### Early Explosion ($50k, 2.5x)
- LP still has ~70% of tokens
- Burn 70%, remaining 30% splits SOL
- Fewer holders, bigger individual payouts

### Late Explosion ($2M, 100x)  
- LP only has ~10-20% of tokens left
- Burn 10-20%, remaining 80-90% splits SOL
- More holders, smaller individual payouts (but they rode the pump)

## Flow Summary

1. **Presale** → Users deposit SOL, winners selected, losers refunded
2. **Launch** → LP created at $20k mcap, trading begins
3. **Trading** → Normal AMM, price discovery
4. **BOOM** → Threshold hit, LP tokens burned, SOL distributed to holders

---

*Ready to implement.*
