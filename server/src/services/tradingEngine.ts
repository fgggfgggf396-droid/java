import { EventEmitter } from "events";
import { BingXClient } from "./bingxClient.js";

// ============================================================================
// 🧠 SOVEREIGN X Trading Engine - Real BingX Integration
// ============================================================================

export class TradingEngine extends EventEmitter {
  private isRunning = false;
  private balance = 173;
  private totalProfit = 0;
  private totalTrades = 0;
  private winningTrades = 0;
  private losingTrades = 0;
  private symbols: any = {};
  private logs: string[] = [];
  private updateInterval: any = null;
  private responseTimes: number[] = [];
  private lastUpdateTime = Date.now();
  private updateCount = 0;
  private bingxClient: BingXClient;

  // Real prices from BingX
  private realPrices: any = {};

  // Fallback prices if BingX is unavailable
  private fallbackPrices: any = {
    "BTC-USDT": 66762.1,
    "ETH-USDT": 1989.24,
    "BNB-USDT": 617.54,
    "SOL-USDT": 85.54,
    "XRP-USDT": 1.4321,
    "ADA-USDT": 0.2865,
  };

  private useFallbackPrices = false;

  private priceVolatility: any = {
    "BTC-USDT": 0.002,
    "ETH-USDT": 0.003,
    "BNB-USDT": 0.004,
    "SOL-USDT": 0.005,
    "XRP-USDT": 0.006,
    "ADA-USDT": 0.007,
  };

  constructor(apiKey: string, apiSecret: string) {
    super();
    this.bingxClient = new BingXClient(apiKey, apiSecret);
    this.initializeSymbols();
  }

  private initializeSymbols() {
    const symbols = ["BTC-USDT", "ETH-USDT", "BNB-USDT", "SOL-USDT", "XRP-USDT", "ADA-USDT"];
    for (const symbol of symbols) {
      this.symbols[symbol] = {
        symbol,
        price: 0,
        lastUpdateTime: Date.now(),
        ema12: 0,
        ema26: 0,
        rsi: 50,
        atr: 0,
        positions: [],
        priceHistory: [],
        updateCount: 0,
      };
    }
  }

