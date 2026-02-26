// ============================================================================
// SOVEREIGN X v38 FINAL — Multi-Mind + Coin Personality Engine
// 6 Minds | 6 Coins | WebSocket Real-Time | Binance Futures
// ============================================================================

import express from "express";
import { createServer } from "http";
import path from "path";
import { fileURLToPath } from "url";
import { WebSocketServer, WebSocket } from "ws";
import { TradingEngine } from "./src/services/tradingEngine.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================================
// API Keys Configuration (Binance Futures)
// ============================================================================

const API_KEY = process.env.BINANCE_API_KEY || "rKApgjXcm5xYfFAotrHRe0GpX4KjAjOVJ09efnYiat3pBZhxF0tAkRqBXravWziU";
const API_SECRET = process.env.BINANCE_API_SECRET || "npHj0kZuuQHsStFkRFQ4PFnVfxG6EcfekkqgbgSxlqSowQAvcel8lrGHo0lhvlvT";

console.log("🔐 Binance Futures API Configuration:");
console.log(`   API Key: ${API_KEY.substring(0, 20)}...`);
console.log(`   Exchange: Binance Futures (Live Trading)`);
console.log(`   IP Whitelist: 34.212.75.30`);

// ============================================================================
// Initialize Trading Engine
// ============================================================================

const engine = new TradingEngine(API_KEY, API_SECRET);

engine.start().catch((error: any) => {
  console.error("❌ Failed to start trading engine:", error);
  process.exit(1);
});

// ============================================================================
// Express + WebSocket Server
// ============================================================================

async function startServer() {
  const app = express();
  app.use(express.json());

  const server = createServer(app);
  const wss = new WebSocketServer({ server });

  // Bridge engine events to browser WebSocket clients
  engine.on('log', (logMessage) => {
    const message = JSON.stringify({ event: 'log', data: logMessage });
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  });

  wss.on("connection", (clientWs) => {
    const stats = engine.getStats();
    clientWs.send(JSON.stringify({ event: "stats", data: stats }));

    for (const sym of ["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT", "ADAUSDT"]) {
      const price = engine.getPrice(sym);
      if (price > 0) {
        clientWs.send(JSON.stringify({ event: "price", data: { symbol: sym, price } }));
      }
    }
  });

  // ============================================================================
  // REST API Routes
  // ============================================================================

  app.get("/api/health", (_req, res) => {
    const stats = engine.getStats();
    res.json({
      success: true,
      status: stats.isRunning ? "running" : "stopped",
      version: "v38 FINAL — Multi-Mind + Coin Personality",
      network: "LIVE",
      balance: `$${stats.balance.toFixed(2)} USD`,
      symbols: Object.keys(stats.symbols),
      prices: Object.fromEntries(
        Object.entries(stats.symbols).map(([k, v]: [string, any]) => [k, v.price])
      ),
    });
  });

  app.get("/api/stats", (_req, res) => {
    res.json({ success: true, data: engine.getStats() });
  });

  app.get("/api/balance", (_req, res) => {
    const stats = engine.getStats();
    res.json({ success: true, balance: stats.balance });
  });

  app.get("/api/prices", (_req, res) => {
    const stats = engine.getStats();
    res.json({
      success: true,
      prices: Object.fromEntries(
        Object.entries(stats.symbols).map(([k, v]: [string, any]) => [k, v.price])
      ),
    });
  });

  app.get("/api/klines/:symbol", (req, res) => {
    const symbol = req.params.symbol;
    const klines = engine.getKlines(symbol);
    res.json({ success: true, klines });
  });

  app.get("/api/positions", (_req, res) => {
    const stats = engine.getStats();
    const positions: any[] = [];
    for (const [, data] of Object.entries(stats.symbols)) {
      if ((data as any).positions) {
        positions.push(...(data as any).positions);
      }
    }
    res.json({ success: true, positions });
  });

  app.get("/api/logs", (_req, res) => {
    const stats = engine.getStats();
    res.json({ success: true, logs: stats.logs });
  });

  app.post("/api/engine/start", async (_req, res) => {
    try {
      await engine.start();
      res.json({ success: true, message: "Engine started" });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.post("/api/engine/stop", async (_req, res) => {
    try {
      await engine.stop();
      res.json({ success: true, message: "Engine stopped" });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // Serve Static Files
  const staticPath = path.resolve(process.cwd(), "client");
  app.use(express.static(staticPath));
  app.get("*", (_req, res) => res.sendFile(path.join(staticPath, "index.html")));

  // Start Server
  const port = process.env.PORT || 3000;
  server.listen(port, () => {
    console.log(`🚀 SOVEREIGN X v38 FINAL running on port ${port}`);
    console.log(`🧠 6 Minds: Momentum | Reversal | Range | Scalp Long | Scalp Short | Bear`);
    console.log(`💱 6 Coins: BTC | ETH | BNB | SOL | XRP | ADA`);
    console.log(`📡 WebSocket: Real-time millisecond price data`);
    console.log(`🎯 Target: $200+ weekly profit`);
  });

  // Graceful shutdown
  const shutdown = async () => {
    console.log("🛑 Shutting down gracefully...");
    await engine.stop();
    server.close(() => process.exit(0));
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  process.on("uncaughtException", (err) => {
    console.error("❌ Uncaught Exception:", err);
  });
  process.on("unhandledRejection", (reason) => {
    console.error("❌ Unhandled Rejection:", reason);
  });
}

startServer().catch(console.error);
