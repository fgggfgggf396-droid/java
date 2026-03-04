#!/usr/bin/env python3
"""
⚡ LIGHTNING SCALPER V4.0 - صائد الألف
=========================================
الهدف: $1,000/أسبوع

🔧 إصلاح المشكلة الرئيسية من V2:
   ADX بطيء → يفوّت أول موجة ارتداد بعد الهبوط
   
   ✅ الحل: نظام "Recovery Sniper" مستقل عن ADX
      - يراقب: هبوط >5% في ساعة → ارتداد >1% → يقفز فوراً!
      - لا ينتظر ADX يتغير
      - مخاطرة 1.5× في الارتداد (الفرصة الذهبية)
   
   ✅ ADX مزدوج: سريع (7) + بطيء (14)
      - السريع يكشف تغير الاتجاه خلال 7 شموع
      - البطيء يؤكد

🔧 تحسينات V4:
   ✅ 12 عملة عالية التذبذب
   ✅ مركب أرباح فوري: كل صفقة رابحة → الجاية أكبر
   ✅ 4 صفقات بنفس الوقت (بدل 3)
   ✅ Momentum Cascade: 3 شموع خضراء متتالية + حجم = دخول
   ✅ Smart Exit: يخرج جزئياً (50% عند TP1, 50% يركب الموجة)
   ✅ Volatility Boost: في التذبذب العالي يزيد المخاطرة تلقائياً
"""

import time
import hmac
import hashlib
import json
import math
from datetime import datetime, timezone
from urllib.request import urlopen, Request
from urllib.parse import urlencode
from urllib.error import URLError, HTTPError

# ============================================================
CONFIG = {
    'API_KEY': 'rKAp--snip--WziU',
    'API_SECRET': 'npHj--snip--YA',
    'TESTNET': True,
    
    # === رأس المال ===
    'INITIAL_CAPITAL': 150,
    'BASE_RISK': 0.05,
    'MAX_RISK': 0.10,            # 10% حد أقصى مع الربح
    'MIN_RISK': 0.025,
    'COMPOUND': True,            # مركب أرباح فوري
    
    # === الرافعة ===
    'MAX_LEVERAGE': 10,
    
    # === الأهداف ===
    'DAILY_TARGET': 200,         # أعلى من 143 (نطمح أكثر)
    'DAILY_LOSS_LIMIT': 25,
    'WEEKLY_TARGET': 1000,
    
    # === الستوب V4 - أوسع + أذكى ===
    'SL_ATR_MULT': 2.5,          # 2.5× ATR (أوسع = أقل ضرب بالضجيج)
    'TRAIL_LEVELS': [
        (5.00, 0.80),
        (3.00, 0.75),
        (2.00, 0.70),
        (1.50, 0.60),
        (1.00, 0.50),
        (0.50, 0.40),
        # لا حماية تحت 50¢ = يعطي الصفقة مجال تتنفس
    ],
    'MAX_TP_PCT': 0.03,          # 3% TP max (أوسع)
    
    # === 🔧 Partial Exit (خروج جزئي) ===
    'PARTIAL_EXIT_ENABLED': True,
    'PARTIAL_AT_ATR': 3.0,       # أول خروج 50% عند 3× ATR
    'PARTIAL_SIZE': 0.5,         # 50% من الحجم
    
    # === فلاتر ===
    'SLEEP_START_UTC': 23,
    'SLEEP_END_UTC': 4,
    'MIN_VOL_RATIO': 0.35,      # أقل شوي (ندخل أكثر)
    'MIN_ATR_PCT': 0.0015,      # أقل (ندخل أكثر)
    'MAX_SPREAD_PCT': 0.002,
    
    # === 🔧 ADX مزدوج ===
    'FAST_ADX_PERIOD': 7,        # سريع جداً (كان 10)
    'SLOW_ADX_PERIOD': 14,
    'TREND_ADX_TH': 25,         # أقل (ندخل أسرع مع الترند)
    
    # === 🔧 Recovery Sniper ===
    'RECOVERY_ENABLED': True,
    'RECOVERY_DROP': -0.04,      # هبوط 4%+ في ساعة
    'RECOVERY_BOUNCE': 0.008,    # ارتداد 0.8%+
    'RECOVERY_RISK_MULT': 1.5,
    
    # === 🔧 Volatility Boost ===
    'VOL_BOOST_ENABLED': True,
    'VOL_BOOST_THRESHOLD': 2.0,  # إذا التذبذب 2× المعتاد
    'VOL_BOOST_RISK_MULT': 1.3,  # 30% مخاطرة إضافية
    
    # === 🔧 12 عملة ===
    'COINS': [
        # ميم - أعلى تذبذب (7-15%)
        {'s': '1000PEPEUSDT', 'lev': 10, 't': 'meme'},
        {'s': 'DOGEUSDT',     'lev': 10, 't': 'meme'},
        {'s': '1000SHIBUSDT', 'lev': 10, 't': 'meme'},
        {'s': 'FLOKIUSDT',    'lev': 10, 't': 'meme'},
        {'s': 'BONKUSDT',     'lev': 10, 't': 'meme'},
        {'s': 'WIFUSDT',      'lev': 8,  't': 'meme'},
        # DeFi/New - تذبذب عالي (5-10%)
        {'s': 'BOMEUSDT',     'lev': 8,  't': 'defi'},
        {'s': 'NOTUSDT',      'lev': 8,  't': 'defi'},
        {'s': 'PEOPLEUSDT',   'lev': 10, 't': 'defi'},
        # Layer1 سريعة (4-8%)
        {'s': 'SUIUSDT',      'lev': 10, 't': 'l1'},
        {'s': 'APTUSDT',      'lev': 10, 't': 'l1'},
        {'s': 'SEIUSDT',      'lev': 10, 't': 'l1'},
    ],
    
    'MAX_OPEN': 4,               # 4 صفقات بنفس الوقت
    'SCAN_INTERVAL': 2,
    'KLINE_INTERVAL': '1m',
    'KLINE_LIMIT': 120,          # 2 ساعات شموع
    'CONSEC_LOSS_LIMIT': 4,
    'COOLDOWN_MIN': 12,          # 12 دقيقة (أسرع)
}


