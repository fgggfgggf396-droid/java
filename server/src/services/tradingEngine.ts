import { EventEmitter } from "events";
import { BinanceClient } from "./binanceClient.js";
import { BinancePriceFetcher } from "./binancePriceFetcher.js";

// ============================================================================
// 🧠 SOVEREIGN X Trading Engine v25 - BINANCE LIVE TRADING
// Original v20 algorithm + Binance Real Trading
// ============================================================================

export class TradingEngine extends EventEmitter {
  private isRunning = false;
  private balance = 0;
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
  private binanceClient: BinanceClient;
  private binanceFetcher: BinancePriceFetcher;

  constructor(apiKey: string, apiSecret: string) {
    super();
    this.binanceClient = new BinanceClient(apiKey, apiSecret);
    this.binanceFetcher = new BinancePriceFetcher();
    this.initializeSymbols();
  }

  private initializeSymbols() {
    const symbols = [
      "BTCUSDT",
      "ETHUSDT",
      "BNBUSDT",
      "SOLUSDT",
      "XRPUSDT",
      "ADAUSDT",
    ];
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

    this.log("🚀 SOVEREIGN X v25 BINANCE LIVE TRADING started!");
    this.log("📊 Price Source: Binance (Real-Time)");
    this.log("💱 Trading Platform: Binance Futures (Live Orders)");

    // Get initial balance
    const balances = await this.binanceClient.getBalance();
    const usdtBalance = balances["USDT"]?.free || 0;
    this.balance = usdtBalance;
    this.log(`🔗 Account Balance: $${this.balance.toFixed(2)} USDT`);
    this.log("🎯 Mode: AGGRESSIVE - Original v20 + Binance Real Trading");

    // Fetch initial prices
    await this.fetchRealPrices();

    this.startFastUpdateLoop();
  }

  async stop() {
    this.isRunning = false;
    if (this.updateInterval) clearInterval(this.updateInterval);
    this.log("🛑 SOVEREIGN X stopped");
  }

  private async fetchRealPrices() {
    const symbols = Object.keys(this.symbols);

    for (const symbol of symbols) {
      try {
        const price = await this.binanceClient.getPrice(symbol);
        if (price > 0) {
          this.symbols[symbol].price = price;
          this.symbols[symbol].priceHistory.push(price);
          if (this.symbols[symbol].priceHistory.length > 100) {
            this.symbols[symbol].priceHistory.shift();
          }
        }
      } catch (error: any) {
        this.log(`⚠️ Error fetching price for ${symbol}: ${error.message}`);
      }
    }
  }

  private startFastUpdateLoop() {
    this.updateInterval = setInterval(async () => {
      if (!this.isRunning) return;

      const startTime = Date.now();

      try {
        await this.fetchRealPrices();

        for (const symbol of Object.keys(this.symbols)) {
          this.calculateIndicatorsFast(symbol);
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
    }, 1000);
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

    // ORIGINAL SIGNALS (v20 ELITE PRO)
    if (
      data.ema12 > data.ema26 &&
      data.rsi > 50 &&
      data.rsi < 80 &&
      emaPercent > 0.5
    ) {
      const confidence = Math.min(100, 50 + (data.rsi - 50) + emaPercent * 10);
      this.openPositionFast(symbol, "long", confidence);
      return;
    }

    if (
      data.ema12 < data.ema26 &&
      data.rsi < 50 &&
      data.rsi > 20 &&
      emaPercent > 0.5
    ) {
      const confidence = Math.min(100, 50 + (50 - data.rsi) + emaPercent * 10);
      this.openPositionFast(symbol, "short", confidence);
      return;
    }

    // AGGRESSIVE SIGNALS
    if (
      data.ema12 > data.ema26 &&
      data.rsi > 45 &&
      data.rsi < 75 &&
      emaPercent > 0.3
    ) {
      const confidence = Math.min(100, 40 + (data.rsi - 45) + emaPercent * 8);
      this.log(
        `📊 ${symbol}: Aggressive LONG signal (EMA trend + RSI momentum)`
      );
      this.openPositionFast(symbol, "long", confidence);
      return;
    }

    if (
      data.ema12 < data.ema26 &&
      data.rsi < 55 &&
      data.rsi > 25 &&
      emaPercent > 0.3
    ) {
      const confidence = Math.min(100, 40 + (55 - data.rsi) + emaPercent * 8);
      this.log(
        `📊 ${symbol}: Aggressive SHORT signal (EMA trend + RSI momentum)`
      );
      this.openPositionFast(symbol, "short", confidence);
      return;
    }

    if (data.rsi < 35 && data.ema12 > data.ema26 * 0.99) {
      const confidence = Math.min(100, 35 + (35 - data.rsi));
      this.log(`📊 ${symbol}: Oversold LONG signal (RSI bounce opportunity)`);
      this.openPositionFast(symbol, "long", confidence);
      return;
    }

    if (data.rsi > 65 && data.ema12 < data.ema26 * 1.01) {
      const confidence = Math.min(100, 35 + (data.rsi - 65));
      this.log(
        `📊 ${symbol}: Overbought SHORT signal (RSI pullback opportunity)`
      );
      this.openPositionFast(symbol, "short", confidence);
      return;
    }
  }

  private async openPositionFast(symbol: string, side: string, confidence: number) {
    const data = this.symbols[symbol];
    const entryPrice = data.price;
    const leverage = 5 + (confidence / 100) * 5;
    // 🧠 REALISTIC RISK MANAGEMENT: 5% of current available balance
    // This allows the position size to grow as profits increase
    const riskAmount = this.balance * 0.05;
    const quantity = (riskAmount * leverage) / entryPrice;

    const stopLossPercent = 0.025;
    const stopLoss =
      side === "long"
        ? entryPrice * (1 - stopLossPercent)
        : entryPrice * (1 + stopLossPercent);

    // Open position on Binance
    const binanceSide = side === "long" ? "BUY" : "SELL";
    const orderResult = await this.binanceClient.openPosition(
      symbol,
      binanceSide as "BUY" | "SELL",
      quantity,
      leverage
    );

    if (orderResult) {
      // Set stop loss on Binance
      await this.binanceClient.setStopLoss(
        symbol,
        side === "long" ? "LONG" : "SHORT",
        stopLoss
      );

      // Set take profits on Binance
      const tp1 = side === "long" ? entryPrice * 1.05 : entryPrice * 0.95;
      await this.binanceClient.setTakeProfit(
        symbol,
        side === "long" ? "LONG" : "SHORT",
        tp1,
        quantity * 0.5
      );
    }

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
      orderId: orderResult?.orderId || `ORD-${Date.now()}`,
    };

    data.positions.push(position);
    this.totalTrades++;

    this.log(
      `⚡ OPEN ${side.toUpperCase()} on ${symbol} | Entry: $${entryPrice.toFixed(2)} | ` +
        `Leverage: ${leverage.toFixed(1)}x | Confidence: ${confidence.toFixed(0)}%`
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

    // Close position on Binance
    await this.binanceClient.closePosition(
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
