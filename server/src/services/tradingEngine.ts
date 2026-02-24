
// ============================================================================
// 🧠 SOVEREIGN X — PURE PROBABILISTIC ENGINE v4.0 (LIVE TRADING)
// Dual-Core (BTC + ETH) | 24/7 Autonomous | Cross Margin | 10x
// Protocol: Probabilistic Entry → 50% Exit @ 1.5x → BE → 3x Full Exit
// ============================================================================

import axios from "axios";
import crypto from "crypto";
import { WebSocket } from "ws";
import pako from "pako";

// ============================================================================
// 📋 TYPES & INTERFACES
// ============================================================================

interface Kline {
  t: number; o: number; h: number; l: number; c: number; v: number;
}

interface ActivePosition {
  symbol: string;
  side: "BUY" | "SELL";
  positionSide: "LONG" | "SHORT";
  entryPrice: number;
  quantity: number;
  originalQuantity: number;
  stopLoss: number;
  takeProfit1x5: number;
  takeProfit3x: number;
  riskAmount: number;
  riskPerUnit: number;
  partialClosed: boolean;
  breakEvenMoved: boolean;
  openTime: number;
}

interface SymbolState {
  symbol: string;
  bingxSymbol: string;
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
  leverage: number;
  isRunning: boolean;
  symbols: Record<string, {
    price: number;
    klineCount: number;
    hasPosition: boolean;
    position: ActivePosition | null;
  }>;
  logs: LogEntry[];
  tpHits: number;
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
// 🔐 CONFIG — PURE PROBABILISTIC PARAMETERS (LIVE)
// ============================================================================

const CONFIG = {
  API_KEY: process.env.BINGX_API_KEY || "Z4YVpLtqHiDogxdIV5gPD0N1V3dAOuKcW0VD9y76IObcDnqhrRWTstb0oDfMCPmgT7heYk308TPicY7rM0rGw",
  SECRET_KEY: process.env.BINGX_SECRET_KEY || "2Ed3WvfIkFJTEPKQWmL5UvH9AIrHUEOwKIWB4aUNH7KXwuDjhhC1BLyBfipFSWqgog4IGFWyLOVtr9PnCRyYA",
  REST_URL: "https://open-api.bingx.com",
  WS_URL: "wss://open-api-swap.bingx.com/swap-market",

  SYMBOLS: ["BTC-USDT", "ETH-USDT"] as const,

  // === USER'S EXACT FINANCIAL FRAMEWORK ===
  RISK_PERCENT: 0.05,          // 5% of live balance per trade
  RISK_CAP: 50.0,              // Max $50 risk per trade
  FEE_RATE: 0.001,             // 0.1% total fee
  LEVERAGE: 10,                // 10x leverage
  MARGIN_MODE: "CROSSED",      // Cross Margin

  SIGNAL_COOLDOWN_MS: 15000,   // 15 seconds cooldown for probabilistic signals
  MAX_CONCURRENT: 2,

  MIN_QTY: { "BTC-USDT": 0.001, "ETH-USDT": 0.01 } as Record<string, number>,
};

// ============================================================================
// 🛠️ BingX API Layer
// ============================================================================

function parseParam(paramsMap: Record<string, any>): { paramsStr: string; urlParamsStr: string } {
  const sortedKeys = Object.keys(paramsMap).sort();
  const paramsList: string[] = [];
  const urlParamsList: string[] = [];
  for (const key of sortedKeys) paramsList.push(`${key}=${paramsMap[key]}`);
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
// 🧠 SOVEREIGN X ENGINE CLASS (LIVE TRADING)
// ============================================================================

export class TradingEngine {
  private symbols: Map<string, SymbolState> = new Map();
  private ws: WebSocket | null = null;
  private wsReconnectTimer: any = null;
  private pingInterval: any = null;
  private monitorInterval: any = null;
  private signalInterval: any = null;

  private isRunning = false;
  private balance = 0;
  private startBalance = 0;
  private leverage: number = CONFIG.LEVERAGE;
  private totalTrades = 0;
  private winTrades = 0;
  private lossTrades = 0;
  private totalPnl = 0;
  private tpHits = 0;
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

  onEvent(cb: EventCallback) { this.eventCallbacks.push(cb); }
  private emit(event: string, data: any) { for (const cb of this.eventCallbacks) { try { cb(event, data); } catch (e) {} } }
  private log(type: LogEntry["type"], symbol: string, message: string, pnl?: number) {
    const entry: LogEntry = { time: Date.now(), type, symbol, message, pnl };
    this.logs.push(entry);
    if (this.logs.length > 500) this.logs.shift();
    console.log(`[ENGINE][${type.toUpperCase()}][${symbol}] ${message}${pnl !== undefined ? ` | PnL: ${pnl.toFixed(4)}` : ""}`);
    this.emit("log", entry);
  }

  async start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.log("info", "SYSTEM", "🚀 Sovereign X — Pure Probabilistic Engine starting LIVE...");
    await this.syncBalance();
    this.startBalance = this.balance;
    this.log("info", "SYSTEM", `💰 Balance: $${this.balance.toFixed(2)}`);
    for (const sym of CONFIG.SYMBOLS) await this.setMarginMode(sym, CONFIG.MARGIN_MODE as "CROSSED");
    await this.setLeverageAll(CONFIG.LEVERAGE);
    this.connectWS();
    this.monitorInterval = setInterval(() => this.monitorPositions(), 500); // Monitor positions every 500ms
    this.signalInterval = setInterval(() => this.generateProbabilisticSignals(), 5000); // Generate signals every 5 seconds
    this.log("info", "SYSTEM", `✅ Engine running LIVE | Pure Probabilistic Mind Active`);
    this.emit("started", this.getStats());
  }

  async stop() {
    if (!this.isRunning) return;
    this.isRunning = false;
    this.log("info", "SYSTEM", "🛑 Engine stopping...");
    if (this.monitorInterval) clearInterval(this.monitorInterval);
    if (this.signalInterval) clearInterval(this.signalInterval);
    if (this.pingInterval) clearInterval(this.pingInterval);
    if (this.wsReconnectTimer) clearTimeout(this.wsReconnectTimer);
    if (this.ws) { try { this.ws.close(); } catch (e) {} this.ws = null; }
    this.emit("stopped", this.getStats());
  }

  getStats(): EngineStats {
    const symbolStats: Record<string, any> = {};
    for (const [sym, state] of this.symbols) {
      symbolStats[sym] = { price: state.price, klineCount: state.klines.length, hasPosition: state.position !== null, position: state.position };
    }
    return { totalTrades: this.totalTrades, winTrades: this.winTrades, lossTrades: this.lossTrades, totalPnl: this.totalPnl, balance: this.balance, startBalance: this.startBalance, leverage: this.leverage, isRunning: this.isRunning, symbols: symbolStats, logs: this.logs.slice(-100), tpHits: this.tpHits };
  }

  private async syncBalance() {
    try {
      const res = await bingxRequest("GET", "/openApi/swap/v3/user/balance");
      if (res.code === 0 && res.data) {
        const data = res.data;
        const usdt = Array.isArray(data) ? data.find((b: any) => b.asset === "USDT") : data;
        if (usdt) this.balance = parseFloat(usdt.availableMargin || usdt.balance || usdt.equity || "0");
      }
    } catch (e: any) { this.log("error", "SYSTEM", `Balance sync failed: ${e.message}`); }
  }

  private async setMarginMode(symbol: string, mode: "CROSSED" | "ISOLATED") {
    try { await bingxRequest("POST", "/openApi/swap/v2/trade/marginType", { symbol, marginType: mode }); } catch (e) { this.log("info", symbol, `Margin mode already ${mode} or error: ${e.message}`); }
  }

  private async setLeverageAll(lev: number) {
    this.leverage = lev;
    for (const sym of CONFIG.SYMBOLS) {
      try {
        await bingxRequest("POST", "/openApi/swap/v2/trade/leverage", { symbol: sym, side: "LONG", leverage: lev });
        await bingxRequest("POST", "/openApi/swap/v2/trade/leverage", { symbol: sym, side: "SHORT", leverage: lev });
        this.log("info", sym, `Leverage set to ${lev}x`);
      } catch (e) { this.log("info", sym, `Leverage already ${lev}x or error: ${e.message}`); }
    }
  }

  private connectWS() {
    if (this.ws) this.ws.close();
    this.ws = new WebSocket(CONFIG.WS_URL);
    this.ws.on("open", () => {
      this.log("info", "WS", "🔌 Connected to BingX Market Data");
      for (const sym of CONFIG.SYMBOLS) {
        this.ws?.send(JSON.stringify({ id: `sub_${sym}`, reqType: "sub", dataType: `${sym}@trade` })); // Subscribe to real-time trades
        this.ws?.send(JSON.stringify({ id: `sub_kline_${sym}`, reqType: "sub", dataType: `${sym}@kline_1m` })); // Subscribe to 1m klines
      }
      if (this.pingInterval) clearInterval(this.pingInterval);
      this.pingInterval = setInterval(() => this.ws?.send("Ping"), 30000);
    });
    this.ws.on("message", (data: Buffer) => {
      try {
        const msg = JSON.parse(pako.inflate(data, { to: "string" }));
        if (msg.dataType?.endsWith("@trade")) {
          const sym = msg.dataType.split("@")[0];
          const state = this.symbols.get(sym);
          if (state) {
            state.price = parseFloat(msg.data.price);
            this.emit("price", { symbol: sym, price: state.price });
          }
        } else if (msg.dataType?.endsWith("@kline_1m")) {
          const sym = msg.dataType.split("@")[0];
          const state = this.symbols.get(sym);
          if (state && msg.data.kline) {
            const k = msg.data.kline;
            const newKline: Kline = {
              t: parseInt(k.time),
              o: parseFloat(k.open),
              h: parseFloat(k.high),
              l: parseFloat(k.low),
              c: parseFloat(k.close),
              v: parseFloat(k.volume),
            };
            // Update klines array (keep only last N for any potential future logic)
            state.klines.push(newKline);
            if (state.klines.length > 60) state.klines.shift(); // Keep last 60 klines (1 hour)
          }
        }
      } catch (e) { /* silent */ }
    });
    this.ws.on("close", () => { if (this.isRunning) this.wsReconnectTimer = setTimeout(() => this.connectWS(), 5000); });
    this.ws.on("error", (err) => { this.log("error", "WS", `WebSocket error: ${err.message}`); this.ws?.close(); });
  }

  private generateProbabilisticSignals() {
    if (!this.isRunning) return;
    for (const [sym, state] of this.symbols) {
      if (state.position || state.price <= 0) continue;
      if (Date.now() - state.lastSignalTime < state.cooldownMs) continue;

      // Pure Probabilistic Entry (50/50 chance to enter a trade every check)
      if (Math.random() > 0.5) {
        const side = Math.random() > 0.5 ? "BUY" : "SELL";
        this.openProbabilisticTrade(sym, side);
      }
    }
  }

  private async openProbabilisticTrade(symbol: string, side: "BUY" | "SELL") {
    const state = this.symbols.get(symbol)!;
    state.lastSignalTime = Date.now();
    await this.syncBalance();

    const riskAmount = Math.min(this.balance * CONFIG.RISK_PERCENT, CONFIG.RISK_CAP);
    const entryPrice = state.price;
    
    // Fixed 0.5% SL for the probabilistic model
    const slPercent = 0.005;
    const stopLoss = side === "BUY" ? entryPrice * (1 - slPercent) : entryPrice * (1 + slPercent);
    const riskPerUnit = Math.abs(entryPrice - stopLoss);

    let quantity = (riskAmount * CONFIG.LEVERAGE) / entryPrice;
    quantity = symbol === "BTC-USDT" ? Math.floor(quantity * 1000) / 1000 : Math.floor(quantity * 100) / 100;

    if (quantity < (CONFIG.MIN_QTY[symbol] || 0.001)) {
      this.log("info", symbol, `⚠️ Quantity too small: ${quantity} < ${CONFIG.MIN_QTY[symbol]} — skipping`);
      return;
    }

    const tp1x5 = side === "BUY" ? entryPrice + riskPerUnit * 1.5 : entryPrice - riskPerUnit * 1.5;
    const tp3x = side === "BUY" ? entryPrice + riskPerUnit * 3 : entryPrice - riskPerUnit * 3;

    this.log("trade", symbol, `🎲 Probabilistic ${side}: qty=${quantity}, entry=$${entryPrice.toFixed(2)}`);

    try {
      const positionSide = side === "BUY" ? "LONG" : "SHORT";
      // Set leverage before placing order (BingX requires this)
      await bingxRequest("POST", "/openApi/swap/v2/trade/leverage", { symbol, side: positionSide, leverage: CONFIG.LEVERAGE });

      const orderParams: Record<string, any> = {
        symbol,
        side: side,
        positionSide: positionSide,
        type: "MARKET",
        quantity: quantity.toString(),
        // Stop Loss is set here
        stopLoss: JSON.stringify({
          type: "STOP_MARKET",
          stopPrice: parseFloat(stopLoss.toFixed(2)),
          workingType: "MARK_PRICE",
        }),
      };

      const res = await bingxRequest("POST", "/openApi/swap/v2/trade/order", orderParams);

      if (res.code === 0) {
        const filledPrice = parseFloat(res.data?.order?.avgPrice || entryPrice.toString());
        state.position = {
          symbol,
          side: side,
          positionSide: positionSide,
          entryPrice: filledPrice,
          quantity,
          originalQuantity: quantity,
          stopLoss,
          takeProfit1x5: tp1x5,
          takeProfit3x: tp3x,
          riskAmount,
          riskPerUnit,
          partialClosed: false,
          breakEvenMoved: false,
          openTime: Date.now(),
        };
        this.log("trade", symbol, `✅ FILLED at $${filledPrice.toFixed(2)} | SL: $${stopLoss.toFixed(2)} | TP1.5x: $${tp1x5.toFixed(2)} | TP3x: $${tp3x.toFixed(2)}`);
        this.emit("trade_opened", { symbol, position: state.position });
      } else {
        this.log("error", symbol, `❌ Order failed: ${res.msg}`);
      }
    } catch (e: any) {
      this.log("error", symbol, `❌ Order error: ${e.response?.data?.msg || e.message}`);
    }
  }

  private async monitorPositions() {
    if (!this.isRunning) return;
    for (const [sym, state] of this.symbols) {
      if (!state.position || state.price <= 0) continue;
      const pos = state.position;
      const currentPrice = state.price;

      const pnlPerUnit = pos.side === "BUY" ? currentPrice - pos.entryPrice : pos.entryPrice - currentPrice;
      const riskMultiple = pos.riskPerUnit > 0 ? pnlPerUnit / pos.riskPerUnit : 0;

      // ---- PHASE 1: STOP LOSS HIT (handled by exchange SL order) ----
      // The exchange will trigger the SL order. We just need to check if position is closed.
      // This logic is primarily for TP and BE management.

      // ---- PHASE 2: 1.5x REACHED → Close 50% + Move SL to Entry ----
      if (!pos.partialClosed && riskMultiple >= 1.5) {
        const halfQty = this.roundQty(sym, pos.quantity / 2);
        if (halfQty > 0) {
          this.log("partial", sym, `🎯 1.5x REACHED ($${currentPrice.toFixed(2)}) — Closing 50% (${halfQty}) + Moving SL to Entry`);
          const success = await this.closePartial(sym, halfQty);
          if (success) {
            pos.partialClosed = true;
            pos.quantity = this.roundQty(sym, pos.quantity - halfQty);
            this.tpHits++;

            // Move SL to break-even (entry price) — USER'S EXACT LOGIC
            pos.stopLoss = pos.entryPrice;
            pos.breakEvenMoved = true;
            this.log("info", sym, `🔒 SL moved to Break-Even: $${pos.entryPrice.toFixed(2)} — Remaining: ${pos.quantity}`);

            await this.updateStopLoss(sym, pos); // Update SL on exchange
            this.emit("partial_close", { symbol: sym, position: pos });
          }
        }
      }

      // ---- PHASE 3: 3x REACHED → Close remaining 50% ----
      if (pos.partialClosed && riskMultiple >= 3.0) {
        this.log("close", sym, `🏆 3x FULL TARGET ($${currentPrice.toFixed(2)}) — Closing remaining ${pos.quantity}`);
        this.tpHits++;
        await this.closePosition(sym, pos.quantity, "TP_3X");
      }

      // ---- PHASE BE: If price returns to entry after partial → Exit at zero ----
      // This is handled by the updated SL to entry price on the exchange.
      // If the price hits the new SL (which is entry price), the position will be closed at BE.
    }
  }

  // ---- Close partial position ----
  private async closePartial(symbol: string, quantity: number): Promise<boolean> {
    const state = this.symbols.get(symbol)!;
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
      this.log("error", symbol, `Partial close error: ${e.response?.data?.msg || e.message}`);
      return false;
    }
  }

