"""
BOOM Protocol Price Monitor

Watches token prices and triggers explosions when market cap threshold is hit.
"""

import asyncio
import time
from typing import Optional
from dataclasses import dataclass, field
from datetime import datetime

from solders.pubkey import Pubkey
import structlog

from config import BotConfig, load_config
from price_feed import PriceFeed, PriceData, create_price_feed
from solana_client import SolanaClient

logger = structlog.get_logger()


@dataclass
class MonitorState:
    """State of the price monitor."""
    is_running: bool = False
    last_price: Optional[PriceData] = None
    last_market_cap: float = 0.0
    last_check_time: float = 0.0
    checks_count: int = 0
    explosion_triggered: bool = False
    start_time: float = field(default_factory=time.time)


class BoomMonitor:
    """
    Price monitoring bot for BOOM Protocol.
    
    Continuously polls price feeds and triggers explosion
    when market cap threshold is reached.
    """
    
    def __init__(self, config: BotConfig):
        self.config = config
        self.state = MonitorState()
        self.price_feed: Optional[PriceFeed] = None
        self.solana_client: Optional[SolanaClient] = None
    
    async def start(self):
        """Initialize and start the monitor."""
        logger.info(
            "starting_boom_monitor",
            token=self.config.token_mint,
            threshold=self.config.market_cap_threshold,
            interval=self.config.poll_interval_seconds,
            dry_run=self.config.dry_run,
        )
        
        # Initialize price feed
        self.price_feed = create_price_feed(
            use_jupiter=self.config.use_jupiter,
            pyth_feed_id=self.config.pyth_price_feed_id,
        )
        
        # Initialize Solana client
        self.solana_client = SolanaClient(
            rpc_url=self.config.rpc_url,
            keypair_path=self.config.keypair_path,
            program_id=self.config.program_id,
        )
        await self.solana_client.connect()
        
        self.state.is_running = True
        self.state.start_time = time.time()
        
        logger.info(
            "monitor_initialized",
            wallet=str(self.solana_client.keypair.pubkey()),
            program=self.config.program_id,
        )
    
    async def stop(self):
        """Stop the monitor and cleanup."""
        logger.info("stopping_boom_monitor")
        self.state.is_running = False
        
        if self.price_feed:
            await self.price_feed.close()
        
        if self.solana_client:
            await self.solana_client.close()
    
    async def check_price(self) -> Optional[float]:
        """
        Check current price and calculate market cap.
        
        Returns market cap in USD if successful.
        """
        if not self.price_feed or not self.config.token_mint:
            return None
        
        price_data = await self.price_feed.get_price(self.config.token_mint)
        
        if not price_data:
            logger.warning("failed_to_get_price")
            return None
        
        self.state.last_price = price_data
        self.state.last_check_time = time.time()
        self.state.checks_count += 1
        
        # Get token supply to calculate market cap
        if self.solana_client and self.config.token_mint:
            mint = Pubkey.from_string(self.config.token_mint)
            supply = await self.solana_client.get_token_supply(mint)
            
            if supply:
                # Supply is in smallest units, assume 9 decimals for SPL tokens
                supply_tokens = supply / 1e9
                market_cap = price_data.price_usd * supply_tokens
                self.state.last_market_cap = market_cap
                
                logger.info(
                    "price_check",
                    price=price_data.price_usd,
                    supply=supply_tokens,
                    market_cap=market_cap,
                    threshold=self.config.market_cap_threshold,
                    source=price_data.source,
                )
                
                return market_cap
        
        # If we can't get supply, estimate with a default
        # For devnet testing, assume 1B token supply
        default_supply = 1_000_000_000
        market_cap = price_data.price_usd * default_supply
        self.state.last_market_cap = market_cap
        
        logger.info(
            "price_check_estimated",
            price=price_data.price_usd,
            estimated_supply=default_supply,
            market_cap=market_cap,
            threshold=self.config.market_cap_threshold,
        )
        
        return market_cap
    
    async def trigger_explosion(self) -> bool:
        """
        Trigger the explosion on-chain.
        
        Returns True if successful.
        """
        if not self.solana_client or not self.config.token_mint:
            logger.error("cannot_trigger_no_client_or_mint")
            return False
        
        if self.state.explosion_triggered:
            logger.warning("explosion_already_triggered")
            return False
        
        logger.info(
            "triggering_explosion",
            token=self.config.token_mint,
            market_cap=self.state.last_market_cap,
            threshold=self.config.market_cap_threshold,
        )
        
        mint = Pubkey.from_string(self.config.token_mint)
        
        result = await self.solana_client.trigger_explosion(
            token_mint=mint,
            revealed_cap=self.config.revealed_cap_lamports,
            price_proof=b"",  # Empty for MVP
            dry_run=self.config.dry_run,
        )
        
        if result:
            self.state.explosion_triggered = True
            logger.info(
                "explosion_triggered_success",
                signature=result,
                market_cap=self.state.last_market_cap,
            )
            return True
        
        logger.error("explosion_trigger_failed")
        return False
    
    async def run_loop(self):
        """Main monitoring loop."""
        logger.info("starting_monitor_loop")
        
        while self.state.is_running and not self.state.explosion_triggered:
            try:
                market_cap = await self.check_price()
                
                if market_cap is not None:
                    if market_cap >= self.config.market_cap_threshold:
                        logger.info(
                            "threshold_reached",
                            market_cap=market_cap,
                            threshold=self.config.market_cap_threshold,
                        )
                        
                        success = await self.trigger_explosion()
                        
                        if success:
                            logger.info("💥 BOOM! Token exploded!")
                            break
                
                # Wait before next check
                await asyncio.sleep(self.config.poll_interval_seconds)
                
            except asyncio.CancelledError:
                logger.info("monitor_loop_cancelled")
                break
            except Exception as e:
                logger.error("monitor_loop_error", error=str(e))
                await asyncio.sleep(self.config.poll_interval_seconds)
        
        logger.info(
            "monitor_loop_ended",
            checks=self.state.checks_count,
            explosion_triggered=self.state.explosion_triggered,
            runtime_seconds=time.time() - self.state.start_time,
        )
    
    def get_status(self) -> dict:
        """Get current monitor status."""
        return {
            "is_running": self.state.is_running,
            "last_price": self.state.last_price.price_usd if self.state.last_price else None,
            "last_market_cap": self.state.last_market_cap,
            "threshold": self.config.market_cap_threshold,
            "checks_count": self.state.checks_count,
            "explosion_triggered": self.state.explosion_triggered,
            "uptime_seconds": time.time() - self.state.start_time,
        }


