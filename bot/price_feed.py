"""
Price feed adapters for BOOM Protocol bot.
Supports Jupiter API (MVP) and Pyth Network.
"""

import httpx
import asyncio
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Optional
import structlog

logger = structlog.get_logger()


@dataclass
class PriceData:
    """Standardized price data from any feed."""
    price_usd: float
    confidence: float  # Price confidence interval
    timestamp: int     # Unix timestamp
    source: str        # "jupiter" or "pyth"
    
    def __repr__(self):
        return f"PriceData(${self.price_usd:.6f} ±{self.confidence:.6f} from {self.source})"


class PriceFeed(ABC):
    """Abstract base class for price feeds."""
    
    @abstractmethod
    async def get_price(self, token_mint: str) -> Optional[PriceData]:
        """Get current price for a token."""
        pass
    
    @abstractmethod
    async def close(self):
        """Cleanup resources."""
        pass


class JupiterPriceFeed(PriceFeed):
    """
    Jupiter Price API - simple and reliable for Solana tokens.
    https://station.jup.ag/docs/apis/price-api
    """
    
    def __init__(self, api_url: str = "https://price.jup.ag/v6"):
        self.api_url = api_url
        self.client = httpx.AsyncClient(timeout=10.0)
    
    async def get_price(self, token_mint: str) -> Optional[PriceData]:
        """Fetch price from Jupiter API."""
        try:
            # Jupiter price endpoint
            url = f"{self.api_url}/price"
            params = {"ids": token_mint}
            
            response = await self.client.get(url, params=params)
            response.raise_for_status()
            
            data = response.json()
            
            if "data" not in data or token_mint not in data["data"]:
                logger.warning("token_not_found_in_jupiter", token=token_mint)
                return None
            
            token_data = data["data"][token_mint]
            
            return PriceData(
                price_usd=float(token_data.get("price", 0)),
                confidence=0.0,  # Jupiter doesn't provide confidence
                timestamp=int(data.get("timeTaken", 0)),
                source="jupiter"
            )
            
        except httpx.HTTPError as e:
            logger.error("jupiter_api_error", error=str(e))
            return None
        except Exception as e:
            logger.error("jupiter_parse_error", error=str(e))
            return None
    
    async def close(self):
        await self.client.aclose()


class PythPriceFeed(PriceFeed):
    """
    Pyth Network price feed.
    More accurate but requires feed ID mapping.
    """
    
    PYTH_HERMES_URL = "https://hermes.pyth.network"
    
    def __init__(self, feed_id: Optional[str] = None):
        self.feed_id = feed_id
        self.client = httpx.AsyncClient(timeout=10.0)
    
    async def get_price(self, token_mint: str) -> Optional[PriceData]:
        """Fetch price from Pyth Hermes API."""
        if not self.feed_id:
            logger.error("pyth_feed_id_not_configured")
            return None
        
        try:
            # Pyth Hermes latest price endpoint
            url = f"{self.PYTH_HERMES_URL}/api/latest_price_feeds"
            params = {"ids[]": self.feed_id}
            
            response = await self.client.get(url, params=params)
            response.raise_for_status()
            
            data = response.json()
            
            if not data:
                logger.warning("pyth_no_data", feed_id=self.feed_id)
                return None
            
            feed_data = data[0]
            price_data = feed_data.get("price", {})
            
            # Pyth prices have exponent
            price = float(price_data.get("price", 0))
            expo = int(price_data.get("expo", 0))
            conf = float(price_data.get("conf", 0))
            
            # Convert to actual price
            actual_price = price * (10 ** expo)
            actual_conf = conf * (10 ** expo)
            
            return PriceData(
                price_usd=actual_price,
                confidence=actual_conf,
                timestamp=int(price_data.get("publish_time", 0)),
                source="pyth"
            )
            
        except httpx.HTTPError as e:
            logger.error("pyth_api_error", error=str(e))
            return None
        except Exception as e:
            logger.error("pyth_parse_error", error=str(e))
            return None
    
    async def close(self):
        await self.client.aclose()


class MockPriceFeed(PriceFeed):
    """
    Mock price feed for testing.
    Simulates price climbing toward threshold.
    """
    
    def __init__(self, start_price: float = 0.001, increment: float = 0.0001):
        self.current_price = start_price
        self.increment = increment
        self.call_count = 0
    
    async def get_price(self, token_mint: str) -> Optional[PriceData]:
        """Return mock price that increases each call."""
        import time
        
        self.call_count += 1
        # Add some randomness
        import random
        noise = random.uniform(-0.0001, 0.0003)
        self.current_price += self.increment + noise
        
        return PriceData(
            price_usd=self.current_price,
            confidence=self.current_price * 0.01,  # 1% confidence
            timestamp=int(time.time()),
            source="mock"
        )
    
    async def close(self):
        pass


def create_price_feed(use_jupiter: bool = True, pyth_feed_id: Optional[str] = None) -> PriceFeed:
    """Factory function to create appropriate price feed."""
    if use_jupiter:
        return JupiterPriceFeed()
    elif pyth_feed_id:
        return PythPriceFeed(feed_id=pyth_feed_id)
    else:
        logger.warning("no_price_feed_configured_using_mock")
        return MockPriceFeed()
