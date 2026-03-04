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
    'API_KEY': 'rKApgjXcm5xYfFAotrHRe0GpX4KjAjoVJ09efnYiat3pBZhxF0tAkrQqBXravWziU',
    'API_SECRET': 'npHj0kZuuQHsStFkRFQQ4PFnVfxG6EcfekkqgbgSxlqSowQAvcel8lrGHo0lhvlVT',
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
        url=f"{s.base}{path}?{s._sign(p)}" if sig else f"{s.base}{path}{'?'+urlencode(p) if p else ''}"
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

    def analyze(s,kl,sp_pct):
        if s.is_sleep():return None
        o,h,l,c,v=s.parse(kl)
        cp=c[-1]
        
        # 🔧 ADX مزدوج
        adx_f,pi_f,mi_f=I.adx(h,l,c,s.cfg['FAST_ADX_PERIOD'])
        adx_s,pi_s,mi_s=I.adx(h,l,c,s.cfg['SLOW_ADX_PERIOD'])
        
        atr=I.atr(h,l,c,14)
        vr=I.vol_ratio(c)
        
        # 🔧 Recovery Sniper
        rec=I.recovery_check(c)
        is_rec=False
        if rec and rec['drop']<=s.cfg['RECOVERY_DROP'] and rec['bounce']>=s.cfg['RECOVERY_BOUNCE']:
            is_rec=True
            
        # 🔧 Momentum Cascade
        mom_dir,is_burst=I.momentum_cascade(c,v)
        
        # 🔧 الاتجاه العام
        ema_f=I.ema(c,10);ema_s=I.ema(c,30)
        uptrend=cp>ema_f>ema_s;downtrend=cp<ema_f<ema_s
        
        # 🔧 شروط الدخول
        side=None;score=0;reasons=[]
        
        # BUY logic
        if is_rec:
            side='BUY';score=90;reasons.append('RECOVERY')
        elif uptrend and pi_f>mi_f and adx_f>s.cfg['TREND_ADX_TH']:
            side='BUY';score=70;reasons.append('TREND')
            if is_burst and mom_dir==1:score+=20;reasons.append('BURST')
        
        # SELL logic
        elif downtrend and mi_f>pi_f and adx_f>s.cfg['TREND_ADX_TH']:
            side='SELL';score=70;reasons.append('TREND')
            if is_burst and mom_dir==-1:score+=20;reasons.append('BURST')

        if side:
            return{'a':side,'p':cp,'sc':score,'r':reasons,'atr':atr,'vr':vr,
                   'rec':is_rec,'burst':is_burst,'adx_f':adx_f}
        return None


# ============================================================
#  🛡️ POSITION MANAGER V4
# ============================================================

class PM4:
    def __init__(s,cfg):
        s.cfg=cfg;s.pos=None;s.best=0;s.tsl=0;s.partial_done=False
    
    def open(s,sym,side,price,size,lev,atr,spread):
        s.pos={'sym':sym,'side':side,'p':price,'size':size,'lev':lev,'atr':atr,'sp':spread}
        s.best=price;s.tsl=0;s.partial_done=False
    
    def update(s,cp,client):
        if not s.pos:return None
        side=s.pos['side'];entry=s.pos['p'];atr=s.pos['atr']
        
        # PNL calculation
        if side=='BUY':
            pnl=(cp-entry)/entry*s.pos['lev']
            if cp>s.best:s.best=cp
            dist=(s.best-entry)/entry*100
        else:
            pnl=(entry-cp)/entry*s.pos['lev']
            if cp<s.best or s.best==0:s.best=cp
            dist=(entry-s.best)/entry*100
            
        # 🔧 Trailing Stop Logic
        new_tsl=0
        for th,prot in s.cfg['TRAIL_LEVELS']:
            if dist>=th:
                if side=='BUY':new_tsl=s.best-(s.best-entry)*prot
                else:new_tsl=s.best+(entry-s.best)*prot
                break
        
        if new_tsl!=0:
            if side=='BUY':
                if new_tsl>s.tsl:s.tsl=new_tsl
            else:
                if s.tsl==0 or new_tsl<s.tsl:s.tsl=new_tsl
        
        # 🔧 Partial Exit Logic
        partial=None
        if s.cfg['PARTIAL_EXIT_ENABLED'] and not s.partial_done:
            target_dist=s.cfg['PARTIAL_AT_ATR']*atr
            if side=='BUY' and cp>=entry+target_dist:
                partial={'qty':s.pos['size']*s.cfg['PARTIAL_SIZE'],'pnl':pnl*s.cfg['PARTIAL_SIZE']}
                s.pos['size']-=partial['qty'];s.partial_done=True
            elif side=='SELL' and cp<=entry-target_dist:
                partial={'qty':s.pos['size']*s.cfg['PARTIAL_SIZE'],'pnl':pnl*s.cfg['PARTIAL_SIZE']}
                s.pos['size']-=partial['qty'];s.partial_done=True

        # 🔧 Exit conditions
        action=None
        # 1. SL (Hard)
        sl_dist=s.cfg['SL_ATR_MULT']*atr
        if side=='BUY' and cp<=entry-sl_dist:action='SL'
        elif side=='SELL' and cp>=entry+sl_dist:action='SL'
        
        # 2. TSL
        if s.tsl!=0:
            if side=='BUY' and cp<=s.tsl:action='TSL'
            elif side=='SELL' and cp>=s.tsl:action='TSL'
            
        # 3. Max TP
        if pnl>=s.cfg['MAX_TP_PCT']*s.pos['lev']:action='MAX_TP'
        
        return{'pnl':round(pnl,4),'best':round(s.best,4),'tsl':round(s.tsl,8),
               'action':action,'partial':partial}
    
    def close(s):
        p=s.pos;s.pos=None;s.best=0;s.tsl=0;s.partial_done=False;return p


