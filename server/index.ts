// ============================================================================
// 🚀 SOVEREIGN MASTER-BRAIN v2.0 — Structural Intelligence Server
// Dual-Core (BTC + ETH) | 24/7 Autonomous | Liquidity Reader
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
// 🧠 Initialize Trading Engine (runs 24/7 server-side)
// ============================================================================

const engine = new TradingEngine();

// ============================================================================
// 📊 Express + WebSocket Server
// ============================================================================

async function startServer() {
  const app = express();
  app.use(express.json());

  const server = createServer(app);
  const wss = new WebSocketServer({ server });

  // ---- Bridge engine events to browser WebSocket clients ----
  engine.onEvent((event, data) => {
    const message = JSON.stringify({ event, data });
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  });

  // ---- WebSocket client connection ----
  wss.on("connection", (clientWs) => {
    // Send current state immediately
    const stats = engine.getStats();
    clientWs.send(JSON.stringify({ event: "stats", data: stats }));

    // Send current prices
    for (const sym of ["BTC-USDT", "ETH-USDT"]) {
      const price = engine.getPrice(sym);
      if (price > 0) {
        clientWs.send(JSON.stringify({ event: "price", data: { symbol: sym, price } }));
      }
    }
  });

  // ============================================================================
  // 📡 REST API Routes
  // ============================================================================

  // ---- Health Check ----
  app.get("/api/health", (_req, res) => {
    const stats = engine.getStats();
    res.json({
      success: true,
      status: stats.isRunning ? "running" : "stopped",
      symbols: Object.keys(stats.symbols),
      prices: Object.fromEntries(
        Object.entries(stats.symbols).map(([k, v]) => [k, v.price])
      ),
    });
  });

  // ---- Get Full Engine Stats ----
  app.get("/api/stats", (_req, res) => {
    res.json({ success: true, data: engine.getStats() });
  });

  // ---- Get Balance ----
  app.get("/api/balance", (_req, res) => {
    const stats = engine.getStats();
    res.json({ success: true, balance: stats.balance });
  });

  // ---- Get Prices ----
  app.get("/api/prices", (_req, res) => {
    const stats = engine.getStats();
    res.json({
      success: true,
      prices: Object.fromEntries(
        Object.entries(stats.symbols).map(([k, v]) => [k, v.price])
      ),
    });
  });

  // ---- Get Klines for a symbol ----
  app.get("/api/klines/:symbol", (req, res) => {
    const symbol = req.params.symbol;
    const klines = engine.getKlines(symbol);
    res.json({ success: true, klines });
  });

  // ---- Get Positions ----
  app.get("/api/positions", (_req, res) => {
    const stats = engine.getStats();
    const positions: any[] = [];
    for (const [sym, data] of Object.entries(stats.symbols)) {
      if (data.position) {
        positions.push({ symbol: sym, ...data.position });
      }
    }
    res.json({ success: true, positions });
  });

  // ---- Get Logs ----
  app.get("/api/logs", (_req, res) => {
    const stats = engine.getStats();
    res.json({ success: true, logs: stats.logs });
  });

  // ---- Start Engine ----
  app.post("/api/engine/start", async (_req, res) => {
    try {
      await engine.start();
      res.json({ success: true, message: "Engine started" });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // ---- Stop Engine ----
  app.post("/api/engine/stop", async (_req, res) => {
    try {
      await engine.stop();
      res.json({ success: true, message: "Engine stopped" });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // ---- Serve Static Files ----
  const staticPath = path.resolve(process.cwd(), "client");
  app.use(express.static(staticPath));
  app.get("*", (_req, res) => res.sendFile(path.join(staticPath, "index.html")));

  // ---- Start Server ----
  const port = process.env.PORT || 3000;
  server.listen(port, () => {
    console.log(`🚀 Sovereign Master-Brain v2.0 running on port ${port}`);
    console.log(`🧠 Structural Intelligence Engine — Dual Core (BTC + ETH)`);
    console.log(`📡 WebSocket bridge active for browser clients`);
  });

  // ---- Auto-start engine on server boot (24/7 autonomous) ----
  try {
    await engine.start();
    console.log("✅ Engine auto-started successfully");
  } catch (e: any) {
    console.error("⚠️ Engine auto-start failed:", e.message);
    console.log("Engine can be started manually via POST /api/engine/start");
  }

  // ---- Graceful shutdown ----
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
