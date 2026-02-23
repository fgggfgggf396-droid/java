// ============================================================================
// 🧠 STRUCTURAL INTELLIGENCE TRADING ENGINE v2.0
// Liquidity Reader — Dual-Core (BTC + ETH) — Runs 24/7 Server-Side
// ============================================================================

import axios from "axios";
import crypto from "crypto";
import { WebSocket } from "ws";
import pako from "pako";

// ============================================================================
// 📋 TYPES & INTERFACES
// ============================================================================

interface Kline {
  t: number;   // timestamp
  o: number;   // open
  h: number;   // high
  l: number;   // low
  c: number;   // close
  v: number;   // volume
}

interface ActivePosition {
  symbol: string;
  side: "BUY" | "SELL";
  positionSide: "LONG" | "SHORT";
  entryPrice: number;
  quantity: number;
  originalQuantity: number;
  stopLoss: number;
  takeProfit1x5: number;  // 1.5x risk target (partial close)
  takeProfit3x: number;   // 3x risk target (full close)
  riskPerUnit: number;    // |entry - SL| per unit
  partialClosed: boolean; // has 50% been closed?
  breakEvenMoved: boolean;
  openTime: number;
}

interface SymbolState {
  symbol: string;
  bingxSymbol: string;   // "BTC-USDT" or "ETH-USDT"
  price: number;
  klines: Kline[];
  position: ActivePosition | null;
  lastSignalTime: number;
  cooldownMs: number;
}

interface EngineStats {
  totalTrades: number;
  winTrades: number;
  lossTrades: number;
  totalPnl: number;
  balance: number;
  startBalance: number;
  iq: number;
  leverage: number;
  isRunning: boolean;
  symbols: Record<string, {
    price: number;
    klineCount: number;
    hasPosition: boolean;
    position: ActivePosition | null;
  }>;
  logs: LogEntry[];
}

interface LogEntry {
  time: number;
  type: "info" | "signal" | "trade" | "close" | "error" | "partial";
  symbol: string;
  message: string;
  pnl?: number;
}

type EventCallback = (event: string, data: any) => void;

// ============================================================================
// 🔐 CONFIG
// ============================================================================

const CONFIG = {
  API_KEY: process.env.BINGX_API_KEY || "Z4YVpLtqHiDogxdIV5gPD0N1V3dAOuKcW0VD9y76IObcDnqhrRWTstb0oDfMCPmgT7heYk308TPicY7rM0rGw",
  SECRET_KEY: process.env.BINGX_SECRET_KEY || "2Ed3WvfIkFJTEPKQWmL5UvH9AIrHUEOwKIWB4aUNH7KXwuDjhhC1BLyBfipFSWqgog4IGFWyLOVtr9PnCRyYA",
  REST_URL: "https://open-api.bingx.com",
  WS_URL: "wss://open-api-swap.bingx.com/swap-market",

  SYMBOLS: ["BTC-USDT", "ETH-USDT"] as const,
  RISK_PERCENT: 0.05,        // 5% risk per trade
  SL_BUFFER_PERCENT: 0.0005, // 0.05% safety buffer
  WICK_BODY_RATIO: 1.5,      // Minimum wick:body ratio for quality filter
  LOOKBACK_CANDLES: 30,       // SFP lookback period
  SIGNAL_COOLDOWN_MS: 15000,  // 15s cooldown between signals per symbol
  MAX_CONCURRENT: 2,          // Max 2 positions (1 per symbol)

  INITIAL_LEVERAGE: 10,
  MIN_LEVERAGE: 5,
  MAX_LEVERAGE: 20,
  IQ_WIN_BOOST: 5,
  IQ_LOSS_PENALTY: 2,
  LEVERAGE_WIN_BOOST: 1,
  LEVERAGE_LOSS_PENALTY: 1,

  // Minimum quantities
  MIN_QTY: { "BTC-USDT": 0.001, "ETH-USDT": 0.01 } as Record<string, number>,
};