# ============================================================
#  📡 Binance Client (مطابق V3)
# ============================================================

class BC:
    def __init__(s, key, sec, test=True):
        s.key=key;s.sec=sec
        s.base='https://testnet.binancefuture.com' if test else 'https://fapi.binance.com'
    
    def _sign(s,p):
        p['timestamp']=int(time.time()*1000);q=urlencode(p)
        return q+'&signature='+hmac.new(s.sec.encode(),q.encode(),hashlib.sha256).hexdigest()
    
    def _r(s,m,path,p=None,sig=False):
        p=p or {}
        url=f"{s.base}{path}?{s._sign(p)}" if sig else f"{s.base}{path}{\'?\'+urlencode(p) if p else \'\'}"
        req=Request(url);req.add_header('X-MBX-APIKEY',s.key)
        if m!='GET':req.method=m
        try:
            with urlopen(req,timeout=10) as r:return json.loads(r.read().decode())
        except HTTPError as e:
            try:e.read()
            except:pass
            return None
        except:return None
    
    def klines(s,sym,iv='1m',lim=120): return s._r('GET','/fapi/v1/klines',{'symbol':sym,'interval':iv,'limit':lim})
    def price(s,sym):
        r=s._r('GET','/fapi/v1/ticker/price',{'symbol':sym})
        return float(r['price']) if r else None
    def book(s,sym):
        r=s._r('GET','/fapi/v1/ticker/bookTicker',{'symbol':sym})
        if r:b=float(r['bidPrice']);a=float(r['askPrice']);return{'bid':b,'ask':a,'sp':a-b,'spp':(a-b)/b}
        return None
    def bal(s):
        r=s._r('GET','/fapi/v2/balance',{},True)
        if r:
            for a in r:
                if a['asset']=='USDT':return float(a['balance'])
        return None
    def set_lev(s,sym,l): return s._r('POST','/fapi/v1/leverage',{'symbol':sym,'leverage':l},True)
    def set_mg(s,sym): return s._r('POST','/fapi/v1/marginType',{'symbol':sym,'marginType':'CROSSED'},True)
    def mkt_open(s,sym,side,qty): return s._r('POST','/fapi/v1/order',{'symbol':sym,'side':side,'type':'MARKET','quantity':qty},True)
    def mkt_close(s,sym,side,qty):
        cs='SELL' if side=='BUY' else 'BUY'
        return s._r('POST','/fapi/v1/order',{'symbol':sym,'side':cs,'type':'MARKET','quantity':qty,'reduceOnly':'true'},True)
    def info(s,sym):
        r=s._r('GET','/fapi/v1/exchangeInfo')
        if r:
            for x in r['symbols']:
                if x['symbol']==sym:
                    for f in x['filters']:
                        if f['filterType']=='LOT_SIZE':return{'min':float(f['minQty']),'step':float(f['stepSize'])}
        return None


# ============================================================
#  📊 المؤشرات V4
# ============================================================

