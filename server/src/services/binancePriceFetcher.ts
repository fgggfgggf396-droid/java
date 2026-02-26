import fetch from "node-fetch";

// ============================================================================
// 📊 Binance Price Fetcher - Real-Time Market Data
// ============================================================================

export class BinancePriceFetcher {
  private baseUrl = "https://binance.com/fapi/v1";

  async getPrice(symbol: string): Promise<number> {
    try {
      // Convert BTC-USDT to BTCUSDT format for Binance
      const binanceSymbol = symbol.replace("-", "");
      
      const response = await fetch(
        `${this.baseUrl}/ticker/price?symbol=${binanceSymbol}`
      );

      if (!response.ok) {
        console.warn(`⚠️ Binance price fetch failed for ${symbol}`);
        return 0;
      }

      const data = await response.json();
      const price = parseFloat(data.price);
      
      if (price > 0) {
        console.log(`📈 ${symbol}: $${price.toFixed(2)} (from Binance)`);
      }
      
      return price;
    } catch (error: any) {
      console.error(`❌ Error fetching price from Binance for ${symbol}:`, error.message);
      return 0;
    }
  }

  async getPrices(symbols: string[]): Promise<{ [key: string]: number }> {
    const prices: { [key: string]: number } = {};

    for (const symbol of symbols) {
      const price = await this.getPrice(symbol);
      prices[symbol] = price;
    }

    return prices;
  }

  async getKlines(
    symbol: string,
    interval: string = "1m",
    limit: number = 100
  ): Promise<any[]> {
    try {
      const binanceSymbol = symbol.replace("-", "");
      
      const response = await fetch(
        `${this.baseUrl}/klines?symbol=${binanceSymbol}&interval=${interval}&limit=${limit}`
      );

      if (!response.ok) {
        console.warn(`⚠️ Binance klines fetch failed for ${symbol}`);
        return [];
      }

      const data = await response.json();
      return data || [];
    } catch (error: any) {
      console.error(`❌ Error fetching klines from Binance for ${symbol}:`, error.message);
      return [];
    }
  }

  async test24hStats(symbol: string): Promise<any> {
    try {
      const binanceSymbol = symbol.replace("-", "");
      
      const response = await fetch(
        `${this.baseUrl}/ticker/24hr?symbol=${binanceSymbol}`
      );

      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      return data;
    } catch (error: any) {
      console.error(`❌ Error fetching 24h stats from Binance:`, error.message);
      return null;
    }
  }
}