// ============================================================================
// 🛠️ BingX API Layer
// ============================================================================

function parseParam(paramsMap: Record<string, any>): { paramsStr: string; urlParamsStr: string } {
  const sortedKeys = Object.keys(paramsMap).sort();
  const paramsList: string[] = [];
  const urlParamsList: string[] = [];

  for (const key of sortedKeys) {
    paramsList.push(`${key}=${paramsMap[key]}`);
  }

  const timestamp = Date.now().toString();
  let paramsStr = paramsList.join("&");
  paramsStr = paramsStr !== "" ? paramsStr + "&timestamp=" + timestamp : "timestamp=" + timestamp;

  const hasComplex = paramsStr.includes("[") || paramsStr.includes("{");

  for (const key of sortedKeys) {
    const value = paramsMap[key];
    urlParamsList.push(hasComplex ? `${key}=${encodeURIComponent(String(value))}` : `${key}=${value}`);
  }

  let urlParamsStr = urlParamsList.join("&");
  urlParamsStr = urlParamsStr !== "" ? urlParamsStr + "&timestamp=" + timestamp : "timestamp=" + timestamp;

  return { paramsStr, urlParamsStr };
}

function getSign(paramsStr: string): string {
  return crypto.createHmac("sha256", CONFIG.SECRET_KEY).update(paramsStr).digest("hex");
}

async function bingxRequest(method: "GET" | "POST", endpoint: string, params: Record<string, any> = {}): Promise<any> {
  const { paramsStr, urlParamsStr } = parseParam(params);
  const signature = getSign(paramsStr);
  const url = `${CONFIG.REST_URL}${endpoint}?${urlParamsStr}&signature=${signature}`;

  const response = await axios({ method, url, headers: { "X-BX-APIKEY": CONFIG.API_KEY } });
  return response.data;
}

// ============================================================================
// 🧠 STRUCTURAL INTELLIGENCE TRADING ENGINE CLASS
// ============================================================================

export class TradingEngine {
  private symbols: Map<string, SymbolState> = new Map();
  private ws: WebSocket | null = null;
  private wsReconnectTimer: any = null;
  private pingInterval: any = null;
  private monitorInterval: any = null;

  private isRunning = false;
  private balance = 0;
  private startBalance = 0;
  private iq = 100;
  private leverage: number = CONFIG.INITIAL_LEVERAGE;
  private totalTrades = 0;
  private winTrades = 0;
  private lossTrades = 0;
  private totalPnl = 0;
  private logs: LogEntry[] = [];
  private eventCallbacks: EventCallback[] = [];

  constructor() {
    for (const sym of CONFIG.SYMBOLS) {
      this.symbols.set(sym, {
        symbol: sym,
        bingxSymbol: sym,
        price: 0,
        klines: [],
        position: null,
        lastSignalTime: 0,
        cooldownMs: CONFIG.SIGNAL_COOLDOWN_MS,
      });
    }
  }

  // ---- Event System ----
  onEvent(cb: EventCallback) {
    this.eventCallbacks.push(cb);
  }

  private emit(event: string, data: any) {
    for (const cb of this.eventCallbacks) {
      try { cb(event, data); } catch (e) { /* silent */ }
    }
  }

  private log(type: LogEntry["type"], symbol: string, message: string, pnl?: number) {
    const entry: LogEntry = { time: Date.now(), type, symbol, message, pnl };
    this.logs.push(entry);
    if (this.logs.length > 500) this.logs.shift();
    console.log(`[ENGINE][${type.toUpperCase()}][${symbol}] ${message}${pnl !== undefined ? ` | PnL: ${pnl.toFixed(4)}` : ""}`);
    this.emit("log", entry);
  }

  // ---- Public API ----
  async start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.log("info", "SYSTEM", "🚀 Structural Intelligence Engine v2.0 starting...");