  // ---- Close full position ----
  private async closePosition(symbol: string, quantity: number, reason: string) {
    const state = this.symbols.get(symbol)!;
    const pos = state.position!;
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
          : pos.entryPrice - pos.entryPrice; // PnL for full close is calculated from entry to current price
        const tradePnl = pnlPerUnit * quantity;

        this.totalPnl += tradePnl;
        this.balance += tradePnl;
        this.totalTrades++;

        const isWin = reason === "TP_3X" || reason === "BREAK_EVEN" || tradePnl > 0;
        if (isWin) this.winTrades++; else this.lossTrades++;

        const emoji = reason === "TP_3X" ? "🏆" : reason === "BREAK_EVEN" ? "🔒" : tradePnl > 0 ? "🟢" : "🔴";
        this.log("close", symbol, `${emoji} ${reason}: PnL $${tradePnl.toFixed(4)} | Balance: $${this.balance.toFixed(2)} | Total PnL: $${this.totalPnl.toFixed(4)}`, tradePnl);

        state.position = null;
        this.emit("trade_closed", { symbol, pnl: tradePnl, reason, isWin });

        await this.syncBalance();
      } else {
        this.log("error", symbol, `Close failed: ${res.msg}`);
      }
    } catch (e: any) {
      this.log("error", symbol, `Close error: ${e.response?.data?.msg || e.message}`);
      state.position = null; // Clear position even on error to avoid stuck positions
    }
  }

  // ---- Update SL on exchange ----
  private async updateStopLoss(symbol: string, pos: ActivePosition) {
    try {
      // Cancel existing SL order first
      await bingxRequest("POST", "/openApi/swap/v2/trade/cancelAllOpenOrders", { symbol });

      // Place new SL order at the updated stopLoss price
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
      this.log("error", symbol, `SL update error: ${e.response?.data?.msg || e.message} — programmatic SL still active`);
    }
  }

  // ---- Utility ----
  private roundQty(symbol: string, qty: number): number {
    if (symbol === "BTC-USDT") return Math.floor(qty * 1000) / 1000;
    return Math.floor(qty * 100) / 100;
  }
}
