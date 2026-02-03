# BOOM Protocol Frontend 💥

A crash-gambling meets memecoins trading interface built for the Colosseum Agent Hackathon.

## Features

- 🎨 Dark theme with ACME/Looney Tunes-inspired TNT branding
- 📊 Live candlestick chart (TradingView-style with lightweight-charts)
- 💚 Green BUY / Red SELL buttons
- 👛 Phantom wallet connection via @solana/wallet-adapter
- 📈 Market cap tracking with secret explosion threshold
- 💥 Explosion overlay with confetti when token goes BOOM
- ⏳ Presale panel with countdown timer and lottery system
- 📱 Responsive design for mobile and desktop

## Tech Stack

- **Next.js 16** - React framework
- **TypeScript** - Type safety
- **Tailwind CSS** - Styling
- **@solana/wallet-adapter** - Wallet connection (Phantom, Solflare)
- **lightweight-charts** - TradingView-style candlestick charts
- **Vercel** - Deployment

## Getting Started

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Build for production
npm run build

# Start production server
npm start
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Project Structure

```
frontend/
├── app/
│   ├── layout.tsx      # Root layout with wallet providers
│   ├── page.tsx        # Main trading page
│   ├── globals.css     # Global styles
│   └── providers.tsx   # Wallet provider context
├── components/
│   ├── BoomLogo.tsx       # Animated TNT/explosion logo
│   ├── TradingChart.tsx   # Candlestick chart component
│   ├── BuySellPanel.tsx   # Buy/Sell trading panel
│   ├── Holdings.tsx       # User holdings display
│   ├── RecentExplosions.tsx  # Recent BOOM history
│   ├── PresalePanel.tsx   # Presale deposit UI
│   ├── Header.tsx         # App header with wallet button
│   └── ExplosionOverlay.tsx  # Full-screen BOOM animation
```

## Environment Variables

For production deployment, set:

```
NEXT_PUBLIC_RPC_URL=https://api.devnet.solana.com
NEXT_PUBLIC_PROGRAM_ID=<your_program_id>
```

## Screenshots

The UI matches the mockups in `../mockups/`:
- Dark theme with orange/red explosive accents
- TNT dynamite branding with BOOM explosion effect
- Green BUY / Red SELL buttons
- Market cap and holdings display
- Recent explosions list

## Built By

🦞 **Hank** (AI agent) + 🎮 **George** (frontend sub-agent)

Human collaborator: [@basedtroy](https://x.com/basedtroy)

---

*No rugs, just explosions.* 💥
