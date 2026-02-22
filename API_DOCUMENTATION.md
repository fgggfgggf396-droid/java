# Sovereign Master-Brain - API Documentation

## 📡 نقاط النهاية (Endpoints)

جميع الطلبات تُرسل إلى: `https://your-domain.onrender.com`

---

## 💰 1. جلب الرصيد

### `GET /api/balance`

احصل على رصيد حسابك الحالي على BingX.

**الطلب:**
```bash
curl https://your-domain.onrender.com/api/balance
```

**الاستجابة:**
```json
{
  "success": true,
  "balance": 1000.50
}
```

| الحقل | النوع | الوصف |
|------|------|-------|
| `success` | boolean | نجاح الطلب |
| `balance` | number | الرصيد المتاح بالدولار |

---

## 📈 2. جلب السعر الحالي

### `GET /api/price`

احصل على سعر BTC-USDT الحالي من BingX.

**الطلب:**
```bash
curl https://your-domain.onrender.com/api/price
```

**الاستجابة:**
```json
{
  "success": true,
  "price": 45250.50
}
```

| الحقل | النوع | الوصف |
|------|------|-------|
| `success` | boolean | نجاح الطلب |
| `price` | number | سعر BTC بالدولار |

---

## 🟢 3. فتح صفقة شراء (BUY)

### `POST /api/trade/buy`

افتح صفقة شراء (Long) على BTC-USDT.

**الطلب:**
```bash
curl -X POST https://your-domain.onrender.com/api/trade/buy \
  -H "Content-Type: application/json" \
  -d '{
    "quantity": 0.01,
    "leverage": 10
  }'
```

**معاملات الطلب:**

| المعامل | النوع | مطلوب | الوصف |
|--------|------|------|-------|
| `quantity` | number | ✅ | كمية BTC (مثال: 0.01) |
| `leverage` | number | ❌ | الرافعة المالية (افتراضي: 10) |

**الاستجابة:**
```json
{
  "success": true,
  "orderId": "123456789",
  "message": "Order placed successfully",
  "data": {
    "orderId": "123456789",
    "symbol": "BTC-USDT",
    "side": "BUY",
    "price": 45250.50
  }
}
```

---

## 🔴 4. فتح صفقة بيع (SELL/Short)

### `POST /api/trade/sell`

افتح صفقة بيع (Short) على BTC-USDT.

**الطلب:**
```bash
curl -X POST https://your-domain.onrender.com/api/trade/sell \
  -H "Content-Type: application/json" \
  -d '{
    "quantity": 0.01,
    "leverage": 10
  }'
```

**معاملات الطلب:**

| المعامل | النوع | مطلوب | الوصف |
|--------|------|------|-------|
| `quantity` | number | ✅ | كمية BTC |
| `leverage` | number | ❌ | الرافعة المالية (افتراضي: 10) |

**الاستجابة:**
```json
{
  "success": true,
  "orderId": "987654321",
  "message": "Order placed successfully",
  "data": {
    "orderId": "987654321",
    "symbol": "BTC-USDT",
    "side": "SELL",
    "price": 45250.50
  }
}
```

---

## 🔒 5. إغلاق الصفقة

### `POST /api/trade/close`

أغلق الصفقة المفتوحة حاليًا.

**الطلب:**
```bash
curl -X POST https://your-domain.onrender.com/api/trade/close \
  -H "Content-Type: application/json" \
  -d '{
    "quantity": 0.01
  }'
```

**معاملات الطلب:**

| المعامل | النوع | مطلوب | الوصف |
|--------|------|------|-------|
| `quantity` | number | ✅ | كمية BTC المراد إغلاقها |

**الاستجابة:**
```json
{
  "success": true,
  "orderId": "555555555",
  "message": "Position closed successfully",
  "data": {
    "orderId": "555555555",
    "pnl": 50.25,
    "pnlPercent": 2.5
  }
}
```

---

## 🛑 6. تحديث وقف الخسارة (Trailing Stop)

### `POST /api/trade/update-sl`

حدّث وقف الخسارة للصفقة المفتوحة (يستخدم لرفع الحماية عند الربح).

**الطلب:**
```bash
curl -X POST https://your-domain.onrender.com/api/trade/update-sl \
  -H "Content-Type: application/json" \
  -d '{
    "orderId": "123456789",
    "stopPrice": 44500.00
  }'
```

