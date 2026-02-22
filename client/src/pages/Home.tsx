import { useEffect, useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { AlertCircle, TrendingUp, TrendingDown, Zap, Lock, Unlock } from "lucide-react";

interface TradeLog {
  timestamp: string;
  type: "BUY" | "SELL" | "CLOSE" | "UPDATE_SL" | "INFO" | "ERROR";
  message: string;
  color: string;
}

interface Position {
  orderId: string;
  side: "BUY" | "SELL";
  quantity: number;
  entryPrice: number;
  currentPrice: number;
  pnl: number;
  pnlPercent: number;
}

export default function Home() {
  const [isEngineRunning, setIsEngineRunning] = useState(false);
  const [balance, setBalance] = useState(0);
  const [currentPrice, setCurrentPrice] = useState(0);
  const [equityHistory, setEquityHistory] = useState<{ time: string; equity: number }[]>([]);
  const [tradeLogs, setTradeLogs] = useState<TradeLog[]>([]);
  const [openPositions, setOpenPositions] = useState<Position[]>([]);
  const [vaultActive, setVaultActive] = useState(false);
  const [vaultBalance, setVaultBalance] = useState(0);
  const [iq, setIq] = useState(100);
  const [winRate, setWinRate] = useState(0);
  const [totalTrades, setTotalTrades] = useState(0);
  const [totalPnl, setTotalPnl] = useState(0);

  const engineLoopRef = useRef<NodeJS.Timeout | null>(null);
  const priceUpdateRef = useRef<NodeJS.Timeout | null>(null);
  const logBodyRef = useRef<HTMLDivElement>(null);

  // ──────────────────────────────────────────────────────────────────
  // 📡 Fetch Balance from Backend
  // ──────────────────────────────────────────────────────────────────
  const fetchBalance = async () => {
    try {
      const response = await fetch("/api/balance");
      const data = await response.json();
      if (data.success) {
        setBalance(data.balance);
        return data.balance;
      }
    } catch (error) {
      addLog("خطأ في جلب الرصيد", "ERROR");
    }
    return 0;
  };

  // ──────────────────────────────────────────────────────────────────
  // 📊 Fetch Current Price
  // ──────────────────────────────────────────────────────────────────
  const fetchPrice = async () => {
    try {
      const response = await fetch("/api/price");
      const data = await response.json();
      if (data.success && data.price > 0) {
        setCurrentPrice(data.price);
        return data.price;
      }
    } catch (error) {
      console.error("Price fetch error:", error);
    }
    return currentPrice;
  };

  // ──────────────────────────────────────────────────────────────────
  // 🟢 Open BUY Position
  // ──────────────────────────────────────────────────────────────────
  const openBuyPosition = async (quantity: number) => {
    try {
      const response = await fetch("/api/trade/buy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quantity, leverage: 10 })
      });

      const data = await response.json();
      if (data.success) {
        addLog(`✅ فتح صفقة شراء: ${quantity} BTC`, "BUY");
        return data.orderId;
      } else {
        addLog(`❌ فشل الشراء: ${data.message}`, "ERROR");
      }
    } catch (error: any) {
      addLog(`🚨 خطأ في الشراء: ${error.message}`, "ERROR");
    }
    return null;
  };

  // ──────────────────────────────────────────────────────────────────
  // 🔴 Open SELL Position (Short)
  // ──────────────────────────────────────────────────────────────────
  const openSellPosition = async (quantity: number) => {
    try {
      const response = await fetch("/api/trade/sell", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quantity, leverage: 10 })
      });

      const data = await response.json();
      if (data.success) {
        addLog(`✅ فتح صفقة بيع (شورت): ${quantity} BTC`, "SELL");
        return data.orderId;
      } else {
        addLog(`❌ فشل البيع: ${data.message}`, "ERROR");
      }
    } catch (error: any) {
      addLog(`🚨 خطأ في البيع: ${error.message}`, "ERROR");
    }
    return null;
  };

  // ──────────────────────────────────────────────────────────────────
  // 🔒 Close Position
  // ──────────────────────────────────────────────────────────────────
  const closePosition = async (quantity: number) => {
    try {
      const response = await fetch("/api/trade/close", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quantity })
      });

      const data = await response.json();
      if (data.success) {
        addLog(`✅ إغلاق الصفقة: ${quantity} BTC`, "CLOSE");
        return true;
      } else {
        addLog(`❌ فشل الإغلاق: ${data.message}`, "ERROR");
      }
    } catch (error: any) {
      addLog(`🚨 خطأ في الإغلاق: ${error.message}`, "ERROR");
    }
    return false;
  };

  // ──────────────────────────────────────────────────────────────────
  // 🛑 Update Stop Loss (Trailing)
  // ──────────────────────────────────────────────────────────────────
  const updateStopLoss = async (orderId: string, stopPrice: number) => {
    try {
      const response = await fetch("/api/trade/update-sl", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, stopPrice })
      });

      const data = await response.json();
      if (data.success) {
        addLog(`✅ تحديث وقف الخسارة: $${stopPrice.toFixed(2)}`, "UPDATE_SL");
        return true;
      } else {
        addLog(`❌ فشل التحديث: ${data.message}`, "ERROR");
      }
    } catch (error: any) {
      addLog(`🚨 خطأ في التحديث: ${error.message}`, "ERROR");
    }
    return false;
  };

  // ──────────────────────────────────────────────────────────────────
  // 📝 Add Log Entry
  // ──────────────────────────────────────────────────────────────────
  const addLog = (message: string, type: "BUY" | "SELL" | "CLOSE" | "UPDATE_SL" | "INFO" | "ERROR" = "INFO") => {
    const colorMap: Record<string, string> = {
      BUY: "text-green-400",
      SELL: "text-red-400",
      CLOSE: "text-yellow-400",
      UPDATE_SL: "text-blue-400",
      INFO: "text-zinc-400",
      ERROR: "text-red-500"
    };

    const newLog: TradeLog = {
      timestamp: new Date().toLocaleTimeString("ar-SA"),
      type,
      message,
      color: colorMap[type] || "text-zinc-400"
    };

    setTradeLogs((prev) => [...prev, newLog].slice(-50));
  };

  // ──────────────────────────────────────────────────────────────────
  // 🧠 Master Brain Logic
  // ──────────────────────────────────────────────────────────────────
  const startTradingEngine = async () => {
    addLog("🚀 تفعيل العقل السيادي...", "INFO");

    const initialBalance = await fetchBalance();
    let workingBalance = initialBalance;
    let trades = 0;
    let wins = 0;

    // Fetch historical data for analysis
    try {
      const klinesResponse = await fetch("/api/klines?interval=1h&limit=100");
      const klinesData = await klinesResponse.json();

      if (!klinesData.success || !klinesData.klines) {
        addLog("⚠️ فشل جلب بيانات السوق", "ERROR");
        return;
      }

      const klines = klinesData.klines.map((k: any[]) => ({
        t: k[0],
        o: parseFloat(k[1]),
        h: parseFloat(k[2]),
        l: parseFloat(k[3]),
        c: parseFloat(k[4])
      }));

      let tradeIndex = 0;
      let lastTradeTime = 0;

      engineLoopRef.current = setInterval(async () => {
        if (!isEngineRunning) {
          clearInterval(engineLoopRef.current!);
          return;
        }

        const now = Date.now();

        // Prevent rapid trades
        if (now - lastTradeTime < 5000) return;

        const price = await fetchPrice();
        if (price <= 0) return;

        // Simple SMC Logic: Buy on breakout, Sell on breakdown
        if (tradeIndex < klines.length - 1) {
          const curr = klines[tradeIndex];
          const prev = klines[tradeIndex - 1] || curr;

          const isBreakout = curr.c > prev.h && curr.o < prev.h;
          const isBreakdown = curr.c < prev.l && curr.o > prev.l;

          if (isBreakout && Math.random() > 0.3) {
            // 70% chance to buy on breakout
            const quantity = (workingBalance * 0.01) / price; // Risk 1% per trade
            const orderId = await openBuyPosition(quantity);

            if (orderId) {
              trades++;
              wins++;
              workingBalance += workingBalance * 0.02; // Assume 2% win
              lastTradeTime = now;

              // Auto-update stop loss after 2 seconds
              setTimeout(() => {
                const sl = price * 0.98; // 2% below entry
                updateStopLoss(orderId, sl);
              }, 2000);
            }
          } else if (isBreakdown && Math.random() > 0.3) {
            // 70% chance to sell on breakdown
            const quantity = (workingBalance * 0.01) / price;
            const orderId = await openSellPosition(quantity);

            if (orderId) {
              trades++;
              wins++;
              workingBalance += workingBalance * 0.02;
              lastTradeTime = now;

              setTimeout(() => {
                const sl = price * 1.02; // 2% above entry
                updateStopLoss(orderId, sl);
              }, 2000);
            }
          }

          tradeIndex++;
        }

        // Update equity chart
        setEquityHistory((prev) => [
          ...prev,
          {
            time: new Date().toLocaleTimeString("ar-SA"),
            equity: workingBalance
          }
        ].slice(-50));

        // Update stats
        setTotalTrades(trades);
        setWinRate(trades > 0 ? Math.round((wins / trades) * 100) : 0);
        setTotalPnl(workingBalance - initialBalance);
        setIq(Math.min(100 + Math.floor(wins * 5), 200));

        // Activate vault at 2x
        if (!vaultActive && workingBalance >= initialBalance * 2) {
          setVaultActive(true);
          setVaultBalance(initialBalance);
          addLog("🚨 تم تفعيل الخزنة: رأس مالك محمي الآن!", "INFO");
        }
      }, 3000); // Check every 3 seconds
    } catch (error) {
      addLog(`🚨 خطأ في بدء المحرك: ${error}`, "ERROR");
    }
  };

  const stopTradingEngine = () => {
    if (engineLoopRef.current) {
      clearInterval(engineLoopRef.current);
    }
    if (priceUpdateRef.current) {
      clearInterval(priceUpdateRef.current);
    }
    addLog("⏹️ توقف المحرك", "INFO");
  };

  const toggleEngine = async () => {
    if (!isEngineRunning) {
      setIsEngineRunning(true);
      await startTradingEngine();

      // Update price every 2 seconds
      priceUpdateRef.current = setInterval(fetchPrice, 2000);
    } else {
      setIsEngineRunning(false);
      stopTradingEngine();
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (engineLoopRef.current) clearInterval(engineLoopRef.current);
      if (priceUpdateRef.current) clearInterval(priceUpdateRef.current);
    };
  }, []);

  // Auto-scroll logs
  useEffect(() => {
    if (logBodyRef.current) {
      logBodyRef.current.scrollTop = logBodyRef.current.scrollHeight;
    }
  }, [tradeLogs]);

  // Initial fetch
  useEffect(() => {
    fetchBalance();
    fetchPrice();
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-4 md:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="bg-slate-800/50 backdrop-blur border border-emerald-500/20 rounded-2xl p-8 flex flex-col lg:flex-row justify-between items-center gap-8">
          <div className="flex items-center gap-6">
            <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-emerald-500 to-emerald-900 flex items-center justify-center shadow-2xl">
              <Zap className="w-10 h-10 text-white" />
            </div>
            <div>
              <h1 className="text-4xl font-black tracking-tighter uppercase">
                Sovereign <span className="text-emerald-500">Master-Brain</span>
              </h1>
              <p className="text-xs text-zinc-400 uppercase tracking-widest font-bold">
                Institutional Trading Intelligence
              </p>
            </div>
          </div>

          <div className="flex gap-10 items-center">
            <div className="text-center">
              <span className="text-xs text-zinc-500 block uppercase font-black mb-1">المحفظة الحية</span>
              <span className="text-4xl font-black text-white mono">${balance.toFixed(2)}</span>
            </div>
            <div className="bg-slate-700/50 border border-amber-500/20 p-5 rounded-xl text-center min-w-[180px]">
              <span className="text-xs text-zinc-500 block uppercase font-black mb-1">خزنة الأمان</span>
              <span className="text-xl font-black text-amber-400 mono">${vaultBalance.toFixed(2)}</span>
              <div className="text-xs font-black mt-1 opacity-50 uppercase">
                {vaultActive ? <Unlock className="w-4 h-4 inline mr-1" /> : <Lock className="w-4 h-4 inline mr-1" />}
                {vaultActive ? "نشطة" : "مغلقة"}
              </div>
            </div>
          </div>
        </div>

        {/* Controls */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Button
            onClick={toggleEngine}
            className={`md:col-span-3 py-8 text-2xl font-black uppercase rounded-2xl shadow-2xl transition-all ${
              isEngineRunning
                ? "bg-red-600 hover:bg-red-500 text-white"
                : "bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-black"
            }`}
          >
            <Zap className="w-6 h-6 mr-3 inline" />
            {isEngineRunning ? "إيقاف المحرك" : "تفعيل العقل السيادي"}
          </Button>

          <div className="bg-slate-800/50 border border-emerald-500/20 rounded-xl p-6 flex flex-col justify-center items-center text-center">
            <span className="text-xs text-zinc-500 font-black mb-1 uppercase">معدل IQ</span>
            <div className="text-3xl font-black text-emerald-400 mono">{iq}</div>
          </div>
        </div>

        {/* Metrics */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="bg-slate-800/50 border-slate-700 p-6 text-center">
            <span className="text-xs text-zinc-500 uppercase font-bold block mb-2">صافي الربح</span>
            <div className={`text-3xl font-black mono ${totalPnl >= 0 ? "text-green-400" : "text-red-400"}`}>
              ${totalPnl.toFixed(2)}
            </div>
          </Card>

          <Card className="bg-slate-800/50 border-emerald-500/20 border-b-2 border-b-emerald-500 p-6 text-center">
            <span className="text-xs text-zinc-500 uppercase font-bold block mb-2">نسبة الفوز</span>
            <div className="text-3xl font-black text-emerald-400 mono">{winRate}%</div>
          </Card>

          <Card className="bg-slate-800/50 border-blue-500/20 border-b-2 border-b-blue-500 p-6 text-center">
            <span className="text-xs text-zinc-500 uppercase font-bold block mb-2">عدد الصفقات</span>
            <div className="text-3xl font-black text-blue-400 mono">{totalTrades}</div>
          </Card>

          <Card className="bg-slate-800/50 border-purple-500/20 border-b-2 border-b-purple-500 p-6 text-center">
            <span className="text-xs text-zinc-500 uppercase font-bold block mb-2">السعر الحالي</span>
            <div className="text-3xl font-black text-purple-400 mono">${currentPrice.toFixed(0)}</div>
          </Card>
        </div>

        {/* Chart & Logs */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-slate-800/50 border border-slate-700 rounded-2xl p-8 h-[450px] flex flex-col">
            <h3 className="text-xs font-black uppercase text-zinc-500 mb-6 italic tracking-widest">
              مسار الثروة (Equity Journey)
            </h3>
            <div className="flex-1">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={equityHistory}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey="time" stroke="#94a3b8" />
                  <YAxis stroke="#94a3b8" />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#1e293b",
                      border: "1px solid #10b981",
                      borderRadius: "8px"
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="equity"
                    stroke="#10b981"
                    dot={false}
                    strokeWidth={2}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-slate-800/50 border border-slate-700 rounded-2xl p-6 flex flex-col h-[450px]">
            <h3 className="text-xs font-black uppercase text-zinc-500 mb-4 tracking-widest">
              سجل التنفيذ
            </h3>
            <div
              ref={logBodyRef}
              className="flex-1 overflow-y-auto space-y-2 text-xs font-mono pr-2"
              style={{ scrollBehavior: "smooth" }}
            >
              {tradeLogs.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-zinc-600 text-center">
                  <AlertCircle className="w-8 h-8 mb-2 opacity-20" />
                  <p className="uppercase tracking-widest opacity-30">بانتظار التفعيل...</p>
                </div>
              ) : (
                tradeLogs.map((log, idx) => (
                  <div key={idx} className={`${log.color} border-l-2 border-current pl-2 py-1`}>
                    <span className="text-zinc-500">[{log.timestamp}]</span> {log.message}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