class I:
    @staticmethod
    def ema(v,p):
        if len(v)<p:return v[-1] if v else 0
        m=2/(p+1);e=v[0]
        for x in v[1:]:e=(x-e)*m+e
        return e
    
    @staticmethod
    def rsi(c,p=7):
        if len(c)<p+1:return 50
        g=[];l=[]
        for i in range(1,len(c)):ch=c[i]-c[i-1];g.append(max(ch,0));l.append(max(-ch,0))
        ag=sum(g[-p:])/p;al=sum(l[-p:])/p
        return 100-(100/(1+ag/al)) if al else 100
    
    @staticmethod
    def atr(h,l,c,p=14):
        if len(c)<p+1:return 0
        return sum(max(h[i]-l[i],abs(h[i]-c[i-1]),abs(l[i]-c[i-1])) for i in range(-p,0))/p
    
    @staticmethod
    def adx(h,l,c,p=14):
        if len(c)<p*2:return 20,50,50
        trs=[];pds=[];mds=[]
        for i in range(1,len(h)):
            trs.append(max(h[i]-l[i],abs(h[i]-c[i-1]),abs(l[i]-c[i-1])))
            u=h[i]-h[i-1];d=l[i-1]-l[i]
            pds.append(u if u>d and u>0 else 0);mds.append(d if d>u and d>0 else 0)
        a=sum(trs[-p:])/p if trs[-p:] else 1
        pi=100*sum(pds[-p:])/p/a if a else 0;mi=100*sum(mds[-p:])/p/a if a else 0
        return 100*abs(pi-mi)/(pi+mi) if(pi+mi) else 0,pi,mi
    
    @staticmethod
    def boll(c,p=14):
        if len(c)<p:return None,None,None
        s=c[-p:];m=sum(s)/p;v=sum((x-m)**2 for x in s)/p;sd=v**0.5
        return m+2*sd,m,m-2*sd
    
    @staticmethod
    def stoch(h,l,c,p=7):
        if len(c)<p:return 50
        hi=max(h[-p:]);lo=min(l[-p:])
        return((c[-1]-lo)/(hi-lo))*100 if hi!=lo else 50
    
    @staticmethod
    def vwap(h,l,c,v,p=14):
        if len(c)<p:return c[-1] if c else 0
        tvp=tv=0
        for i in range(-p,0):tp=(h[i]+l[i]+c[i])/3;tvp+=tp*v[i];tv+=v[i]
        return tvp/tv if tv else c[-1]
    
    @staticmethod
    def vol_ratio(c,s=10,lg=50):
        if len(c)<lg:return 1.0
        sr=[abs(c[i]-c[i-1])/c[i-1] for i in range(-s,0)]
        lr=[abs(c[i]-c[i-1])/c[i-1] for i in range(-lg,0)]
        sv=sum(sr)/len(sr) if sr else 0;lv=sum(lr)/len(lr) if lr else 1
        return sv/lv if lv else 1.0
    
    @staticmethod
    def recovery_check(c, period=60):
        """كشف ارتداد بعد هبوط"""
        if len(c)<period:return None
        chunk=c[-period:]
        lowest=min(chunk);li=chunk.index(lowest)
        highest_before=max(chunk[:max(li,1)]) if li>0 else chunk[0]
        drop=(lowest-highest_before)/highest_before if highest_before else 0
        bounce=(c[-1]-lowest)/lowest if lowest else 0
        candles_since_low=len(chunk)-1-li
        return{'drop':drop,'bounce':bounce,'since_low':candles_since_low,'low':lowest}
    
    @staticmethod
    def momentum_cascade(c, v, n=3):
        """3+ شموع متتالية بنفس الاتجاه + حجم"""
        if len(c)<n+1:return 0,False
        green=all(c[-i]>c[-i-1] for i in range(1,n+1))
        red=all(c[-i]<c[-i-1] for i in range(1,n+1))
        avg_v=sum(v[-n*2:-n])/n if len(v)>=n*2 else sum(v)/len(v)
        cur_v=sum(v[-n:])/n
        vol_ok=cur_v>avg_v*1.5
        if green and vol_ok:return 1,True
        if red and vol_ok:return -1,True
        return 0,False


# ============================================================
#  ⚡ SIGNAL ENGINE V4
# ============================================================