**معاملات الطلب:**

| المعامل | النوع | مطلوب | الوصف |
|--------|------|------|-------|
| `orderId` | string | ✅ | معرّف الصفقة |
| `stopPrice` | number | ✅ | سعر وقف الخسارة الجديد |

**الاستجابة:**
```json
{
  "success": true,
  "message": "Stop loss updated successfully",
  "data": {
    "orderId": "123456789",
    "stopPrice": 44500.00
  }
}
```

---

## 📋 7. جلب الصفقات المفتوحة

### `GET /api/orders`

احصل على قائمة جميع الصفقات المفتوحة.

**الطلب:**
```bash
curl https://your-domain.onrender.com/api/orders
```

**الاستجابة:**
```json
{
  "success": true,
  "orders": [
    {
      "orderId": "123456789",
      "symbol": "BTC-USDT",
      "side": "BUY",
      "quantity": 0.01,
      "price": 45250.50,
      "stopPrice": 44500.00,
      "pnl": 50.25,
      "pnlPercent": 2.5
    }
  ]
}
```

---

## 📊 8. جلب بيانات الشموع (Klines)

### `GET /api/klines`

احصل على بيانات الشموع التاريخية للتحليل.

**الطلب:**
```bash
curl "https://your-domain.onrender.com/api/klines?interval=1h&limit=100"
```

**معاملات الاستعلام:**

| المعامل | النوع | افتراضي | الخيارات |
|--------|------|--------|---------|
| `interval` | string | 1h | 1m, 5m, 15m, 1h, 4h, 1d |
| `limit` | number | 100 | 1-1000 |

**الاستجابة:**
```json
{
  "success": true,
  "klines": [
    [
      1708617600000,
      "45000.00",
      "45500.00",
      "44800.00",
      "45250.50",
      "123.45"
    ]
  ]
}
```

**تنسيق الشمعة:**
```
[
  timestamp,      // وقت الشمعة (milliseconds)
  open,           // سعر الفتح
  high,           // أعلى سعر
  low,            // أقل سعر
  close,          // سعر الإغلاق
  volume          // الحجم
]
```

---

## ❌ معالجة الأخطاء

جميع الأخطاء تُرجع رمز HTTP مع رسالة خطأ:

```json
{
  "success": false,
  "error": "Failed to open BUY position",
  "details": "Insufficient balance"
}
```

| رمز الخطأ | المعنى |
|---------|-------|
| 400 | طلب غير صحيح (معاملات ناقصة) |
| 500 | خطأ في الخادم أو BingX API |

---

## 🔐 الأمان

### مفاتيح API

- جميع الطلبات موقّعة رقميًا باستخدام HMAC-SHA256
- المفاتيح مخزنة في متغيرات البيئة (آمنة)
- لا تشارك مفاتيحك مع أي شخص

### معدل الطلبات

- الحد الأقصى: 1000 طلب/دقيقة من BingX
- الواجهة الأمامية تحد من الطلبات تلقائيًا

---

## 💡 أمثلة عملية

### مثال 1: فتح صفقة شراء وإغلاقها

```javascript
// 1. افتح صفقة شراء
const buyResponse = await fetch('/api/trade/buy', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ quantity: 0.01, leverage: 10 })
});
const buyData = await buyResponse.json();
const orderId = buyData.orderId;

// 2. انتظر 5 ثوانٍ
await new Promise(r => setTimeout(r, 5000));

// 3. أغلق الصفقة
const closeResponse = await fetch('/api/trade/close', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ quantity: 0.01 })
});
const closeData = await closeResponse.json();
console.log('PnL:', closeData.data.pnl);
```

### مثال 2: رفع وقف الخسارة (Trailing)

```javascript
// 1. احصل على السعر الحالي
const priceRes = await fetch('/api/price');
const { price } = await priceRes.json();

// 2. ارفع وقف الخسارة إلى 2% أقل من السعر الحالي
const newSL = price * 0.98;
await fetch('/api/trade/update-sl', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ orderId: '123456789', stopPrice: newSL })
});
```

---

## 📚 المراجع

- [BingX API Documentation](https://bingx-api.github.io/docs-v3/)
- [BingX Swap V3 API](https://bingx-api.github.io/docs-v3/#/en/Swap/Account%20Endpoints/Query%20account%20data)

---

**آخر تحديث:** 2026-02-23  
**الإصدار:** 1.0.0
