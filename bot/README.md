# BOOM Protocol Price Monitor Bot 💥

A Python bot that monitors token prices and triggers explosions when the market cap threshold is reached.

## Overview

This bot:
1. Continuously polls token price from Jupiter API (or Pyth Network)
2. Calculates market cap based on price × supply
3. When market cap hits the configured threshold, calls `trigger_explosion` on-chain
4. Logs all activity for monitoring

## Requirements

- Python 3.10+
- Solana CLI configured with devnet
- A funded wallet for transaction fees

## Installation

```bash
# Navigate to bot directory
cd boom-protocol/bot

# Create virtual environment
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt
```

## Configuration

1. Copy the example environment file:
```bash
cp .env.example .env
```

2. Edit `.env` with your settings:
```env
# The token mint address to monitor
BOOM_TOKEN_MINT=YourTokenMintAddressHere

# Market cap threshold (USD) - when to trigger explosion
BOOM_MARKET_CAP_THRESHOLD=100000

# Start in dry run mode (recommended for testing)
BOOM_DRY_RUN=true
```

3. Make sure your Solana wallet is configured:
```bash
# Check your wallet
solana address

# Make sure you have devnet SOL
solana airdrop 2 --url devnet
```

## Usage

### Basic Usage

```bash
# Activate virtual environment
source venv/bin/activate

# Run the monitor
python monitor.py
```

### With Custom Settings

```bash
# Override settings via environment
BOOM_TOKEN_MINT=SoMeT0kenM1nt... BOOM_MARKET_CAP_THRESHOLD=50000 python monitor.py
```

### Running in Background

```bash
# Using nohup
nohup python monitor.py > bot_output.log 2>&1 &

# Or with screen
screen -S boom-bot
python monitor.py
# Ctrl+A, D to detach
```

## Architecture

```
bot/
├── config.py        # Configuration management (pydantic-settings)
├── price_feed.py    # Price feed adapters (Jupiter, Pyth, Mock)
├── solana_client.py # Solana/Anchor client for on-chain calls
├── monitor.py       # Main monitoring loop
└── requirements.txt # Python dependencies
```

### Price Feeds

The bot supports multiple price feed sources:

1. **Jupiter API** (default) - Simple REST API, great for MVP
2. **Pyth Network** - More accurate, requires feed ID mapping
3. **Mock** - For testing, simulates price climbing

### Solana Client

Uses `solana-py` and `solders` to:
- Derive PDAs for protocol and boom_token accounts
- Build and sign `trigger_explosion` transactions
- Query token supply for market cap calculation

## Testing

### Dry Run Mode

The bot starts in dry run mode by default (`BOOM_DRY_RUN=true`). In this mode:
- All price checks happen normally
- Threshold detection works
- But no actual transaction is sent

Perfect for testing your setup before going live.

### Mock Price Feed

For testing without a real token:

```python
# In price_feed.py, the MockPriceFeed simulates prices
# Edit config to use it:
BOOM_USE_JUPITER=false
# Don't set BOOM_PYTH_PRICE_FEED_ID
# This will fall back to mock
```

### Local Testing

```bash
# Run with mock data
BOOM_USE_JUPITER=false \
BOOM_TOKEN_MINT=test123 \
BOOM_MARKET_CAP_THRESHOLD=1000 \
python monitor.py
```

## Devnet Deployment

1. Deploy the BOOM Protocol to devnet:
```bash
cd ../programs/boom
anchor build
anchor deploy --provider.cluster devnet
```

2. Note the program ID and update your `.env`:
```env
BOOM_PROGRAM_ID=<deployed-program-id>
```

3. Create a test token and start the bot:
```bash
# Run the bot
python monitor.py
```

## Monitoring

The bot logs all activity with structured logging:

```
2026-02-03T01:15:00 [INFO] price_check price=0.0042 market_cap=42000.00 threshold=100000.00
2026-02-03T01:15:05 [INFO] price_check price=0.0051 market_cap=51000.00 threshold=100000.00
2026-02-03T01:15:10 [INFO] threshold_reached market_cap=101000.00 threshold=100000.00
2026-02-03T01:15:10 [INFO] 💥 BOOM! Token exploded!
```

Logs are written to:
- Console (with colors via Rich)
- File (if `BOOM_LOG_FILE` is set)

## Troubleshooting

### "Token not found in Jupiter"
- Make sure the token is listed on Jupiter
- For devnet tokens, use Pyth or mock feed instead

### "Keypair not found"
- Run `solana-keygen new` to create a wallet
- Or set `BOOM_KEYPAIR_PATH` to your existing keypair

### "Transaction failed"
- Make sure you have SOL for fees: `solana airdrop 2`
- Check the program is deployed: `solana program show <program-id>`
- Verify the token mint exists

## Security Notes

⚠️ **Important:**
- Never commit your `.env` file or keypair
- Use a dedicated bot wallet, not your main wallet
- Start with dry run mode until you're confident
- The revealed cap must match the hash stored on-chain

## License

MIT - Part of BOOM Protocol for Colosseum Agent Hackathon