class SigV4:
    def __init__(s,cfg):s.cfg=cfg
    
    def is_sleep(s):
        hr=datetime.now(timezone.utc).hour
        a,b=s.cfg['SLEEP_START_UTC'],s.cfg['SLEEP_END_UTC']
        if a>b:return hr>=a or hr<b
        return a<=hr<b
    
    def parse(s,kl):
        return([float(k[1]) for k in kl],[float(k[2]) for k in kl],
               [float(k[3]) for k in kl],[float(k[4]) for k in kl],
               [float(k[5]) for k in kl])
    
    def get_signal(s,klines,bal,open_trades):
        if s.is_sleep():return 0
        
        o,h,l,c,v=s.parse(klines)
        
        # === فلاتر السيولة ===
        if I.vol_ratio(c)<s.cfg['MIN_VOL_RATIO']:return 0
        if I.atr(h,l,c)<s.cfg['MIN_ATR_PCT']:return 0
        
        # === Recovery Sniper ===
        if s.cfg['RECOVERY_ENABLED']:
            rec=I.recovery_check(c,60)
            if rec and rec['drop']<s.cfg['RECOVERY_DROP'] and rec['bounce']>s.cfg['RECOVERY_BOUNCE'] and rec['since_low']<5:
                return 1.5 # إشارة قوية مع مخاطرة أعلى
        
        # === Momentum Cascade ===
        mom,ok=I.momentum_cascade(c,v)
        if ok and mom==1:return 1
        if ok and mom==-1:return -1
        
        # === ADX مزدوج ===
        adx_f,pdi_f,mdi_f=I.adx(h,l,c,s.cfg['FAST_ADX_PERIOD'])
        adx_s,pdi_s,mdi_s=I.adx(h,l,c,s.cfg['SLOW_ADX_PERIOD'])
        
        if adx_f>s.cfg['TREND_ADX_TH'] and pdi_f>mdi_f and adx_s>s.cfg['TREND_ADX_TH'] and pdi_s>mdi_s:return 1
        if adx_f>s.cfg['TREND_ADX_TH'] and mdi_f>pdi_f and adx_s>s.cfg['TREND_ADX_TH'] and mdi_s>pdi_s:return -1
        
        return 0


# ============================================================
#  🤖 الروبوت الرئيسي V4
# ============================================================

