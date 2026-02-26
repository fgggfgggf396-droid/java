// ============================================================================
// 🧠 SOVEREIGN X — محاكاة شمعات 1 دقيقة (نسخة مُصلَّحة)
// ============================================================================

const RISK_PER_TRADE   = 0.05;
const STOP_LOSS_PCT    = 0.025;
const TP1_PCT  = 0.05;
const TP2_PCT  = 0.075;
const TP3_PCT  = 0.10;
const MIN_EMA_DIFF_PCT = 0.5;
const AGG_EMA_DIFF_PCT = 0.3;
const MAX_LEVERAGE = 10;
const BASE_LEVERAGE = 5;
const STARTING_BALANCE = 173;
const CANDLES = 300;

// أسعار البداية الحقيقية — 25 فبراير 2026
const SEEDS = {
  BTCUSDT: { price: 66088.1, vol: 0.0012, dec: 1 },
  ETHUSDT: { price: 1852.07, vol: 0.0014, dec: 2 },
  XRPUSDT: { price: 1.4336,  vol: 0.0015, dec: 4 },
  BNBUSDT: { price: 629.32,  vol: 0.0010, dec: 2 },
  SOLUSDT: { price: 79.02,   vol: 0.0016, dec: 3 },
  ADAUSDT: { price: 0.2743,  vol: 0.0017, dec: 5 },
};

// =================== مولّد بيانات واقعية مع موجات صعود/هبوط ===================
function generateCandles(seed) {
  const candles = [];
  let price = seed.price;
  let rng = 12345;

  function rand() {
    rng ^= rng << 13; rng ^= rng >> 17; rng ^= rng << 5;
    return ((rng >>> 0) / 0xFFFFFFFF);
  }
  function randn() {
    let u, v, s;
    do { u = rand() * 2 - 1; v = rand() * 2 - 1; s = u*u + v*v; } while (s >= 1);
    return u * Math.sqrt(-2 * Math.log(s) / s);
  }

  // سيناريو واقعي: 4 موجات متناوبة صعود/هبوط
  const waves = [
    { length: 60,  drift: +0.00025 },  // صعود ↗️
    { length: 80,  drift: -0.00030 },  // هبوط ↘️
    { length: 70,  drift: +0.00020 },  // صعود ↗️
    { length: 90,  drift: -0.00015 },  // هبوط خفيف ↘️
  ];

  let waveIdx = 0, wavePos = 0;

  for (let i = 0; i < CANDLES; i++) {
    if (wavePos >= waves[waveIdx].length) {
      waveIdx = (waveIdx + 1) % waves.length;
      wavePos = 0;
    }
    const drift = waves[waveIdx].drift;
    wavePos++;

    const ret   = drift + seed.vol * randn();
    const open  = price;
    const close = price * (1 + ret);
    const noise = seed.vol * Math.abs(randn()) * 0.5;
    const high  = Math.max(open, close) * (1 + noise);
    const low   = Math.min(open, close) * (1 - noise);
    const r = (n) => +n.toFixed(seed.dec);

    candles.push({ i, open: r(open), high: r(high), low: r(low), close: r(close) });
    price = close;
  }
  return candles;
}

// =================== المؤشرات (طبق الأصل من كود البوت) ===================
function ema(prices, period) {
  if (prices.length < period) return prices[prices.length - 1];
  const k = 2 / (period + 1);
  let e = prices.slice(-period).reduce((a, b) => a + b) / period;
  for (let i = prices.length - period; i < prices.length; i++)
    e = prices[i] * k + e * (1 - k);
  return e;
}

function rsi(prices, period = 14) {
  if (prices.length < period + 1) return 50;
  let g = 0, l = 0;
  for (let i = prices.length - period; i < prices.length; i++) {
    const d = prices[i] - prices[i - 1];
    if (d > 0) g += d; else l -= d;
  }
  const rs = (g / period) / ((l / period) || 0.001);
  return 100 - 100 / (1 + rs);
}

// =================== الإشارات (طبق الأصل) ===================
function signal(e12, e26, r) {
  const diff = Math.abs(e12 - e26);
  const pct  = (diff / e26) * 100;

  if (e12 > e26 && r > 50 && r < 80 && pct > MIN_EMA_DIFF_PCT)
    return { side:"long",  type:"Standard LONG",        conf: Math.min(100, 50+(r-50)+pct*10) };
  if (e12 < e26 && r < 50 && r > 20 && pct > MIN_EMA_DIFF_PCT)
    return { side:"short", type:"Standard SHORT",       conf: Math.min(100, 50+(50-r)+pct*10) };
  if (e12 > e26 && r > 45 && r < 75 && pct > AGG_EMA_DIFF_PCT)
    return { side:"long",  type:"Aggressive LONG",      conf: Math.min(100, 40+(r-45)+pct*8) };
  if (e12 < e26 && r < 55 && r > 25 && pct > AGG_EMA_DIFF_PCT)
    return { side:"short", type:"Aggressive SHORT",     conf: Math.min(100, 40+(55-r)+pct*8) };
  if (r < 35 && e12 > e26 * 0.99)
    return { side:"long",  type:"Oversold Bounce",      conf: Math.min(100, 35+(35-r)) };
  if (r > 65 && e12 < e26 * 1.01)
    return { side:"short", type:"Overbought Pullback",  conf: Math.min(100, 35+(r-65)) };
  return null;
}