  private log(message: string) {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${message}`;
    this.logs.push(logEntry);
    if (this.logs.length > 500) this.logs.shift();
    console.log(logEntry);
    this.emit("log", logEntry);
  }

  async start() {
    if (this.isRunning) return;
    this.isRunning = true;

    // Test BingX connection
    const connected = await this.bingxClient.testConnection();

    // Fetch real balance from BingX
    const realBalance = await this.bingxClient.getBalance();
    if (realBalance > 0) {
      this.balance = realBalance;
    }

    this.log("🚀 SOVEREIGN X v22 REAL TRADING (BingX Live) started!");
    this.log("⚡ Real-Time Prices | Live Order Execution | 100ms Updates");
    this.log(`🔗 Connected to BingX | Account Balance: $${this.balance.toFixed(2)} USD`);
    
    if (connected) {
      this.log("📊 Using REAL Market Data from BingX API");
    } else {
      this.log("⚠️ BingX API unavailable - using fallback prices");
    }

    // Fetch initial prices
    await this.fetchRealPrices();

    this.startFastUpdateLoop();
  }

  async stop() {
    this.isRunning = false;
    if (this.updateInterval) clearInterval(this.updateInterval);
    this.log("🛑 SOVEREIGN X stopped");
  }

  // ---- Fetch real prices from BingX ----
  private async fetchRealPrices() {
    const symbols = Object.keys(this.symbols);
    let successCount = 0;

    for (const symbol of symbols) {
      try {
        const price = await this.bingxClient.getPrice(symbol);
        if (price > 0) {
          this.realPrices[symbol] = price;
          this.symbols[symbol].price = price;
          this.symbols[symbol].priceHistory.push(price);
          if (this.symbols[symbol].priceHistory.length > 100) {
            this.symbols[symbol].priceHistory.shift();
          }
          successCount++;
        } else {
          const fallbackPrice = this.fallbackPrices[symbol];
          this.symbols[symbol].price = fallbackPrice;
          this.symbols[symbol].priceHistory.push(fallbackPrice);
        }
      } catch (error: any) {
        const fallbackPrice = this.fallbackPrices[symbol];
        this.symbols[symbol].price = fallbackPrice;
        this.symbols[symbol].priceHistory.push(fallbackPrice);
      }
    }

    if (successCount === 0) {
      this.useFallbackPrices = true;
    } else {
      this.useFallbackPrices = false;
    }
  }

  private startFastUpdateLoop() {
    this.updateInterval = setInterval(async () => {
      if (!this.isRunning) return;

      const startTime = Date.now();

      try {
        // Fetch real prices from BingX
        await this.fetchRealPrices();

        // Update balance from BingX
        const newBalance = await this.bingxClient.getBalance();
        if (newBalance > 0) {
          this.balance = newBalance;
        }

        for (const symbol of Object.keys(this.symbols)) {
          this.analyzeSymbolFast(symbol);
          await this.managePositionsFast(symbol);
        }

        const endTime = Date.now();
        const responseTime = endTime - startTime;
        this.responseTimes.push(responseTime);
        if (this.responseTimes.length > 100) this.responseTimes.shift();

        this.lastUpdateTime = endTime;
        this.updateCount++;
        this.emit("stats", this.getStats());

        if (this.updateCount % 100 === 0) {
          const avgTime =
            this.responseTimes.reduce((a: number, b: number) => a + b, 0) /
            this.responseTimes.length;
          this.log(`⚡ Performance: ${avgTime.toFixed(2)}ms avg response time`);
        }
      } catch (error: any) {
        this.log(`❌ Update loop error: ${error.message}`);
      }
    }, 100);
  }

  private calculateIndicatorsFast(symbol: string) {
    const data = this.symbols[symbol];
    const prices = data.priceHistory;

    if (prices.length < 2) return;

    data.ema12 = this.calculateEMAFast(prices, 12);
    data.ema26 = this.calculateEMAFast(prices, 26);
    data.rsi = this.calculateRSIFast(prices, 14);
    data.atr = this.calculateATRFast(prices);
  }

  private calculateEMAFast(prices: number[], period: number): number {
    if (prices.length < period) return prices[prices.length - 1];
    const multiplier = 2 / (period + 1);
    let ema = prices.slice(-period).reduce((a, b) => a + b) / period;
    for (let i = prices.length - period; i < prices.length; i++) {
      ema = prices[i] * multiplier + ema * (1 - multiplier);
    }
    return ema;
  }

  private calculateRSIFast(prices: number[], period: number): number {
    if (prices.length < period + 1) return 50;
    let gains = 0,
      losses = 0;
    for (let i = prices.length - period; i < prices.length; i++) {
      const diff = prices[i] - prices[i - 1];
      if (diff > 0) gains += diff;
      else losses -= diff;
    }
    const avgGain = gains / period;
    const avgLoss = losses / period;
    const rs = avgGain / (avgLoss || 1);
    return 100 - 100 / (1 + rs);
  }

  private calculateATRFast(prices: number[]): number {
    if (prices.length < 2) return 0;
    let tr = 0;
    for (let i = 1; i < prices.length; i++) {
      tr += Math.abs(prices[i] - prices[i - 1]);
    }
    return tr / (prices.length - 1);
  }

  private analyzeSymbolFast(symbol: string) {
    const data = this.symbols[symbol];
    if (!data.price || data.price === 0) return;
    if (data.positions.some((p: any) => p.status === "open")) return;

    const emaDiff = Math.abs(data.ema12 - data.ema26);
    const emaPercent = (emaDiff / data.ema26) * 100;

    if (
      data.ema12 > data.ema26 &&
      data.rsi > 50 &&
      data.rsi < 80 &&
      emaPercent > 0.5
    ) {
      const confidence = Math.min(100, 50 + (data.rsi - 50) + emaPercent * 10);
      this.openPositionFast(symbol, "long", confidence);
    }

    if (
      data.ema12 < data.ema26 &&
      data.rsi < 50 &&
      data.rsi > 20 &&
      emaPercent > 0.5
    ) {
      const confidence = Math.min(100, 50 + (50 - data.rsi) + emaPercent * 10);
      this.openPositionFast(symbol, "short", confidence);
    }

    if (data.atr > data.price * 0.02 && data.rsi > 40 && data.rsi < 60) {
      this.openPositionFast(symbol, "long", 70);
    }

    if (data.atr < data.price * 0.01 && data.rsi > 30 && data.rsi < 70) {
      this.openPositionFast(symbol, "long", 60);
    }
  }

  private async openPositionFast(symbol: string, side: string, confidence: number) {
    const data = this.symbols[symbol];
    const entryPrice = data.price;
    const leverage = 5 + (confidence / 100) * 5;
    const riskAmount = this.balance * 0.05;
    const quantity = riskAmount / entryPrice;

    const stopLossPercent = 0.025;
    const stopLoss =
      side === "long"
        ? entryPrice * (1 - stopLossPercent)
        : entryPrice * (1 + stopLossPercent);

    // Open position on BingX
    const bingxSide = side === "long" ? "BUY" : "SELL";
    const orderResult = await this.bingxClient.openPosition(
      symbol,
      bingxSide,
      quantity,
      leverage
    );

    if (!orderResult) {
      this.log(`❌ Failed to open position on BingX for ${symbol}`);
      return;
    }

    // Set stop loss on BingX
    await this.bingxClient.setStopLoss(
      symbol,
      side === "long" ? "LONG" : "SHORT",
      stopLoss
    );

    // Set take profits on BingX
    const tp1 = side === "long" ? entryPrice * 1.05 : entryPrice * 0.95;
    await this.bingxClient.setTakeProfit(
      symbol,
      side === "long" ? "LONG" : "SHORT",
      tp1
    );

    const position = {
      symbol,
      side,
      entryPrice,
      quantity,
      leverage,
      stopLoss,
      takeProfit1: side === "long" ? entryPrice * 1.05 : entryPrice * 0.95,
      takeProfit2: side === "long" ? entryPrice * 1.075 : entryPrice * 0.925,
      takeProfit3: side === "long" ? entryPrice * 1.1 : entryPrice * 0.9,
      confidence,
      timestamp: Date.now(),
      status: "open",
      profit: 0,
      profitPercent: 0,
      trailingStopLoss: stopLoss,
      partialClosedAt: [],
      orderId: orderResult.orderId || `ORD-${Date.now()}`,
    };

    data.positions.push(position);
    this.totalTrades++;

    this.log(
      `⚡ OPEN ${side.toUpperCase()} on ${symbol} | Entry: $${entryPrice.toFixed(
        2
      )} | ` +
        `Leverage: ${leverage.toFixed(1)}x | Confidence: ${confidence.toFixed(0)}% | Order: ${position.orderId}`
    );

    this.emit("position", position);
  }

  private async managePositionsFast(symbol: string) {
    const data = this.symbols[symbol];
    const currentPrice = data.price;

    for (const position of data.positions) {
      if (position.status === "closed") continue;

      const priceDiff =
        position.side === "long"
          ? currentPrice - position.entryPrice
          : position.entryPrice - currentPrice;

      position.profit = position.quantity * priceDiff;
      position.profitPercent = (priceDiff / position.entryPrice) * 100;

      // Check stop loss
      if (position.side === "long" && currentPrice <= position.stopLoss) {
        await this.closePositionFast(position, currentPrice, "Stop Loss");
        this.losingTrades++;
        continue;
      }

      if (position.side === "short" && currentPrice >= position.stopLoss) {
        await this.closePositionFast(position, currentPrice, "Stop Loss");
        this.losingTrades++;
        continue;
      }

      // Check take profits
      if (position.status === "open") {
        if (position.side === "long" && currentPrice >= position.takeProfit1) {
          const profit1 =
            (position.quantity * 0.5) * (position.takeProfit1 - position.entryPrice);
          this.balance += profit1;
          this.totalProfit += profit1;
          position.status = "partial";
          position.trailingStopLoss = position.entryPrice;
          position.partialClosedAt.push(Date.now());
          this.log(`✅ TP1 HIT on ${symbol} | Profit: $${profit1.toFixed(2)}`);
        }

        if (position.side === "short" && currentPrice <= position.takeProfit1) {
          const profit1 =
            (position.quantity * 0.5) * (position.entryPrice - position.takeProfit1);
          this.balance += profit1;
          this.totalProfit += profit1;
          position.status = "partial";
          position.trailingStopLoss = position.entryPrice;
          position.partialClosedAt.push(Date.now());
          this.log(`✅ TP1 HIT on ${symbol} | Profit: $${profit1.toFixed(2)}`);
        }
      }

      if (position.status === "partial") {
        if (position.side === "long" && currentPrice >= position.takeProfit2) {
          const profit2 =
            (position.quantity * 0.3) * (position.takeProfit2 - position.entryPrice);
          this.balance += profit2;
          this.totalProfit += profit2;
          position.partialClosedAt.push(Date.now());
          this.log(`✅ TP2 HIT on ${symbol} | Profit: $${profit2.toFixed(2)}`);
        }

        if (position.side === "short" && currentPrice <= position.takeProfit2) {
          const profit2 =
            (position.quantity * 0.3) * (position.entryPrice - position.takeProfit2);
          this.balance += profit2;
          this.totalProfit += profit2;
          position.partialClosedAt.push(Date.now());
          this.log(`✅ TP2 HIT on ${symbol} | Profit: $${profit2.toFixed(2)}`);
        }

        if (position.side === "long" && currentPrice >= position.takeProfit3) {
          const profit3 =
            (position.quantity * 0.2) * (position.takeProfit3 - position.entryPrice);
          this.balance += profit3;
          this.totalProfit += profit3;
          this.winningTrades++;
          await this.closePositionFast(position, currentPrice, "TP3");
          this.log(`✅ TP3 HIT on ${symbol} | Profit: $${profit3.toFixed(2)}`);
        }

        if (position.side === "short" && currentPrice <= position.takeProfit3) {
          const profit3 =
            (position.quantity * 0.2) * (position.entryPrice - position.takeProfit3);
          this.balance += profit3;
          this.totalProfit += profit3;
          this.winningTrades++;
          await this.closePositionFast(position, currentPrice, "TP3");
          this.log(`✅ TP3 HIT on ${symbol} | Profit: $${profit3.toFixed(2)}`);
        }
      }
    }

    data.positions = data.positions.filter((p: any) => p.status !== "closed");
  }

  private async closePositionFast(position: any, closePrice: number, reason: string) {
    position.status = "closed";
    const profit =
      position.side === "long"
        ? position.quantity * (closePrice - position.entryPrice)
        : position.quantity * (position.entryPrice - closePrice);

    this.balance += profit;
    this.totalProfit += profit;

    // Close position on BingX
    await this.bingxClient.closePosition(
      position.symbol,
      position.side === "long" ? "LONG" : "SHORT"
    );

    this.log(
      `🔴 CLOSE ${position.side.toUpperCase()} on ${position.symbol} | ` +
        `Reason: ${reason} | Profit: $${profit.toFixed(2)}`
    );
  }

  getStats() {
    const winRate =
      this.totalTrades > 0 ? (this.winningTrades / this.totalTrades) * 100 : 0;
    const avgResponseTime =
      this.responseTimes.length > 0
        ? this.responseTimes.reduce((a: number, b: number) => a + b, 0) /
          this.responseTimes.length
        : 0;

    return {
      isRunning: this.isRunning,
      balance: this.balance,
      totalProfit: this.totalProfit,
      totalTrades: this.totalTrades,
      winningTrades: this.winningTrades,
      losingTrades: this.losingTrades,
      winRate,
      symbols: this.symbols,
      logs: this.logs,
      avgResponseTime,
      lastUpdateTime: this.lastUpdateTime,
    };
  }

  getPrice(symbol: string): number {
    return this.symbols[symbol]?.price || 0;
  }

  getKlines(symbol: string): any[] {
    return this.symbols[symbol]?.klines || [];
  }
}