async def main():
    """Main entry point."""
    import sys
    from rich.console import Console
    from rich.logging import RichHandler
    import logging
    
    # Setup logging
    logging.basicConfig(
        level=logging.INFO,
        format="%(message)s",
        handlers=[RichHandler(rich_tracebacks=True)],
    )
    
    structlog.configure(
        processors=[
            structlog.stdlib.filter_by_level,
            structlog.stdlib.add_logger_name,
            structlog.stdlib.add_log_level,
            structlog.stdlib.PositionalArgumentsFormatter(),
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.StackInfoRenderer(),
            structlog.processors.format_exc_info,
            structlog.processors.UnicodeDecoder(),
            structlog.dev.ConsoleRenderer(),
        ],
        wrapper_class=structlog.stdlib.BoundLogger,
        context_class=dict,
        logger_factory=structlog.stdlib.LoggerFactory(),
    )
    
    console = Console()
    
    console.print("[bold blue]💥 BOOM Protocol Price Monitor[/bold blue]")
    console.print()
    
    # Load config
    config = load_config()
    
    if not config.token_mint:
        console.print("[red]Error: BOOM_TOKEN_MINT environment variable not set[/red]")
        console.print("Set it with: export BOOM_TOKEN_MINT=<your-token-mint-address>")
        sys.exit(1)
    
    console.print(f"[cyan]Token:[/cyan] {config.token_mint}")
    console.print(f"[cyan]Threshold:[/cyan] ${config.market_cap_threshold:,.2f}")
    console.print(f"[cyan]RPC:[/cyan] {config.rpc_url}")
    console.print(f"[cyan]Dry Run:[/cyan] {config.dry_run}")
    console.print()
    
    # Create and run monitor
    monitor = BoomMonitor(config)
    
    try:
        await monitor.start()
        await monitor.run_loop()
    except KeyboardInterrupt:
        console.print("\n[yellow]Interrupted by user[/yellow]")
    finally:
        await monitor.stop()
        
        status = monitor.get_status()
        console.print()
        console.print("[bold]Final Status:[/bold]")
        console.print(f"  Checks: {status['checks_count']}")
        console.print(f"  Last Market Cap: ${status['last_market_cap']:,.2f}" if status['last_market_cap'] else "  Last Market Cap: N/A")
        console.print(f"  Explosion Triggered: {status['explosion_triggered']}")


if __name__ == "__main__":
    asyncio.run(main())