// =================== المحاكاة الرئيسية ===================
function run() {
  console.log("═".repeat(72));
  console.log("  🧠 SOVEREIGN X — اختبار شمعات 1 دقيقة | 300 شمعة × 6 عملات");
  console.log("  📅 أسعار البداية: 25 فبراير 2026 | موجات صعود/هبوط متناوبة");
  console.log(`  💰 الرصيد: $${STARTING_BALANCE}`);
  console.log("═".repeat(72));

  let balance  = STARTING_BALANCE;
  const report = [];

  for (const [sym, seed] of Object.entries(SEEDS)) {
    const candles = generateCandles(seed);
    const closes  = candles.map(c => c.close);
    const trades  = [];
    let pos = null;

    for (let i = 27; i < candles.length; i++) {
      const c   = candles[i];
      const buf = closes.slice(0, i + 1);
      const e12 = ema(buf, 12);
      const e26 = ema(buf, 26);
      const r   = rsi(buf, 14);

      // ─── إدارة الصفقة المفتوحة ───
      if (pos) {
        const isLong = pos.side === "long";

        // وقف الخسارة
        const slHit = isLong ? c.low  <= pos.sl : c.high >= pos.sl;
        // TP1
        const tp1Hit = !pos.tp1Hit && (isLong ? c.high >= pos.tp1 : c.low <= pos.tp1);
        // TP2
        const tp2Hit = pos.tp1Hit && !pos.tp2Hit && (isLong ? c.high >= pos.tp2 : c.low <= pos.tp2);
        // TP3
        const tp3Hit = pos.tp1Hit && pos.tp2Hit && (isLong ? c.high >= pos.tp3 : c.low <= pos.tp3);

        if (slHit) {
          const pnl = isLong
            ? pos.qty * (pos.sl - pos.ep)
            : pos.qty * (pos.ep - pos.sl);
          balance += pos.pnlSoFar + pnl;
          trades.push({ ...pos, exitCandle:i, exitPrice:pos.sl, totalPnl:pos.pnlSoFar+pnl, reason:"❌ Stop Loss" });
          pos = null;
        } else if (tp1Hit) {
          const qty50 = pos.qty * 0.5;
          const pnl   = isLong ? qty50*(pos.tp1-pos.ep) : qty50*(pos.ep-pos.tp1);
          balance += pnl;
          pos.pnlSoFar += pnl;
          pos.qty      -= qty50;
          pos.sl        = pos.ep; // trailing stop → صفر خسارة
          pos.tp1Hit    = true;
        } else if (tp2Hit) {
          const qty30 = pos.qty * 0.6; // 30% من الكمية الأصلية
          const pnl   = isLong ? qty30*(pos.tp2-pos.ep) : qty30*(pos.ep-pos.tp2);
          balance += pnl;
          pos.pnlSoFar += pnl;
          pos.qty      -= qty30;
          pos.tp2Hit    = true;
        } else if (tp3Hit) {
          const pnl = isLong ? pos.qty*(pos.tp3-pos.ep) : pos.qty*(pos.ep-pos.tp3);
          balance += pnl;
          trades.push({ ...pos, exitCandle:i, exitPrice:pos.tp3, totalPnl:pos.pnlSoFar+pnl, reason:"🏆 TP3 كامل" });
          pos = null;
        }
      }

      // ─── بحث عن إشارة جديدة ───
      if (!pos && balance > 5) {
        const sig = signal(e12, e26, r);
        if (sig) {
          const lev  = BASE_LEVERAGE + (sig.conf/100)*(MAX_LEVERAGE-BASE_LEVERAGE);
          const risk = balance * RISK_PER_TRADE;
          const qty  = risk / c.close;
          const ep   = c.close;
          pos = {
            sym, side: sig.side, type: sig.type,
            conf: +sig.conf.toFixed(1), lev: +lev.toFixed(2),
            ep, qty, pnlSoFar: 0,
            sl:  sig.side==="long" ? ep*(1-STOP_LOSS_PCT) : ep*(1+STOP_LOSS_PCT),
            tp1: sig.side==="long" ? ep*(1+TP1_PCT) : ep*(1-TP1_PCT),
            tp2: sig.side==="long" ? ep*(1+TP2_PCT) : ep*(1-TP2_PCT),
            tp3: sig.side==="long" ? ep*(1+TP3_PCT) : ep*(1-TP3_PCT),
            tp1Hit:false, tp2Hit:false,
            entryCandle: i,
          };
        }
      }
    }

    // إغلاق صفقة مفتوحة في نهاية البيانات
    if (pos) {
      const last = closes[closes.length - 1];
      const pnl  = pos.side==="long"
        ? pos.qty*(last-pos.ep)
        : pos.qty*(pos.ep-last);
      balance += pnl;
      trades.push({ ...pos, exitCandle: CANDLES-1, exitPrice: last,
        totalPnl: pos.pnlSoFar + pnl, reason:"⏰ نهاية الجلسة" });
    }

    report.push({ sym, seed, candles, trades,
      startPrice: candles[0].close,
      endPrice:   candles[CANDLES-1].close });
  }

  // =================== طباعة النتائج ===================
  console.log("\n");
  let grandWins=0, grandLoss=0, grandPnl=0;

  for (const { sym, seed, candles, trades, startPrice, endPrice } of report) {
    const change = (((endPrice-startPrice)/startPrice)*100).toFixed(2);
    const wins   = trades.filter(t=>t.totalPnl>0).length;
    const loss   = trades.filter(t=>t.totalPnl<=0).length;
    const pnl    = trades.reduce((a,t)=>a+t.totalPnl,0);
    grandWins += wins; grandLoss += loss; grandPnl += pnl;

    console.log(`┌─ ${sym}  |  ${startPrice} → ${endPrice}  (${change>0?'+':''}${change}%)`);
    console.log(`│  صفقات: ${trades.length}  |  ✅ ${wins}  |  ❌ ${loss}  |  PnL: ${pnl>=0?'+':''}$${pnl.toFixed(4)}`);

    if (trades.length === 0) {
      console.log("│  — لا صفقات في هذه الجلسة");
    } else {
      trades.forEach((t, n) => {
        const dir   = t.side==="long" ? "🟢 L" : "🔴 S";
        const tp1m  = t.tp1Hit ? "TP1✓" : "    ";
        const tp2m  = t.tp2Hit ? "TP2✓" : "    ";
        const pStr  = t.totalPnl>=0 ? `+$${t.totalPnl.toFixed(4)}` : `-$${Math.abs(t.totalPnl).toFixed(4)}`;
        console.log(`│  [${n+1}] د${t.entryCandle}→د${t.exitCandle} ${dir} ${t.type.padEnd(20)} | ${tp1m} ${tp2m} | دخول:${t.ep} خروج:${t.exitPrice} | ${pStr} | ${t.reason}`);
      });
    }
    console.log("└" + "─".repeat(70));
  }

  const totalTrades = grandWins + grandLoss;
  const winRate     = totalTrades > 0 ? ((grandWins/totalTrades)*100).toFixed(1) : "0.0";
  const finalBal    = (STARTING_BALANCE + grandPnl).toFixed(4);
  const returnPct   = ((grandPnl/STARTING_BALANCE)*100).toFixed(2);

  console.log("\n" + "═".repeat(72));
  console.log("  📈 الملخص النهائي");
  console.log("═".repeat(72));
  console.log(`  الصفقات الكلية    : ${totalTrades}`);
  console.log(`  رابحة             : ${grandWins} ✅`);
  console.log(`  خاسرة             : ${grandLoss} ❌`);
  console.log(`  نسبة الربح        : ${winRate}%`);
  console.log(`  PnL الكلي         : ${grandPnl>=0?'+':''}$${grandPnl.toFixed(4)}`);
  console.log(`  الرصيد الابتدائي  : $${STARTING_BALANCE}`);
  console.log(`  الرصيد النهائي    : $${finalBal}`);
  console.log(`  العائد            : ${grandPnl>=0?'+':''}${returnPct}%`);
  console.log("═".repeat(72));

  // توزيع العقول
  const typeMap = {};
  report.forEach(r => r.trades.forEach(t => {
    typeMap[t.type] = (typeMap[t.type]||{wins:0,loss:0,pnl:0});
    if(t.totalPnl>0) typeMap[t.type].wins++; else typeMap[t.type].loss++;
    typeMap[t.type].pnl += t.totalPnl;
  }));
  console.log("\n  توزيع أداء كل عقل:");
  for (const [type, s] of Object.entries(typeMap)) {
    const tot = s.wins+s.loss;
    const wr  = tot>0 ? ((s.wins/tot)*100).toFixed(0) : "0";
    console.log(`    ${type.padEnd(22)} | ${tot} صفقة | ✅${s.wins} ❌${s.loss} | ${wr}% | PnL:${s.pnl>=0?'+':''}$${s.pnl.toFixed(4)}`);
  }
  console.log("═".repeat(72));
}

run();
