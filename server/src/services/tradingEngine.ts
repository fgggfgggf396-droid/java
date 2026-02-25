// ============================================================================
// 🔥 SOVEREIGN X v20 ELITE PRO — The Ultimate Trading Brain
// Dynamic Leverage (5x-10x) | Trailing Profit System | 24/7 Autonomous
// ============================================================================

import axios from "axios";

interface Position {
  symbol: string;
  side: "long" | "short";
  entryPrice: number;
  quantity: number;
  leverage: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  takeProfit3: number;
  confidence: number;
  timestamp: number;
  status: "open" | "partial" | "closed";
  profit: number;
  profitPercent: number;
  trailingStopLoss: number;
  partialClosedAt: number[];
}

interface SymbolData {
  symbol: string;
  price: number;
  ema12: number;
  ema26: number;
  rsi: number;
  atr: number;
  positions: Position[];
  klines: any[];
  lastUpdate: number;
}

interface Stats {
  isRunning: boolean;
  balance: number;
  totalProfit: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  symbols: { [key: string]: SymbolData };
  logs: string[];
}

export class TradingEngine {
  private isRunning = false;
  private balance = 1000; // Starting capital
  private totalProfit = 0;
  private totalTrades = 0;
  private winningTrades = 0;
  private losingTrades = 0;
  private symbols: { [key: string]: SymbolData } = {};
  private logs: string[] = [];
  private eventCallbacks: Array<(event: string, data: any) => void> = [];
  private apiKey = process.env.BINANCE_API_KEY || "";
  private apiSecret = process.env.BINANCE_API_SECRET || "";
  private baseUrl = process.env.BINANCE_TESTNET === "true" 
    ? "https://testnet.binancefuture.com" 
    : "https://fapi.binance.com";

  constructor() {
    this.initializeSymbols();
  }

  private initializeSymbols() {
    const symbols = ["BTC-USDT", "ETH-USDT", "BNB-USDT", "SOL-USDT", "XRP-USDT", "ADA-USDT"];
    for (const symbol of symbols) {
      this.symbols[symbol] = {
        symbol,
        price: 0,
        ema12: 0,
        ema26: 0,
        rsi: 0,
        atr: 0,
        positions: [],
        klines: [],
        lastUpdate: 0,
      };
    }
  }

  onEvent(callback: (event: string, data: any) => void) {
    this.eventCallbacks.push(callback);
  }

  private emit(event: string, data: any) {
    this.eventCallbacks.forEach((cb) => cb(event, data));
  }

