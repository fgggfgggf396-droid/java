import { EventEmitter } from "events";
import { BinanceClient } from "./binanceClient.js";
import { BinancePriceFetcher } from "./binancePriceFetcher.js";

// ============================================================================
// 🧠 SOVEREIGN X Trading Engine v26 - BINANCE LIVE TRADING (WebSocket Edition)
// Ultra-fast millisecond response via Binance Futures WebSocket streams
// NO REST API polling for prices = NO rate limits = NO IP bans
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
  private responseTimes: number[] = [];
  private lastUpdateTime = Date.now();
  private updateCount = 0;
  private binanceClient: BinanceClient;
  private binanceFetcher: BinancePriceFetcher;
  private analysisInterval: any = null;
  private balanceInterval: any = null;

  private readonly SYMBOL_LIST = [
    "BTCUSDT",
    "ETHUSDT",
    "BNBUSDT",
    "SOLUSDT",
    "XRPUSDT",
    "ADAUSDT",
  ];

  constructor(apiKey: string, apiSecret: string) {
    super();
    this.binanceClient = new BinanceClient(apiKey, apiSecret);
    this.binanceFetcher = new BinancePriceFetcher();
    this.initializeSymbols();
  }

  private initializeSymbols() {
    for (const symbol of this.SYMBOL_LIST) {
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
        wsLatency: 0,
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

    this.log("🚀 SOVEREIGN X v26 BINANCE LIVE TRADING started! (WebSocket Edition)");
    this.log("📡 Price Source: Binance Futures WebSocket (Millisecond Updates)");
    this.log("💱 Trading Platform: Binance Futures (Live Orders)");
    this.log("⚡ NO REST API polling = NO rate limits = NO IP bans");

    // Get initial balance via REST (one-time call)
    try {
      const balances = await this.binanceClient.getBalance();
      const usdtBalance = balances["USDT"]?.free || 0;
      this.balance = usdtBalance;
      this.log(`💰 Account Balance: $${this.balance.toFixed(2)} USDT`);
    } catch (error: any) {
      this.log(`⚠️ Could not fetch initial balance: ${error.message}`);
      this.log(`💰 Starting with tracked balance`);
    }

    this.log("🎯 Mode: AGGRESSIVE - Original v20 + WebSocket Real-Time Data");

    // Connect to WebSocket for real-time prices
    this.startWebSocketPriceFeed();

    // Start periodic analysis loop (every 3 seconds - only for indicators & trade management)
    this.startAnalysisLoop();

    // Start periodic balance refresh (every 60 seconds - minimal REST calls)
    this.startBalanceRefresh();
  }

  async stop() {
    this.isRunning = false;
    this.binanceFetcher.disconnect();
    if (this.analysisInterval) clearInterval(this.analysisInterval);
    if (this.balanceInterval) clearInterval(this.balanceInterval);
    this.log("🛑 SOVEREIGN X stopped");
  }

  // ============================================================================
  // 📡 WebSocket Price Feed - Millisecond-level price updates
  // ============================================================================
  private startWebSocketPriceFeed() {
    // Listen for real-time price updates from WebSocket
    this.binanceFetcher.on("priceUpdate", (data: any) => {
      const { symbol, price, latency } = data;

      if (this.symbols[symbol]) {
        this.symbols[symbol].price = price;
        this.symbols[symbol].lastUpdateTime = Date.now();
        this.symbols[symbol].wsLatency = latency;
        this.symbols[symbol].updateCount++;

        // Add to price history for indicator calculations
        this.symbols[symbol].priceHistory.push(price);
        if (this.symbols[symbol].priceHistory.length > 200) {
          this.symbols[symbol].priceHistory.shift();
        }
      }
    });

    this.binanceFetcher.on("connected", () => {
      this.log("✅ WebSocket price feed connected! Receiving real-time data.");
    });

    // Connect to all symbols
    this.binanceFetcher.connect(this.SYMBOL_LIST);
    this.log(`🔌 WebSocket connecting to ${this.SYMBOL_LIST.length} symbol streams...`);
  }

  // ============================================================================
  // 🧠 Analysis Loop - Runs every 3 seconds for indicator calculation & trading
  // Only uses cached WebSocket prices, NO REST API calls for prices
  // ============================================================================
  private startAnalysisLoop() {
    this.analysisInterval = setInterval(async () => {
      if (!this.isRunning) return;

      const startTime = Date.now();

      try {
        for (const symbol of this.SYMBOL_LIST) {
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

        // Log performance every 100 cycles
        if (this.updateCount % 100 === 0) {
          const avgTime =
            this.responseTimes.reduce((a: number, b: number) => a + b, 0) /
            this.responseTimes.length;

          // Calculate average WebSocket latency
          let totalWsLatency = 0;
          let wsCount = 0;
          for (const sym of this.SYMBOL_LIST) {
            if (this.symbols[sym].wsLatency > 0) {
              totalWsLatency += this.symbols[sym].wsLatency;
              wsCount++;
            }
          }
          const avgWsLatency = wsCount > 0 ? totalWsLatency / wsCount : 0;

          this.log(
            `⚡ Performance: Analysis ${avgTime.toFixed(1)}ms | ` +
            `WebSocket Latency ${avgWsLatency.toFixed(0)}ms | ` +
            `WS Connected: ${this.binanceFetcher.getConnectionStatus() ? "YES" : "NO"} | ` +
            `Balance: $${this.balance.toFixed(2)}`
          );
        }
      } catch (error: any) {
        this.log(`❌ Analysis loop error: ${error.message}`);
      }
    }, 3000); // Analysis every 3 seconds using cached WebSocket prices
  }

  // ============================================================================
  // 💰 Balance Refresh - Minimal REST API calls (every 60 seconds)
  // ============================================================================
  private startBalanceRefresh() {
    this.balanceInterval = setInterval(async () => {
      if (!this.isRunning) return;
      try {
        const balances = await this.binanceClient.getBalance();
        const usdtBalance = balances["USDT"]?.free || 0;
        if (usdtBalance > 0) {
          this.balance = usdtBalance;
        }
      } catch (error: any) {
        // Silently handle - balance will be updated from trade results
      }
    }, 60000); // Only every 60 seconds
  }

  // ============================================================================
  // 📊 Technical Indicators
  // ============================================================================
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

  // ============================================================================
  // 🧠 Signal Analysis - The 7 Minds (Trading Strategies)
  // ============================================================================
  private analyzeSymbolFast(symbol: string) {
    const data = this.symbols[symbol];
    if (!data.price || data.price === 0) return;
    if (data.positions.some((p: any) => p.status === "open" || p.status === "partial")) return;

    const emaDiff = Math.abs(data.ema12 - data.ema26);
    const emaPercent = (emaDiff / data.ema26) * 100;

    // 🧠 MIND 1: EMA Crossover LONG (Strong Bullish Trend)
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

    // 🧠 MIND 2: EMA Crossover SHORT (Strong Bearish Trend)
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

    // 🧠 MIND 3: Aggressive LONG (Moderate Bullish Momentum)
    if (
      data.ema12 > data.ema26 &&
      data.rsi > 45 &&
      data.rsi < 75 &&
      emaPercent > 0.3
    ) {
      const confidence = Math.min(100, 40 + (data.rsi - 45) + emaPercent * 8);
      this.log(`📊 ${symbol}: 🧠 Mind 3 - Aggressive LONG (EMA trend + RSI momentum)`);
      this.openPositionFast(symbol, "long", confidence);
      return;
    }

    // 🧠 MIND 4: Aggressive SHORT (Moderate Bearish Momentum)
    if (
      data.ema12 < data.ema26 &&
      data.rsi < 55 &&
      data.rsi > 25 &&
      emaPercent > 0.3
    ) {
      const confidence = Math.min(100, 40 + (55 - data.rsi) + emaPercent * 8);
      this.log(`📊 ${symbol}: 🧠 Mind 4 - Aggressive SHORT (EMA trend + RSI momentum)`);
      this.openPositionFast(symbol, "short", confidence);
      return;
    }

    // 🧠 MIND 5: Oversold Bounce LONG (RSI Recovery)
    if (data.rsi < 35 && data.ema12 > data.ema26 * 0.99) {
      const confidence = Math.min(100, 35 + (35 - data.rsi));
      this.log(`📊 ${symbol}: 🧠 Mind 5 - Oversold LONG (RSI bounce opportunity)`);
      this.openPositionFast(symbol, "long", confidence);
      return;
    }

    // 🧠 MIND 6: Overbought Pullback SHORT (RSI Reversal)
    if (data.rsi > 65 && data.ema12 < data.ema26 * 1.01) {
      const confidence = Math.min(100, 35 + (data.rsi - 65));
      this.log(`📊 ${symbol}: 🧠 Mind 6 - Overbought SHORT (RSI pullback opportunity)`);
      this.openPositionFast(symbol, "short", confidence);
      return;
    }

    // 🧠 MIND 7: Trailing Profit & Dynamic Risk Management
    // (Implemented in managePositionsFast - trailing stop loss & partial take profits)
  }

  // ============================================================================
  // 💼 Position Management
  // ============================================================================
  private async openPositionFast(symbol: string, side: string, confidence: number) {
    const data = this.symbols[symbol];
    const entryPrice = data.price;
    const leverage = 5 + (confidence / 100) * 5;
    // 🧠 REALISTIC RISK MANAGEMENT: 5% of current available balance
    const riskAmount = this.balance * 0.05;

    if (riskAmount < 1) {
      this.log(`⚠️ ${symbol}: Insufficient balance for trade (balance: $${this.balance.toFixed(2)})`);
      return;
    }

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
      partialClosedAt: [] as number[],
      orderId: orderResult?.orderId || `ORD-${Date.now()}`,
    };

    data.positions.push(position);
    this.totalTrades++;

    this.log(
      `⚡ OPEN ${side.toUpperCase()} on ${symbol} | Entry: $${entryPrice.toFixed(2)} | ` +
        `Leverage: ${leverage.toFixed(1)}x | Confidence: ${confidence.toFixed(0)}% | ` +
        `Margin: $${riskAmount.toFixed(2)} (5% of $${this.balance.toFixed(2)})`
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

      // 🧠 MIND 7: Trailing Stop Loss (Dynamic Risk Management)
      // Move stop loss to break-even after TP1, then trail it
      if (position.status === "partial" && priceDiff > 0) {
        const newTrailingStop =
          position.side === "long"
            ? currentPrice * (1 - 0.015) // Trail 1.5% below current price
            : currentPrice * (1 + 0.015); // Trail 1.5% above current price

        if (position.side === "long" && newTrailingStop > position.trailingStopLoss) {
          position.trailingStopLoss = newTrailingStop;
        }
        if (position.side === "short" && newTrailingStop < position.trailingStopLoss) {
          position.trailingStopLoss = newTrailingStop;
        }
      }

      // Check stop loss (use trailing stop if available)
      const effectiveStopLoss = position.status === "partial" 
        ? position.trailingStopLoss 
        : position.stopLoss;

      if (position.side === "long" && currentPrice <= effectiveStopLoss) {
        await this.closePositionFast(position, currentPrice, 
          position.status === "partial" ? "Trailing Stop" : "Stop Loss");
        this.losingTrades++;
        continue;
      }

      if (position.side === "short" && currentPrice >= effectiveStopLoss) {
        await this.closePositionFast(position, currentPrice,
          position.status === "partial" ? "Trailing Stop" : "Stop Loss");
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
          position.trailingStopLoss = position.entryPrice; // Move SL to break-even
          position.partialClosedAt.push(Date.now());
          this.log(`✅ TP1 HIT on ${symbol} | Profit: $${profit1.toFixed(2)} | SL moved to break-even`);
        }

        if (position.side === "short" && currentPrice <= position.takeProfit1) {
          const profit1 =
            (position.quantity * 0.5) * (position.entryPrice - position.takeProfit1);
          this.balance += profit1;
          this.totalProfit += profit1;
          position.status = "partial";
          position.trailingStopLoss = position.entryPrice;
          position.partialClosedAt.push(Date.now());
          this.log(`✅ TP1 HIT on ${symbol} | Profit: $${profit1.toFixed(2)} | SL moved to break-even`);
        }
      }

      if (position.status === "partial") {
        if (position.side === "long" && currentPrice >= position.takeProfit2 &&
            position.partialClosedAt.length < 2) {
          const profit2 =
            (position.quantity * 0.3) * (position.takeProfit2 - position.entryPrice);
          this.balance += profit2;
          this.totalProfit += profit2;
          position.partialClosedAt.push(Date.now());
          this.log(`✅ TP2 HIT on ${symbol} | Profit: $${profit2.toFixed(2)}`);
        }

        if (position.side === "short" && currentPrice <= position.takeProfit2 &&
            position.partialClosedAt.length < 2) {
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
          await this.closePositionFast(position, currentPrice, "TP3 (Full Target)");
          this.log(`✅ TP3 HIT on ${symbol} | Profit: $${profit3.toFixed(2)} | FULL WIN!`);
        }

        if (position.side === "short" && currentPrice <= position.takeProfit3) {
          const profit3 =
            (position.quantity * 0.2) * (position.entryPrice - position.takeProfit3);
          this.balance += profit3;
          this.totalProfit += profit3;
          this.winningTrades++;
          await this.closePositionFast(position, currentPrice, "TP3 (Full Target)");
          this.log(`✅ TP3 HIT on ${symbol} | Profit: $${profit3.toFixed(2)} | FULL WIN!`);
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
        `Reason: ${reason} | Profit: $${profit.toFixed(2)} | Balance: $${this.balance.toFixed(2)}`
    );
  }

  // ============================================================================
  // 📊 Stats & API
  // ============================================================================
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
      wsConnected: this.binanceFetcher.getConnectionStatus(),
    };
  }

  getPrice(symbol: string): number {
    return this.symbols[symbol]?.price || 0;
  }

  getKlines(symbol: string): any[] {
    return this.symbols[symbol]?.klines || [];
  }
}