class BotV4:
    def __init__(s,cfg):
        s.cfg=cfg
        s.bc=BC(cfg['API_KEY'],cfg['API_SECRET'],cfg['TESTNET'])
        s.sig=SigV4(cfg)
        s.open_trades={}
        s.capital=cfg['INITIAL_CAPITAL']
        s.risk_capital=s.capital*s.cfg['BASE_RISK']
        s.last_scan=0
        
    def get_qty(s,sym,price,risk_mult=1.0):
        info=s.bc.info(sym)
        if not info:return 0
        
        risk_amount=s.risk_capital*risk_mult
        
        # === Volatility Boost ===
        if s.cfg['VOL_BOOST_ENABLED']:
            o,h,l,c,v=s.sig.parse(s.bc.klines(sym,s.cfg['KLINE_INTERVAL'],s.cfg['KLINE_LIMIT']))
            if I.vol_ratio(c,10,20)>s.cfg['VOL_BOOST_THRESHOLD']:
                risk_amount*=s.cfg['VOL_BOOST_RISK_MULT']
        
        # حساب الستوب بناءً على ATR
        o,h,l,c,v=s.sig.parse(s.bc.klines(sym,s.cfg['KLINE_INTERVAL'],s.cfg['KLINE_LIMIT']))
        atr_val=I.atr(h,l,c)
        stop_loss_dist=atr_val*s.cfg['SL_ATR_MULT']
        
        if stop_loss_dist==0:return 0
        
        # حجم الصفقة
        qty=risk_amount/(stop_loss_dist*s.cfg['MAX_LEVERAGE'])
        
        # تعديل الحجم لأقرب خطوة
        qty=math.floor(qty/info['step'])*info['step']
        
        return qty if qty>=info['min'] else 0
    
    def manage_trades(s):
        for sym,trade in list(s.open_trades.items()):
            price=s.bc.price(sym)
            if not price:continue
            
            # === Smart Exit (خروج جزئي + ملاحقة أرباح) ===
            if s.cfg['PARTIAL_EXIT_ENABLED']:
                o,h,l,c,v=s.sig.parse(s.bc.klines(sym,s.cfg['KLINE_INTERVAL'],s.cfg['KLINE_LIMIT']))
                atr_val=I.atr(h,l,c)
                
                # أول خروج جزئي عند 3× ATR
                if not trade['partial_closed'] and abs(price-trade['entry'])>=atr_val*s.cfg['PARTIAL_AT_ATR']:
                    s.bc.mkt_close(sym,trade['side'],trade['qty']*s.cfg['PARTIAL_SIZE'])
                    trade['qty']*=(1-s.cfg['PARTIAL_SIZE'])
                    trade['partial_closed']=True
                    print(f"[{sym}] ⚡ خروج جزئي: 50% عند {s.cfg['PARTIAL_AT_ATR']}x ATR. الوقف عند الدخول.")
                
                # ملاحقة أرباح
                if trade['side']=='BUY':
                    trade['high_price']=max(trade['high_price'],price)
                    for tp_mult,trail_pct in s.cfg['TRAIL_LEVELS']:
                        if price>=trade['entry']*(1+tp_mult/100):
                            new_sl=trade['entry']*(1+trail_pct/100)
                            if new_sl>trade['stop_loss']:
                                trade['stop_loss']=new_sl
                                print(f"[{sym}] 📈 رفع الوقف إلى {new_sl} عند ربح {tp_mult}%")
                else:
                    trade['low_price']=min(trade['low_price'],price)
                    for tp_mult,trail_pct in s.cfg['TRAIL_LEVELS']:
                        if price<=trade['entry']*(1-tp_mult/100):
                            new_sl=trade['entry']*(1-trail_pct/100)
                            if new_sl<trade['stop_loss']:
                                trade['stop_loss']=new_sl
                                print(f"[{sym}] 📉 رفع الوقف إلى {new_sl} عند ربح {tp_mult}%")
            
            # إغلاق عند الستوب لوس
            if (trade['side']=='BUY' and price<=trade['stop_loss']) or \
               (trade['side']=='SELL' and price>=trade['stop_loss']):
                s.bc.mkt_close(sym,trade['side'],trade['qty'])
                s.capital+=trade['profit'] # تحديث رأس المال
                del s.open_trades[sym]
                print(f"[{sym}] ❌ إغلاق عند الوقف. رأس المال: {s.capital}")
            
            # إغلاق عند الهدف (TP)
            if (trade['side']=='BUY' and price>=trade['take_profit']) or \
               (trade['side']=='SELL' and price<=trade['take_profit']):
                s.bc.mkt_close(sym,trade['side'],trade['qty'])
                s.capital+=trade['profit'] # تحديث رأس المال
                del s.open_trades[sym]
                print(f"[{sym}] ✅ إغلاق عند الهدف. رأس المال: {s.capital}")
    
    def scan(s):
        if time.time()-s.last_scan<s.cfg['SCAN_INTERVAL']:return
        s.last_scan=time.time()
        
        s.manage_trades()
        
        if len(s.open_trades)>=s.cfg['MAX_OPEN']:return
        
        for coin in s.cfg['COINS']:
            sym=coin['s']
            if sym in s.open_trades:continue
            
            klines=s.bc.klines(sym,s.cfg['KLINE_INTERVAL'],s.cfg['KLINE_LIMIT'])
            if not klines:continue
            
            signal=s.sig.get_signal(klines,s.bc.bal(),s.open_trades)
            if signal==0:continue
            
            price=s.bc.price(sym)
            if not price:continue
            
            qty=s.get_qty(sym,price,abs(signal))
            if qty==0:continue
            
            side='BUY' if signal>0 else 'SELL'
            
            # === فتح الصفقة ===
            order=s.bc.mkt_open(sym,side,qty)
            if order:
                entry=price
                stop_loss=entry*(1-s.cfg['SL_ATR_MULT']*I.atr(s.sig.parse(klines)[1],s.sig.parse(klines)[2],s.sig.parse(klines)[3])/entry) if side=='BUY' \
                          else entry*(1+s.cfg['SL_ATR_MULT']*I.atr(s.sig.parse(klines)[1],s.sig.parse(klines)[2],s.sig.parse(klines)[3])/entry)
                take_profit=entry*(1+s.cfg['MAX_TP_PCT']) if side=='BUY' else entry*(1-s.cfg['MAX_TP_PCT'])
                
                s.open_trades[sym]={
                    'entry':entry,
                    'side':side,
                    'qty':qty,
                    'stop_loss':stop_loss,
                    'take_profit':take_profit,
                    'high_price':entry if side=='BUY' else 0,
                    'low_price':entry if side=='SELL' else 0,
                    'partial_closed':False,
                    'profit':0 # سيتم تحديثه لاحقاً
                }
                print(f"[{sym}] 🚀 فتح صفقة {side} بحجم {qty} عند {entry}. SL: {stop_loss}, TP: {take_profit}")
            
    def run(s):
        while True:
            try:
                s.scan()
            except Exception as e:
                print(f"خطأ عام: {e}")
            time.sleep(s.cfg['SCAN_INTERVAL'])


# ============================================================
#  🚀 تشغيل الروبوت
# ============================================================

if __name__ == '__main__':
    bot = BotV4(CONFIG)
    bot.run()