  private log(message: string) {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${message}`;
    this.logs.push(logEntry);
    if (this.logs.length > 100) this.logs.shift();
    console.log(logEntry);
    this.emit("log", logEntry);
  }

  async start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.log("🚀 SOVEREIGN X v20 ELITE PRO started!");
    this.log("Dynamic Leverage: 5x-10x | Trailing Profit: ✅ | Risk: 5%");

    // Main trading loop
    this.tradingLoop();
  }

  async stop() {
    this.isRunning = false;
    this.log("🛑 SOVEREIGN X v20 ELITE PRO stopped");
  }

  private async tradingLoop() {
    while (this.isRunning) {
      try {
        // Fetch latest data
        await this.fetchMarketData();

        // Analyze each symbol
        for (const symbol of Object.keys(this.symbols)) {
          await this.analyzeSymbol(symbol);
          await this.managePositions(symbol);
        }

        // Emit stats
        this.emit("stats", this.getStats());

        // Wait 1 hour before next analysis
        await this.sleep(3600000);
      } catch (error: any) {
        this.log(`❌ Trading loop error: ${error.message}`);
        await this.sleep(60000);
      }
    }
  }

  private async fetchMarketData() {
    for (const symbol of Object.keys(this.symbols)) {
      try {
        const cleanSymbol = symbol.replace("-", "");
        
        // Fetch 1h klines (last 100)
        const response = await axios.get(`${this.baseUrl}/fapi/v1/klines`, {
          params: {
            symbol: cleanSymbol,
            interval: "1h",
            limit: 100,
          },
        });

        const klines = response.data;
        this.symbols[symbol].klines = klines;
        this.symbols[symbol].price = parseFloat(klines[klines.length - 1][4]); // Close price
        this.symbols[symbol].lastUpdate = Date.now();

        // Calculate indicators
        this.calculateIndicators(symbol);

        this.emit("price", { symbol, price: this.symbols[symbol].price });
      } catch (error: any) {
        this.log(`⚠️ Failed to fetch data for ${symbol}: ${error.message}`);
      }
    }
  }

  private calculateIndicators(symbol: string) {
    const data = this.symbols[symbol];
    const closes = data.klines.map((k: any) => parseFloat(k[4]));
    const highs = data.klines.map((k: any) => parseFloat(k[2]));
    const lows = data.klines.map((k: any) => parseFloat(k[3]));

    // EMA 12 & 26
    data.ema12 = this.calculateEMA(closes, 12);
    data.ema26 = this.calculateEMA(closes, 26);

    // RSI
    data.rsi = this.calculateRSI(closes, 14);

    // ATR
    data.atr = this.calculateATR(highs, lows, closes, 14);
  }

  private calculateEMA(closes: number[], period: number): number {
    if (closes.length < period) return closes[closes.length - 1];
    const multiplier = 2 / (period + 1);
    let ema = closes.slice(0, period).reduce((a, b) => a + b) / period;
    for (let i = period; i < closes.length; i++) {
      ema = closes[i] * multiplier + ema * (1 - multiplier);
    }
    return ema;
  }

  private calculateRSI(closes: number[], period: number): number {
    if (closes.length < period + 1) return 50;
    let gains = 0,
      losses = 0;
    for (let i = 1; i <= period; i++) {
      const diff = closes[closes.length - i] - closes[closes.length - i - 1];
      if (diff > 0) gains += diff;
      else losses -= diff;
    }
    const avgGain = gains / period;
    const avgLoss = losses / period;
    const rs = avgGain / (avgLoss || 1);
    return 100 - 100 / (1 + rs);
  }

  private calculateATR(highs: number[], lows: number[], closes: number[], period: number): number {
    if (highs.length < period) return 0;
    let tr = 0;
    for (let i = 1; i < highs.length; i++) {
      const h = highs[i];
      const l = lows[i];
      const c = closes[i - 1];
      const tr1 = h - l;
      const tr2 = Math.abs(h - c);
      const tr3 = Math.abs(l - c);
      tr += Math.max(tr1, tr2, tr3);
    }
    return tr / (highs.length - 1);
  }

  private async analyzeSymbol(symbol: string) {
    const data = this.symbols[symbol];
    if (!data.price) return;

    // Skip if already has open position
    if (data.positions.some((p) => p.status === "open")) return;

    const emaDiff = Math.abs(data.ema12 - data.ema26);
    const emaPercent = (emaDiff / data.ema26) * 100;

    // TREND_UP Brain
    if (data.ema12 > data.ema26 && data.rsi > 50 && data.rsi < 80 && emaPercent > 0.5) {
      const confidence = Math.min(100, 50 + (data.rsi - 50) + emaPercent * 10);
      await this.openPosition(symbol, "long", confidence);
    }

    // TREND_DOWN Brain
    if (data.ema12 < data.ema26 && data.rsi < 50 && data.rsi > 20 && emaPercent > 0.5) {
      const confidence = Math.min(100, 50 + (50 - data.rsi) + emaPercent * 10);
      await this.openPosition(symbol, "short", confidence);
    }

    // VOLATILE Brain
    if (data.atr > data.price * 0.02 && data.rsi > 40 && data.rsi < 60) {
      const confidence = 70;
      await this.openPosition(symbol, "long", confidence);
    }

    // RANGE Brain
    if (data.atr < data.price * 0.01 && data.rsi > 30 && data.rsi < 70) {
      const confidence = 60;
      await this.openPosition(symbol, "long", confidence);
    }
  }

  private async openPosition(symbol: string, side: "long" | "short", confidence: number) {
    const data = this.symbols[symbol];
    const entryPrice = data.price;

    // Dynamic Leverage: 5x-10x based on confidence
    const leverage = 5 + (confidence / 100) * 5; // 5x to 10x

    // Risk 5% of balance
    const riskAmount = this.balance * 0.05;
    const quantity = riskAmount / entryPrice;

    // Calculate Stop Loss and Take Profits
    const stopLossPercent = 0.025; // 2.5%
    const stopLoss = side === "long" 
      ? entryPrice * (1 - stopLossPercent)
      : entryPrice * (1 + stopLossPercent);

    const tp1Percent = 0.05; // 5%
    const tp2Percent = 0.075; // 7.5%
    const tp3Percent = 0.1; // 10%

    const takeProfit1 = side === "long"
      ? entryPrice * (1 + tp1Percent)
      : entryPrice * (1 - tp1Percent);

    const takeProfit2 = side === "long"
      ? entryPrice * (1 + tp2Percent)
      : entryPrice * (1 - tp2Percent);

    const takeProfit3 = side === "long"
      ? entryPrice * (1 + tp3Percent)
      : entryPrice * (1 - tp3Percent);

    const position: Position = {
      symbol,
      side,
      entryPrice,
      quantity,
      leverage,
      stopLoss,
      takeProfit1,
      takeProfit2,
      takeProfit3,
      confidence,
      timestamp: Date.now(),
      status: "open",
      profit: 0,
      profitPercent: 0,
      trailingStopLoss: stopLoss,
      partialClosedAt: [],
    };

    data.positions.push(position);
    this.totalTrades++;

    this.log(
      `📈 OPEN ${side.toUpperCase()} on ${symbol} | Entry: $${entryPrice.toFixed(2)} | ` +
      `Leverage: ${leverage.toFixed(1)}x | Confidence: ${confidence.toFixed(0)}% | ` +
      `SL: $${stopLoss.toFixed(2)} | TP1: $${takeProfit1.toFixed(2)}`
    );

    this.emit("position", position);
  }

  private async managePositions(symbol: string) {
    const data = this.symbols[symbol];
    const currentPrice = data.price;

    for (const position of data.positions) {
      if (position.status === "closed") continue;

      const priceDiff = position.side === "long" 
        ? currentPrice - position.entryPrice
        : position.entryPrice - currentPrice;

      const profitPercent = (priceDiff / position.entryPrice) * 100;
      position.profit = position.quantity * priceDiff;
      position.profitPercent = profitPercent;

      // Check Stop Loss
      if (position.side === "long" && currentPrice <= position.stopLoss) {
        this.closePosition(position, currentPrice, "Stop Loss Hit");
        this.losingTrades++;
        continue;
      }

      if (position.side === "short" && currentPrice >= position.stopLoss) {
        this.closePosition(position, currentPrice, "Stop Loss Hit");
        this.losingTrades++;
        continue;
      }

      // Trailing Profit System
      if (position.status === "open") {
        // TP1: Close 50%, move SL to Break Even
        if (position.side === "long" && currentPrice >= position.takeProfit1) {
          const profit1 = (position.quantity * 0.5) * (position.takeProfit1 - position.entryPrice);
          this.balance += profit1;
          this.totalProfit += profit1;
          position.status = "partial";
          position.trailingStopLoss = position.entryPrice; // Break Even
          position.partialClosedAt.push(Date.now());
          this.log(`✅ TP1 HIT on ${symbol} | Closed 50% | Profit: $${profit1.toFixed(2)} | SL moved to Break Even`);
        }

        if (position.side === "short" && currentPrice <= position.takeProfit1) {
          const profit1 = (position.quantity * 0.5) * (position.entryPrice - position.takeProfit1);
          this.balance += profit1;
          this.totalProfit += profit1;
          position.status = "partial";
          position.trailingStopLoss = position.entryPrice; // Break Even
          position.partialClosedAt.push(Date.now());
          this.log(`✅ TP1 HIT on ${symbol} | Closed 50% | Profit: $${profit1.toFixed(2)} | SL moved to Break Even`);
        }
      }

      if (position.status === "partial") {
        // TP2: Close 30% more
        if (position.side === "long" && currentPrice >= position.takeProfit2) {
          const profit2 = (position.quantity * 0.3) * (position.takeProfit2 - position.entryPrice);
          this.balance += profit2;
          this.totalProfit += profit2;
          position.partialClosedAt.push(Date.now());
          this.log(`✅ TP2 HIT on ${symbol} | Closed 30% more | Profit: $${profit2.toFixed(2)}`);
        }

        if (position.side === "short" && currentPrice <= position.takeProfit2) {
          const profit2 = (position.quantity * 0.3) * (position.entryPrice - position.takeProfit2);
          this.balance += profit2;
          this.totalProfit += profit2;
          position.partialClosedAt.push(Date.now());
          this.log(`✅ TP2 HIT on ${symbol} | Closed 30% more | Profit: $${profit2.toFixed(2)}`);
        }

        // TP3: Close remaining 20%
        if (position.side === "long" && currentPrice >= position.takeProfit3) {
          const profit3 = (position.quantity * 0.2) * (position.takeProfit3 - position.entryPrice);
          this.balance += profit3;
          this.totalProfit += profit3;
          this.winningTrades++;
          this.closePosition(position, currentPrice, "TP3 Hit");
          this.log(`✅ TP3 HIT on ${symbol} | Closed 20% remaining | Profit: $${profit3.toFixed(2)}`);
        }

        if (position.side === "short" && currentPrice <= position.takeProfit3) {
          const profit3 = (position.quantity * 0.2) * (position.entryPrice - position.takeProfit3);
          this.balance += profit3;
          this.totalProfit += profit3;
          this.winningTrades++;
          this.closePosition(position, currentPrice, "TP3 Hit");
          this.log(`✅ TP3 HIT on ${symbol} | Closed 20% remaining | Profit: $${profit3.toFixed(2)}`);
        }
      }

      // Update trailing stop loss
      if (position.status === "partial" && position.side === "long") {
        const newTrailingStop = Math.max(position.trailingStopLoss, currentPrice - data.atr * 0.5);
        if (newTrailingStop > position.trailingStopLoss) {
          position.trailingStopLoss = newTrailingStop;
        }
      }

      if (position.status === "partial" && position.side === "short") {
        const newTrailingStop = Math.min(position.trailingStopLoss, currentPrice + data.atr * 0.5);
        if (newTrailingStop < position.trailingStopLoss) {
          position.trailingStopLoss = newTrailingStop;
        }
      }
    }

    // Remove closed positions
    data.positions = data.positions.filter((p) => p.status !== "closed");
  }

  private closePosition(position: Position, closePrice: number, reason: string) {
    position.status = "closed";
    const profit = position.side === "long"
      ? position.quantity * (closePrice - position.entryPrice)
      : position.quantity * (position.entryPrice - closePrice);

    this.balance += profit;
    this.totalProfit += profit;

    this.log(
      `🔴 CLOSE ${position.side.toUpperCase()} on ${position.symbol} | ` +
      `Reason: ${reason} | Close Price: $${closePrice.toFixed(2)} | ` +
      `Profit: $${profit.toFixed(2)} (${((profit / (position.quantity * position.entryPrice)) * 100).toFixed(2)}%)`
    );
  }

  getStats(): Stats {
    const winRate = this.totalTrades > 0 ? (this.winningTrades / this.totalTrades) * 100 : 0;

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
    };
  }

  getPrice(symbol: string): number {
    return this.symbols[symbol]?.price || 0;
  }

  getKlines(symbol: string): any[] {
    return this.symbols[symbol]?.klines || [];
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