# ============================================================
#  🤖 THE BEAST V4
# ============================================================

class BeastV4:
    def __init__(s,cfg):
        s.cfg=cfg
        s.cl=BC(cfg['API_KEY'],cfg['API_SECRET'],cfg['TESTNET'])
        s.eng=SigV4(cfg)
        s.mgrs={};s.cinfo={};s.op={}
        s.bal=cfg['INITIAL_CAPITAL']
        s.dp=0;s.dt=0;s.dw=0;s.dl=0
        s.cl_cnt=0;s.cool=0
        s.tp=0;s.tw=0;s.tl=0
        s.today=None;s.wp=0
        s.partial_profits=0  # أرباح من الخروج الجزئي
    
    def risk(s):
        """مخاطرة ديناميكية + مركبة"""
        base=s.cfg['BASE_RISK']
        ratio=s.tp/s.cfg['INITIAL_CAPITAL'] if s.cfg['INITIAL_CAPITAL'] else 0
        
        if ratio>0.3:r=min(s.cfg['MAX_RISK'],base*1.6)
        elif ratio>0.15:r=min(s.cfg['MAX_RISK'],base*1.3)
        elif ratio>0:r=base*1.1
        elif ratio<-0.15:r=max(s.cfg['MIN_RISK'],base*0.5)
        elif ratio<-0.05:r=max(s.cfg['MIN_RISK'],base*0.7)
        else:r=base
        
        if s.cl_cnt>=3:r*=0.4
        elif s.cl_cnt>=2:r*=0.6
        return r
    
    def setup(s):
        mode='🔴 TEST' if s.cfg['TESTNET'] else '🟢 LIVE'
        print(f"\n{'='*70}")
        print(f"  ⚡ LIGHTNING V4.0 صائد الألف - {mode}")
        print(f"  💰 ${s.cfg['INITIAL_CAPITAL']} | 🎯 ${s.cfg['WEEKLY_TARGET']}/أسبوع")
        print(f"  📊 {len(s.cfg['COINS'])} عملة | 4 صفقات | مركب أرباح | Recovery Sniper")
        print(f"  🔧 ADX مزدوج(7+14) | Partial Exit | Momentum Cascade")
        print(f"{'='*70}\n")
        
        b=s.cl.bal()
        if b is not None:s.bal=b;print(f"  ✅ ${b:.2f}")
        else:print(f"  ❌ فشل!");return False
        
        ok=[]
        for c in s.cfg['COINS']:
            sym=c['s']
            s.cl.set_lev(sym,c['lev']);s.cl.set_mg(sym)
            inf=s.cl.info(sym)
            if inf:
                s.cinfo[sym]=inf;s.mgrs[sym]=PM4(s.cfg);s.op[sym]=False
                ok.append(c)
                print(f"  ✅ {sym:16s} {c['lev']:2d}x [{c['t']}]")
            else:
                print(f"  ⚠️ {sym} - تخطي")
        
        s.cfg['COINS']=ok
        print(f"\n  🚀 {len(ok)} عملة نشطة\n")
        return len(ok)>0
    
    def rqty(s,sym,qty):
        inf=s.cinfo.get(sym)
        if not inf:return qty
        st=inf['step']
        if st<=0:return qty
        p=max(0,-int(math.log10(st)))
        return round(math.floor(qty/st)*st,p)
    
    def reset(s):
        today=datetime.now(timezone.utc).strftime('%Y-%m-%d')
        if today!=s.today:
            if s.today:
                wr=s.dw/(s.dw+s.dl)*100 if(s.dw+s.dl) else 0
                print(f"\n  📅 {s.today}: ${s.dp:+.2f} W:{s.dw} L:{s.dl} WR:{wr:.0f}% "
                      f"Week:${s.wp:+.2f} Total:${s.tp:+.2f} Bal:${s.bal:.0f}")
            dow=datetime.now(timezone.utc).weekday()
            if dow==0 and s.today:
                flag="🎯🎯🎯" if s.wp>=1000 else("🎯" if s.wp>=500 else "")
                print(f"\n  📊 === أسبوع: ${s.wp:+.2f} {flag} ===\n")
                s.wp=0
            s.today=today;s.dp=0;s.dt=0;s.dw=0;s.dl=0;s.cl_cnt=0
    
    def can(s):
        if s.dp>=s.cfg['DAILY_TARGET']:return False
        if s.dp<=-s.cfg['DAILY_LOSS_LIMIT']:return False
        if time.time()<s.cool:return False
        return True
    
    def nop(s):return sum(1 for v in s.op.values() if v)
    
    def scan(s,sym,lev,tier):
        pm=s.mgrs[sym]
        
        if s.op.get(sym):
            price=s.cl.price(sym)
            if not price:return
            st=pm.update(price,s.cl)
            if not st:return
            
            # 🔧 Partial exit
            if st['partial']:
                pe=st['partial']
                s.cl.mkt_close(sym,pm.pos['side'],s.rqty(sym,pe['qty']))
                s.partial_profits+=pe['pnl']
                s.dp+=pe['pnl'];s.tp+=pe['pnl'];s.wp+=pe['pnl'];s.bal+=pe['pnl']
                now=datetime.now().strftime('%H:%M:%S')
                print(f"  🟡 {now} {sym[:10]:10s} PARTIAL 50% ${pe['pnl']:+.3f} "
                      f"(riding rest...)")
            
            if st['action']:
                pos=pm.pos
                s.cl.mkt_close(sym,pos['side'],s.rqty(sym,pos['size']))
                pnl=st['pnl']
                s.dp+=pnl;s.tp+=pnl;s.wp+=pnl;s.dt+=1;s.bal+=pnl
                
                if pnl>0 or(pnl>-0.05 and s.partial_profits>0):
                    s.tw+=1;s.dw+=1;s.cl_cnt=0;ic="✅"
                else:
                    s.tl+=1;s.dl+=1;s.cl_cnt+=1;ic="❌"
                    if s.cl_cnt>=s.cfg['CONSEC_LOSS_LIMIT']:
                        s.cool=time.time()+s.cfg['COOLDOWN_MIN']*60
                        print(f"  ⏸️ {s.cfg['COOLDOWN_MIN']}min")
                
                now=datetime.now().strftime('%H:%M:%S')
                rp=s.risk()*100
                total_trade_pnl=pnl+(s.partial_profits if pm.partial_done else 0)
                print(f"  {ic} {now} {sym[:10]:10s} {pos['side']:4s} "
                      f"${total_trade_pnl:+.3f} bst:${st['best']:+.3f} "
                      f"{st['action']:8s} D:${s.dp:+.2f} R:{rp:.0f}% B:${s.bal:.0f}")
                
                pm.close()
                s.op[sym]=False
                s.partial_profits=0
            return
        
        if not s.can():return
        if s.nop()>=s.cfg['MAX_OPEN']:return
        
        bk=s.cl.book(sym)
        if bk and bk['spp']>s.cfg['MAX_SPREAD_PCT']:return
        spread=bk['sp'] if bk else 0;sp_pct=bk['spp'] if bk else 0
        
        kl=s.cl.klines(sym,s.cfg['KLINE_INTERVAL'],s.cfg['KLINE_LIMIT'])
        if not kl:return
        
        sig=s.eng.analyze(kl,sp_pct)
        if not sig:return
        
        # 🔧 مخاطرة ديناميكية + مركبة
        r=s.risk()
        
        # 🔧 Recovery boost
        if sig.get('rec'):r*=s.cfg['RECOVERY_RISK_MULT']
        
        # 🔧 Volatility boost
        if s.cfg['VOL_BOOST_ENABLED'] and sig.get('vr',1)>s.cfg['VOL_BOOST_THRESHOLD']:
            r*=s.cfg['VOL_BOOST_RISK_MULT']
        
        # 🔧 Momentum burst boost
        if sig.get('burst'):r*=1.2
        
        r=min(r,s.cfg['MAX_RISK'])
        
        # 🔧 الحجم يعتمد على الرصيد الحالي (مركب!)
        risk_amt=s.bal*r
        pos_val=risk_amt*lev
        qty=s.rqty(sym,pos_val/sig['p'])
        if qty<=0:return
        
        result=s.cl.mkt_open(sym,sig['a'],qty)
        if not result:return
        
        pm.open(sym,sig['a'],sig['p'],qty,lev,sig['atr'],spread)
        s.op[sym]=True
        s.partial_profits=0
        
        now=datetime.now().strftime('%H:%M:%S')
        rp=r*100
        flags=""
        if sig.get('rec'):flags+="🔄"
        if sig.get('burst'):flags+="💥"
        print(f"  🔵 {now} {sym[:10]:10s} {sig['a']:4s} "
              f"@{sig['p']:.6f} Q:{qty} L:{lev}x "
              f"S:{sig['sc']} ADXf:{sig['adx_f']:.0f} "
              f"R:{rp:.0f}% ${risk_amt:.1f} "
              f"{flags} {' '.join(sig['r'][:4])}")
    
    def run(s):
        if not s.setup():return
        try:
            while True:
                s.reset()
                for c in s.cfg['COINS']:
                    try:s.scan(c['s'],c['lev'],c['t'])
                    except:pass
                time.sleep(s.cfg['SCAN_INTERVAL'])
        except KeyboardInterrupt:
            print(f"\n  🛑 إيقاف...")
            for sym,pm in s.mgrs.items():
                if pm.pos:
                    p=s.cl.price(sym)
                    if p:s.cl.mkt_close(sym,pm.pos['side'],s.rqty(sym,pm.pos['size']))
                    print(f"  🔴 {sym}")
            t=s.tw+s.tl;wr=s.tw/t*100 if t else 0
            print(f"\n{'='*70}")
            print(f"  📊 Total:${s.tp:+.2f} W:{s.tw} L:{s.tl} WR:{wr:.0f}% Bal:${s.bal:.2f}")
            print(f"{'='*70}\n")