    // Fetch balance
    await this.syncBalance();
    this.startBalance = this.balance;
    this.log("info", "SYSTEM", `💰 Balance: $${this.balance.toFixed(2)}`);

    // Set margin mode to CROSS for all symbols
    for (const sym of CONFIG.SYMBOLS) {
      await this.setMarginMode(sym, "CROSSED");
    }

    // Set leverage for all symbols
    await this.setLeverageAll(this.leverage);

    // Load initial klines
    for (const sym of CONFIG.SYMBOLS) {
      await this.loadKlines(sym);
    }

    // Connect WebSocket
    this.connectWS();

    // Start position monitor (checks SL/TP/partial every 500ms)
    this.monitorInterval = setInterval(() => this.monitorPositions(), 500);

    this.log("info", "SYSTEM", `✅ Engine running | Symbols: ${CONFIG.SYMBOLS.join(", ")} | Leverage: ${this.leverage}x | Risk: ${CONFIG.RISK_PERCENT * 100}%`);
    this.emit("started", this.getStats());
  }

  async stop() {
    if (!this.isRunning) return;
    this.isRunning = false;
    this.log("info", "SYSTEM", "🛑 Engine stopping...");

    if (this.monitorInterval) { clearInterval(this.monitorInterval); this.monitorInterval = null; }
    if (this.pingInterval) { clearInterval(this.pingInterval); this.pingInterval = null; }
    if (this.wsReconnectTimer) { clearTimeout(this.wsReconnectTimer); this.wsReconnectTimer = null; }
    if (this.ws) { try { this.ws.close(); } catch (e) {} this.ws = null; }

    this.emit("stopped", this.getStats());
  }

  getStats(): EngineStats {
    const symbolStats: Record<string, any> = {};
    for (const [sym, state] of this.symbols) {
      symbolStats[sym] = {
        price: state.price,
        klineCount: state.klines.length,
        hasPosition: state.position !== null,
        position: state.position,
      };
    }
    return {
      totalTrades: this.totalTrades,
      winTrades: this.winTrades,
      lossTrades: this.lossTrades,
      totalPnl: this.totalPnl,
      balance: this.balance,
      startBalance: this.startBalance,
      iq: this.iq,
      leverage: this.leverage,
      isRunning: this.isRunning,
      symbols: symbolStats,
      logs: this.logs.slice(-100),
    };
  }

  getPrice(symbol: string): number {
    return this.symbols.get(symbol)?.price || 0;
  }

  getKlines(symbol: string): Kline[] {
    return this.symbols.get(symbol)?.klines || [];
  }

  // ---- Balance ----
  private async syncBalance() {
    try {
      const res = await bingxRequest("GET", "/openApi/swap/v3/user/balance");
      if (res.code === 0 && res.data) {
        const data = res.data;
        if (Array.isArray(data)) {
          const usdt = data.find((b: any) => b.asset === "USDT");
          if (usdt) this.balance = parseFloat(usdt.balance || usdt.equity || usdt.availableMargin || "0");
        } else {
          this.balance = parseFloat(data.availableMargin || data.balance || "0");
        }
      }
    } catch (e: any) {
      this.log("error", "SYSTEM", `Balance sync failed: ${e.message}`);
    }
  }

  // ---- Margin Mode ----
  private async setMarginMode(symbol: string, mode: "ISOLATED" | "CROSSED") {
    try {
      await bingxRequest("POST", "/openApi/swap/v2/trade/marginType", { symbol, marginType: mode });
      this.log("info", symbol, `📐 Margin mode set to ${mode}`);
    } catch (e: any) {
      // May already be set — not critical
      this.log("info", symbol, `📐 Margin mode: ${mode} (may already be set)`);
    }
  }

  // ---- Leverage ----
  private async setLeverageAll(lev: number) {
    for (const sym of CONFIG.SYMBOLS) {
      try {
        await bingxRequest("POST", "/openApi/swap/v2/trade/leverage", { symbol: sym, side: "LONG", leverage: lev });
        await bingxRequest("POST", "/openApi/swap/v2/trade/leverage", { symbol: sym, side: "SHORT", leverage: lev });
        this.log("info", sym, `⚙️ Leverage set to ${lev}x (LONG+SHORT)`);
      } catch (e: any) {
        this.log("error", sym, `Leverage error: ${e.message}`);
      }
    }
  }

  private evolveLeverage(win: boolean) {
    this.iq += win ? CONFIG.IQ_WIN_BOOST : -CONFIG.IQ_LOSS_PENALTY;
    const oldLev = this.leverage;
    this.leverage = win
      ? Math.min(this.leverage + CONFIG.LEVERAGE_WIN_BOOST, CONFIG.MAX_LEVERAGE)
      : Math.max(this.leverage - CONFIG.LEVERAGE_LOSS_PENALTY, CONFIG.MIN_LEVERAGE);
    if (oldLev !== this.leverage) {
      this.log("info", "SYSTEM", `🧠 IQ: ${this.iq} | Leverage: ${oldLev}x → ${this.leverage}x`);
      this.setLeverageAll(this.leverage).catch(() => {});
    }
  }

  // ---- Load Klines ----
  private async loadKlines(symbol: string) {
    try {
      const res = await bingxRequest("GET", "/openApi/swap/v3/quote/klines", {
        symbol, interval: "1m", limit: 100,
      });
      if (res.code === 0 && Array.isArray(res.data)) {
        const state = this.symbols.get(symbol);
        if (state) {
          state.klines = res.data.map((k: any) => ({
            t: k.time || k.t || k.T,
            o: parseFloat(k.open || k.o || "0"),
            h: parseFloat(k.high || k.h || "0"),
            l: parseFloat(k.low || k.l || "0"),
            c: parseFloat(k.close || k.c || "0"),
            v: parseFloat(k.volume || k.v || "0"),
          }));
          this.log("info", symbol, `📊 Loaded ${state.klines.length} klines`);
        }
      }
    } catch (e: any) {
      this.log("error", symbol, `Klines load failed: ${e.message}`);
    }
  }

  // ============================================================================
  // 📡 WebSocket — Dual Symbol Monitoring
  // ============================================================================

  private connectWS() {
    if (this.wsReconnectTimer) { clearTimeout(this.wsReconnectTimer); this.wsReconnectTimer = null; }
    if (!this.isRunning) return;

    try {
      this.ws = new WebSocket(CONFIG.WS_URL);
    } catch (err) {
      this.wsReconnectTimer = setTimeout(() => this.connectWS(), 5000);
      return;
    }

    this.ws.on("open", () => {
      this.log("info", "SYSTEM", "🔌 WebSocket connected — subscribing to dual symbols");

      // Subscribe to BOTH symbols
      for (const sym of CONFIG.SYMBOLS) {
        this.ws!.send(JSON.stringify({ id: `trade_${sym}`, reqType: "sub", dataType: `${sym}@trade` }));
        this.ws!.send(JSON.stringify({ id: `kline_${sym}`, reqType: "sub", dataType: `${sym}@kline_1m` }));
      }

      // Keep-alive
      if (this.pingInterval) clearInterval(this.pingInterval);
      this.pingInterval = setInterval(() => {
        if (this.ws?.readyState === WebSocket.OPEN) this.ws.send("Pong");
      }, 20000);

      this.emit("ws_connected", true);
    });

    this.ws.on("message", (data: Buffer) => {
      try {
        let decompressed: string;
        try { decompressed = pako.inflate(data, { to: "string" }); } catch { decompressed = data.toString(); }

        if (decompressed === "Ping") { this.ws?.send("Pong"); return; }

        const json = JSON.parse(decompressed);
        const dataType: string = json.dataType || "";

        // Determine which symbol this data belongs to
        for (const sym of CONFIG.SYMBOLS) {
          if (dataType.startsWith(sym)) {
            const state = this.symbols.get(sym);
            if (!state) continue;

            // Trade data → price update
            if (dataType.endsWith("@trade")) {
              const trades = json.data;
              let newPrice = 0;
              if (Array.isArray(trades) && trades.length > 0) {
                newPrice = parseFloat(trades[0]?.p || "0");
              } else if (trades?.p) {
                newPrice = parseFloat(trades.p);
              }
              if (newPrice > 0) {
                state.price = newPrice;
                this.emit("price", { symbol: sym, price: newPrice });
              }
            }

            // Kline data
            if (dataType.endsWith("@kline_1m")) {
              const kData = json.data;
              const k = Array.isArray(kData) ? kData[0] : kData;
              if (k) {
                const kline: Kline = {
                  t: k.t || k.T,
                  o: parseFloat(k.o || k.O || "0"),
                  h: parseFloat(k.h || k.H || "0"),
                  l: parseFloat(k.l || k.L || "0"),
                  c: parseFloat(k.c || k.C || "0"),
                  v: parseFloat(k.v || k.V || "0"),
                };

                // Update or append kline
                if (state.klines.length > 0 && state.klines[state.klines.length - 1].t === kline.t) {
                  state.klines[state.klines.length - 1] = kline;
                } else {
                  state.klines.push(kline);
                  if (state.klines.length > 200) state.klines.shift();

                  // New candle closed → analyze for signal (only on new candle)
                  if (this.isRunning) {
                    this.analyzeAndTrade(sym).catch((e) => {
                      this.log("error", sym, `Analysis error: ${e.message}`);
                    });
                  }
                }

                this.emit("kline", { symbol: sym, kline });
              }
            }
            break; // Found the symbol, no need to check others
          }
        }
      } catch (e) {
        // Silent parse errors
      }
    });

    this.ws.on("error", (err: any) => {
      this.log("error", "SYSTEM", `WS Error: ${err.message}`);
      if (this.pingInterval) clearInterval(this.pingInterval);
      this.wsReconnectTimer = setTimeout(() => this.connectWS(), 5000);
    });

    this.ws.on("close", () => {
      this.log("info", "SYSTEM", "🔌 WS Closed. Reconnecting in 5s...");
      if (this.pingInterval) clearInterval(this.pingInterval);
      this.emit("ws_connected", false);
      this.wsReconnectTimer = setTimeout(() => this.connectWS(), 5000);
    });
  }

  // ============================================================================
  // 🔍 SFP SIGNAL DETECTION — Structural Liquidity Sweep
  // ============================================================================

  private detectSFP(klines: Kline[]): { signal: "BUY" | "SELL"; sweepCandle: Kline } | null {
    if (klines.length < CONFIG.LOOKBACK_CANDLES + 1) return null;

    const current = klines[klines.length - 1];
    const lookback = klines.slice(-CONFIG.LOOKBACK_CANDLES - 1, -1);

    const lowestLow = Math.min(...lookback.map(k => k.l));
    const highestHigh = Math.max(...lookback.map(k => k.h));

    const body = Math.abs(current.c - current.o);
    const fullRange = current.h - current.l;

    // Avoid zero-body candles
    if (body === 0 || fullRange === 0) return null;

    // ---- BULLISH SFP: Price swept below support then closed above ----
    if (current.l < lowestLow && current.c > lowestLow) {
      // Quality filter: lower wick must be >= 1.5x body
      const lowerWick = Math.min(current.o, current.c) - current.l;
      if (lowerWick / body >= CONFIG.WICK_BODY_RATIO) {
        return { signal: "BUY", sweepCandle: current };
      }
    }

    // ---- BEARISH SFP: Price swept above resistance then closed below ----
    if (current.h > highestHigh && current.c < highestHigh) {
      // Quality filter: upper wick must be >= 1.5x body
      const upperWick = current.h - Math.max(current.o, current.c);
      if (upperWick / body >= CONFIG.WICK_BODY_RATIO) {
        return { signal: "SELL", sweepCandle: current };
      }
    }

    return null;
  }

  // ============================================================================
  // 📊 ANALYZE & TRADE — Core Decision Loop
  // ============================================================================

  private async analyzeAndTrade(symbol: string) {
    const state = this.symbols.get(symbol);
    if (!state || !this.isRunning) return;

    // Cooldown check
    if (Date.now() - state.lastSignalTime < state.cooldownMs) return;

    // Already has a position on this symbol
    if (state.position) return;

    // Max concurrent positions check
    let activeCount = 0;
    for (const [, s] of this.symbols) {
      if (s.position) activeCount++;
    }
    if (activeCount >= CONFIG.MAX_CONCURRENT) return;

    // Detect SFP signal
    const sfp = this.detectSFP(state.klines);
    if (!sfp) return;

    state.lastSignalTime = Date.now();
    this.log("signal", symbol, `🎯 SFP ${sfp.signal} detected at $${state.price.toLocaleString()} | Wick quality: PASSED`);

    // Refresh balance before trade
    await this.syncBalance();

    // Calculate position size based on 5% risk
    const riskAmount = this.balance * CONFIG.RISK_PERCENT;
    const buffer = CONFIG.SL_BUFFER_PERCENT;

    let stopLoss: number;
    let entryPrice = state.price;

    if (sfp.signal === "BUY") {
      // SL below the sweep candle's lowest wick + buffer
      stopLoss = sfp.sweepCandle.l * (1 - buffer);
    } else {
      // SL above the sweep candle's highest wick + buffer
      stopLoss = sfp.sweepCandle.h * (1 + buffer);
    }

    const riskPerUnit = Math.abs(entryPrice - stopLoss);
    if (riskPerUnit <= 0) return;

    // Position size: risk / riskPerUnit (with leverage)
    let quantity = (riskAmount * this.leverage) / entryPrice;
    const minQty = CONFIG.MIN_QTY[symbol] || 0.001;

    // Round to appropriate precision
    if (symbol === "BTC-USDT") {
      quantity = Math.floor(quantity * 1000) / 1000; // 3 decimals
    } else {
      quantity = Math.floor(quantity * 100) / 100; // 2 decimals
    }

    if (quantity < minQty) {
      this.log("info", symbol, `⚠️ Quantity too small: ${quantity} < ${minQty} — skipping`);
      return;
    }

    // Calculate TP targets
    const tp1x5 = sfp.signal === "BUY"
      ? entryPrice + riskPerUnit * 1.5
      : entryPrice - riskPerUnit * 1.5;

    const tp3x = sfp.signal === "BUY"
      ? entryPrice + riskPerUnit * 3
      : entryPrice - riskPerUnit * 3;

    this.log("trade", symbol, `📈 Opening ${sfp.signal}: qty=${quantity}, entry=$${entryPrice.toFixed(2)}, SL=$${stopLoss.toFixed(2)}, TP1.5x=$${tp1x5.toFixed(2)}, TP3x=$${tp3x.toFixed(2)}`);

    try {
      // Set leverage before order
      const positionSide = sfp.signal === "BUY" ? "LONG" : "SHORT";
      await bingxRequest("POST", "/openApi/swap/v2/trade/leverage", {
        symbol, side: positionSide, leverage: this.leverage,
      });

      // Place market order with SL at structural level
      const orderParams: Record<string, any> = {
        symbol,
        side: sfp.signal,
        positionSide,
        type: "MARKET",
        quantity: quantity.toString(),
        stopLoss: JSON.stringify({
          type: "STOP_MARKET",
          stopPrice: parseFloat(stopLoss.toFixed(2)),
          workingType: "MARK_PRICE",
        }),
      };

      const res = await bingxRequest("POST", "/openApi/swap/v2/trade/order", orderParams);

      if (res.code === 0) {
        const filledPrice = parseFloat(res.data?.order?.avgPrice || entryPrice.toString());

        // Recalculate with actual fill price
        const actualRiskPerUnit = Math.abs(filledPrice - stopLoss);
        const actualTp1x5 = sfp.signal === "BUY"
          ? filledPrice + actualRiskPerUnit * 1.5
          : filledPrice - actualRiskPerUnit * 1.5;
        const actualTp3x = sfp.signal === "BUY"
          ? filledPrice + actualRiskPerUnit * 3
          : filledPrice - actualRiskPerUnit * 3;

        state.position = {
          symbol,
          side: sfp.signal,
          positionSide,
          entryPrice: filledPrice,
          quantity,
          originalQuantity: quantity,
          stopLoss,
          takeProfit1x5: actualTp1x5,
          takeProfit3x: actualTp3x,
          riskPerUnit: actualRiskPerUnit,
          partialClosed: false,
          breakEvenMoved: false,
          openTime: Date.now(),
        };

        this.log("trade", symbol, `✅ FILLED at $${filledPrice.toFixed(2)} | SL: $${stopLoss.toFixed(2)} | TP1.5x: $${actualTp1x5.toFixed(2)} | TP3x: $${actualTp3x.toFixed(2)}`);
        this.emit("trade_opened", { symbol, position: state.position });
      } else {
        this.log("error", symbol, `❌ Order failed: ${res.msg}`);
      }
    } catch (e: any) {
      this.log("error", symbol, `❌ Order error: ${e.response?.data?.msg || e.message}`);
    }
  }

  // ============================================================================
  // 🔄 POSITION MONITOR — SL/TP/Partial Close Logic (runs every 500ms)
  // ============================================================================

  private async monitorPositions() {
    if (!this.isRunning) return;

    for (const [sym, state] of this.symbols) {
      if (!state.position || state.price <= 0) continue;

      const pos = state.position;
      const currentPrice = state.price;

      // Calculate current PnL per unit
      const pnlPerUnit = pos.side === "BUY"
        ? currentPrice - pos.entryPrice
        : pos.entryPrice - currentPrice;

      const riskMultiple = pnlPerUnit / pos.riskPerUnit;

      // ---- CHECK STOP LOSS HIT (programmatic SL as backup) ----
      const slHit = pos.side === "BUY"
        ? currentPrice <= pos.stopLoss
        : currentPrice >= pos.stopLoss;

      if (slHit) {
        this.log("close", sym, `🛑 STOP LOSS HIT at $${currentPrice.toFixed(2)}`);
        await this.closePosition(sym, pos.quantity, "SL_HIT");
        continue;
      }

      // ---- CHECK 1.5x TARGET — Partial Close 50% ----
      if (!pos.partialClosed && riskMultiple >= 1.5) {
        const halfQty = this.roundQty(sym, pos.quantity / 2);
        if (halfQty > 0) {
          this.log("partial", sym, `🎯 1.5x reached ($${currentPrice.toFixed(2)}) — Closing 50% (${halfQty})`);
          const success = await this.closePartial(sym, halfQty);
          if (success) {
            pos.partialClosed = true;
            pos.quantity = this.roundQty(sym, pos.quantity - halfQty);

            // Move SL to break-even
            pos.stopLoss = pos.entryPrice;
            pos.breakEvenMoved = true;
            this.log("info", sym, `🔒 SL moved to Break-Even: $${pos.entryPrice.toFixed(2)}`);

            // Update SL on exchange
            await this.updateStopLoss(sym, pos);
            this.emit("partial_close", { symbol: sym, position: pos });
          }
        }
      }

      // ---- CHECK 3x TARGET — Close Remaining 50% ----
      if (pos.partialClosed && riskMultiple >= 3.0) {
        this.log("close", sym, `🏆 3x TARGET reached ($${currentPrice.toFixed(2)}) — Closing remaining`);
        await this.closePosition(sym, pos.quantity, "TP_3X");
      }
    }
  }

  // ---- Close partial position ----
  private async closePartial(symbol: string, quantity: number): Promise<boolean> {
    const state = this.symbols.get(symbol);
    if (!state?.position) return false;

    try {
      const closeSide = state.position.side === "BUY" ? "SELL" : "BUY";
      const res = await bingxRequest("POST", "/openApi/swap/v2/trade/order", {
        symbol,
        side: closeSide,
        positionSide: state.position.positionSide,
        type: "MARKET",
        quantity: quantity.toString(),
      });

      if (res.code === 0) {
        const partialPnl = (state.position.side === "BUY"
          ? state.price - state.position.entryPrice
          : state.position.entryPrice - state.price) * quantity;

        this.totalPnl += partialPnl;
        this.balance += partialPnl;
        this.log("partial", symbol, `✅ Partial close: ${quantity} units | PnL: $${partialPnl.toFixed(4)}`, partialPnl);
        return true;
      }
      return false;
    } catch (e: any) {
      this.log("error", symbol, `Partial close error: ${e.message}`);
      return false;
    }
  }

  // ---- Close full position ----
  private async closePosition(symbol: string, quantity: number, reason: string) {
    const state = this.symbols.get(symbol);
    if (!state?.position) return;

    const pos = state.position;
    try {
      const closeSide = pos.side === "BUY" ? "SELL" : "BUY";
      const res = await bingxRequest("POST", "/openApi/swap/v2/trade/order", {
        symbol,
        side: closeSide,
        positionSide: pos.positionSide,
        type: "MARKET",
        quantity: quantity.toString(),
      });

      if (res.code === 0) {
        const pnlPerUnit = pos.side === "BUY"
          ? state.price - pos.entryPrice
          : pos.entryPrice - state.price;
        const tradePnl = pnlPerUnit * quantity;
        const totalTradePnl = pnlPerUnit * pos.originalQuantity; // approximate

        this.totalPnl += tradePnl;
        this.balance += tradePnl;
        this.totalTrades++;

        const isWin = totalTradePnl > 0;
        if (isWin) this.winTrades++; else this.lossTrades++;

        this.evolveLeverage(isWin);

        this.log("close", symbol, `${isWin ? "🟢" : "🔴"} ${reason}: PnL $${tradePnl.toFixed(4)} | Total: $${this.totalPnl.toFixed(4)}`, tradePnl);

        state.position = null;
        this.emit("trade_closed", { symbol, pnl: tradePnl, reason, isWin });

        // Sync real balance
        await this.syncBalance();
      } else {
        this.log("error", symbol, `Close failed: ${res.msg}`);
      }
    } catch (e: any) {
      this.log("error", symbol, `Close error: ${e.message}`);
      // Force clear position state to prevent stuck positions
      state.position = null;
    }
  }

  // ---- Update SL on exchange (cancel old, place new) ----
  private async updateStopLoss(symbol: string, pos: ActivePosition) {
    try {
      // Cancel all open orders for this symbol to remove old SL
      await bingxRequest("POST", "/openApi/swap/v2/trade/cancelAllOpenOrders", { symbol });

      // Place new SL order
      const closeSide = pos.side === "BUY" ? "SELL" : "BUY";
      await bingxRequest("POST", "/openApi/swap/v2/trade/order", {
        symbol,
        side: closeSide,
        positionSide: pos.positionSide,
        type: "STOP_MARKET",
        quantity: pos.quantity.toString(),
        stopPrice: parseFloat(pos.stopLoss.toFixed(2)),
        workingType: "MARK_PRICE",
      });

      this.log("info", symbol, `📝 SL updated on exchange to $${pos.stopLoss.toFixed(2)}`);
    } catch (e: any) {
      this.log("error", symbol, `SL update error: ${e.message} — programmatic SL still active`);
    }
  }

  // ---- Utility ----
  private roundQty(symbol: string, qty: number): number {
    if (symbol === "BTC-USDT") return Math.floor(qty * 1000) / 1000;
    return Math.floor(qty * 100) / 100;
  }
}
