import WebSocket from "ws";
import { EventEmitter } from "events";

// ============================================================================
// 📊 Binance WebSocket Price Fetcher - Ultra-Fast Real-Time Market Data
// Uses Binance Futures WebSocket streams for millisecond-level price updates
// NO REST API polling = NO rate limits = NO IP bans
// ============================================================================

export class BinancePriceFetcher extends EventEmitter {
  private ws: WebSocket | null = null;
  private prices: { [symbol: string]: number } = {};
  private lastUpdateTimes: { [symbol: string]: number } = {};
  private isConnected = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 100;
  private reconnectDelay = 3000; // 3 seconds
  private pingInterval: any = null;
  private symbols: string[] = [];
  private wsUrl = "wss://fstream.binance.com/ws";

  constructor() {
    super();
  }

  // Connect to Binance Futures WebSocket for all symbols
  connect(symbols: string[]): void {
    this.symbols = symbols;

    // Build combined stream URL for all symbols
    // Format: wss://fstream.binance.com/stream?streams=btcusdt@ticker/ethusdt@ticker/...
    const streams = symbols
      .map((s) => `${s.toLowerCase()}@ticker`)
      .join("/");
    const streamUrl = `wss://fstream.binance.com/stream?streams=${streams}`;

    console.log(`🔌 Connecting to Binance Futures WebSocket...`);
    console.log(`📡 Streams: ${symbols.join(", ")}`);

    this.ws = new WebSocket(streamUrl);

    this.ws.on("open", () => {
      this.isConnected = true;
      this.reconnectAttempts = 0;
      console.log(`✅ WebSocket connected! Receiving real-time prices for ${symbols.length} symbols`);
      console.log(`⚡ Data delivery: Millisecond-level (no polling, no rate limits)`);
      this.emit("connected");

      // Send ping every 3 minutes to keep connection alive
      this.pingInterval = setInterval(() => {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.ping();
        }
      }, 180000);
    });

    this.ws.on("message", (data: WebSocket.Data) => {
      try {
        const message = JSON.parse(data.toString());

        // Combined stream format: { stream: "btcusdt@ticker", data: {...} }
        if (message.stream && message.data) {
          const tickerData = message.data;
          const symbol = tickerData.s; // Symbol (e.g., "BTCUSDT")
          const price = parseFloat(tickerData.c); // Current price (close price)
          const eventTime = tickerData.E; // Event time in ms

          if (symbol && price > 0) {
            const prevPrice = this.prices[symbol] || 0;
            this.prices[symbol] = price;
            this.lastUpdateTimes[symbol] = Date.now();

            // Emit price update event for the trading engine
            this.emit("priceUpdate", {
              symbol,
              price,
              prevPrice,
              eventTime,
              localTime: Date.now(),
              latency: Date.now() - eventTime, // Network latency in ms
              volume24h: parseFloat(tickerData.v || "0"),
              priceChange24h: parseFloat(tickerData.P || "0"),
              high24h: parseFloat(tickerData.h || "0"),
              low24h: parseFloat(tickerData.l || "0"),
            });
          }
        }
      } catch (error: any) {
        console.error(`❌ WebSocket message parse error: ${error.message}`);
      }
    });

    this.ws.on("close", (code: number, reason: Buffer) => {
      this.isConnected = false;
      console.log(`🔴 WebSocket disconnected (code: ${code}). Reconnecting...`);
      if (this.pingInterval) clearInterval(this.pingInterval);
      this.reconnect();
    });

    this.ws.on("error", (error: Error) => {
      console.error(`❌ WebSocket error: ${error.message}`);
    });

    this.ws.on("pong", () => {
      // Connection is alive
    });
  }

  private reconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error(`❌ Max reconnect attempts reached (${this.maxReconnectAttempts}). Stopping.`);
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(this.reconnectDelay * this.reconnectAttempts, 30000);
    console.log(`🔄 Reconnecting in ${delay / 1000}s (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);

    setTimeout(() => {
      this.connect(this.symbols);
    }, delay);
  }

  // Get current price for a symbol (from WebSocket cache)
  getPrice(symbol: string): number {
    return this.prices[symbol] || 0;
  }

  // Get all current prices
  getAllPrices(): { [symbol: string]: number } {
    return { ...this.prices };
  }

  // Get latency info for a symbol
  getLatency(symbol: string): number {
    const lastUpdate = this.lastUpdateTimes[symbol];
    if (!lastUpdate) return -1;
    return Date.now() - lastUpdate;
  }

  // Check if WebSocket is connected
  getConnectionStatus(): boolean {
    return this.isConnected;
  }

  // Legacy compatibility: async getPrice (for existing code)
  async getPriceAsync(symbol: string): Promise<number> {
    return this.getPrice(symbol);
  }

  // Legacy compatibility: async getPrices
  async getPrices(symbols: string[]): Promise<{ [key: string]: number }> {
    const prices: { [key: string]: number } = {};
    for (const symbol of symbols) {
      prices[symbol] = this.getPrice(symbol);
    }
    return prices;
  }

  // Disconnect WebSocket
  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
    }
    this.isConnected = false;
    console.log("🔌 WebSocket disconnected");
  }
}