if __name__=='__main__':
    print("""
╔═══════════════════════════════════════════════════════════════════════╗
║                ⚡ LIGHTNING SCALPER V4.0 - صائد الألف                 ║
╠═══════════════════════════════════════════════════════════════════════╣
║                                                                       ║
║  🎯 الهدف: $1,000/أسبوع                                             ║
║                                                                       ║
║  🔧 V4 الجديد:                                                       ║
║  ✅ Recovery Sniper: يصطاد الارتداد فوراً (يتجاوز ADX!)              ║
║  ✅ ADX مزدوج: سريع(7) + بطيء(14) = يلحق التغير أسرع               ║
║  ✅ Partial Exit: 50% ربح عند TP1 + 50% يركب الموجة                 ║
║  ✅ Momentum Cascade: 3 شموع متتالية + حجم = دخول قوي               ║
║  ✅ 12 عملة: PEPE,DOGE,SHIB,FLOKI,BONK,WIF,BOME,NOT,PEOPLE,SUI,APT,SEI ║
║  ✅ 4 صفقات بنفس الوقت                                               ║
║  ✅ Volatility Boost: تذبذب عالي = مخاطرة أعلى تلقائياً              ║
║  ✅ مخاطرة 5-10% متغيرة + مركب أرباح فوري                           ║
║                                                                       ║
║  📝 API Keys → TESTNET = True → شغّل → اختبر                        ║
╚═══════════════════════════════════════════════════════════════════════╝
    """)
    BeastV4(CONFIG).run()
