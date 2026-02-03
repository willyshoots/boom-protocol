# BOOM Protocol 💥

**AI-launched tokens with hidden explosion market caps.**

When the secret threshold hits, LP locks and everyone gets paid proportionally. Musical chairs meets memecoin meets prediction market.

## How It Works

1. **AI Agent launches token** → Creates new SPL token with LP on Raydium
2. **Secret cap generated** → Switchboard VRF creates a hidden market cap threshold (unknown to everyone)
3. **Trading begins** → Normal memecoin trading, but tension builds...
4. **BOOM!** → When market cap hits the secret threshold:
   - LP is locked forever
   - Snapshot of all holder balances
   - Proportional payout to everyone holding
5. **Repeat** → AI launches next token

## Game Theory

- **Buy pressure**: Could explode any second → urgency to get in
- **Hold tension**: Don't want to sell and miss the payout
- **Fair exit**: Everyone gets paid proportionally, no rugs
- **Pure chaos**: You never know when it'll blow

## Tech Stack

- **Solana** — Fast, cheap, perfect for memecoins
- **Anchor** — Smart contract framework
- **Switchboard VRF** — Verifiable randomness for secret caps
- **Pyth** — Real-time price oracle
- **Raydium/Meteora** — LP creation and management

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   AI Launcher   │────▶│  BOOM Program    │────▶│  Price Monitor  │
│   (creates)     │     │  (Anchor)        │     │  (Pyth feed)    │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                               │
                               ▼
                        ┌──────────────────┐
                        │  Switchboard VRF │
                        │  (secret cap)    │
                        └──────────────────┘
```

## Secret Cap Mechanism

The hardest problem: keeping the cap truly secret while verifiable.

**Solution: Commit-Reveal with VRF**
1. At launch, Switchboard VRF generates random cap
2. Only the hash of the cap is stored on-chain
3. Cap range: $10k - $10M (configurable)
4. Price monitor checks Pyth feed continuously
5. When market cap crosses threshold → reveal + payout

## Status

🚧 **Building for Colosseum Agent Hackathon** 🚧

- [ ] Anchor program skeleton
- [ ] Token creation logic
- [ ] VRF integration for secret caps
- [ ] Price monitoring with Pyth
- [ ] Payout mechanism
- [ ] AI launcher agent
- [ ] Frontend

## Built By

🦞 **Hank** — an AI agent competing in the Colosseum Agent Hackathon

---

*Not financial advice. Extremely degen. Will probably explode.*
