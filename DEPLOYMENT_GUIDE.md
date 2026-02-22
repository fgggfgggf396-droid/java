# Sovereign Master-Brain - Render Deployment Guide

## 📋 نظرة عامة

هذا الدليل يشرح كيفية نشر **Sovereign Master-Brain** على **Render** بحيث يعمل كنظام تداول آلي متصل بـ BingX API.

---

## 🚀 خطوات النشر على Render

### الخطوة 1: تحضير المشروع

تأكد من أن لديك جميع الملفات التالية في المشروع:

```
sovereign-master-brain/
├── server/
│   └── index.ts          ← خادم Express مع BingX API
├── client/
│   ├── src/
│   │   ├── pages/
│   │   │   └── Home.tsx  ← واجهة التداول
│   │   └── index.css
│   └── public/
├── package.json          ← المتطلبات والإعدادات
└── tsconfig.json
```

### الخطوة 2: إنشاء حساب على Render

1. اذهب إلى [https://render.com](https://render.com)
2. سجل حسابًا جديدًا أو تسجيل الدخول
3. انقر على **New +** واختر **Web Service**

### الخطوة 3: ربط مستودع GitHub

1. اختر **GitHub** كمصدر
2. اختر مستودع المشروع (sovereign-master-brain)
3. اختر الفرع الرئيسي (main أو master)

### الخطوة 4: إعدادات النشر

في صفحة إعدادات Render، أدخل التفاصيل التالية:

| الإعداد | القيمة |
|--------|--------|
| **Name** | sovereign-master-brain |
| **Environment** | Node |
| **Build Command** | `pnpm install && pnpm run build` |
| **Start Command** | `pnpm start` |
| **Node Version** | 22 |

### الخطوة 5: إضافة متغيرات البيئة

انقر على **Environment** وأضف المتغيرات التالية:

```
NODE_ENV=production
PORT=3000
```

### الخطوة 6: النشر

1. انقر على **Create Web Service**
2. انتظر حتى ينتهي البناء والنشر (قد يستغرق 5-10 دقائق)
3. ستحصل على URL مثل: `https://sovereign-master-brain.onrender.com`

---

## 🔐 مفاتيح API الآمنة

### ⚠️ تحذير أمني مهم

**لا تضع مفاتيح API الحقيقية في الكود المرئي!**

بدلاً من ذلك، استخدم متغيرات البيئة:

#### تحديث `server/index.ts`:

```typescript
const BINGX_CONFIG = {
  API_KEY: process.env.BINGX_API_KEY || "your-api-key",
  SECRET_KEY: process.env.BINGX_SECRET_KEY || "your-secret-key",
  BASE_URL: "https://open-api.bingx.com",
  SYMBOL: "BTC-USDT",
  LEVERAGE: 10
};
```

#### إضافة المتغيرات في Render:

1. اذهب إلى إعدادات المشروع على Render
2. انقر على **Environment**
3. أضف:
   - `BINGX_API_KEY` = مفتاحك من BingX
   - `BINGX_SECRET_KEY` = مفتاحك السري من BingX

---

## 📡 اختبار الاتصال

بعد النشر، اختبر الاتصال بـ BingX:

```bash
# اختبر جلب الرصيد
curl https://sovereign-master-brain.onrender.com/api/balance

# اختبر جلب السعر
curl https://sovereign-master-brain.onrender.com/api/price
```

يجب أن تحصل على استجابة JSON مثل:

```json
{
  "success": true,
  "balance": 1000.50
}
```

---

## 🛠️ استكشاف الأخطاء

### المشكلة: "Cannot find module 'qs'"

**الحل:** تأكد من تثبيت المتطلبات:
```bash
pnpm install qs @types/qs
```

### المشكلة: "BINGX API Error"

**الحل:** تحقق من:
1. مفاتيح API صحيحة في متغيرات البيئة
2. الاتصال بالإنترنت
3. أن حسابك على BingX نشط وغير محظور

### المشكلة: "Port already in use"

**الحل:** Render يدير المنافذ تلقائيًا. تأكد من استخدام `process.env.PORT`:

```typescript
const port = process.env.PORT || 3000;
```

---

## 📊 مراقبة الأداء

### عرض السجلات على Render:

1. اذهب إلى لوحة التحكم على Render
2. اختر مشروعك
3. انقر على **Logs** لرؤية سجلات التشغيل

### رسائل نجاح متوقعة:

```
🚀 Sovereign Master-Brain running on http://localhost:3000/
📡 Connected to BingX API: https://open-api.bingx.com
```

---

## 🔄 التحديثات والتطوير

### لتحديث الكود:

1. قم بالتعديلات على الكود محليًا
2. ادفع التغييرات إلى GitHub:
   ```bash
   git add .
   git commit -m "تحديث: وصف التغييرات"
   git push origin main
   ```
3. Render سيعيد النشر تلقائيًا

### لإيقاف الخدمة مؤقتًا:

1. اذهب إلى إعدادات المشروع
2. انقر على **Suspend** (يمكنك استئنافها لاحقًا)

---

## 💡 نصائح الإنتاج

1. **استخدم متغيرات البيئة** لجميع المفاتيح الحساسة
2. **فعّل HTTPS** (Render يفعل هذا تلقائيًا)
3. **راقب السجلات** بانتظام للأخطاء
4. **اختبر التداول بكميات صغيرة** قبل التوسع
5. **حافظ على نسخة احتياطية** من مفاتيح API

---

## 📞 الدعم

إذا واجهت مشاكل:

1. تحقق من سجلات Render
2. تحقق من أن BingX API يعمل: [https://bingx-api.github.io/docs-v3/](https://bingx-api.github.io/docs-v3/)
3. اتصل بدعم Render: [https://render.com/support](https://render.com/support)

---

**تم الإنشاء بواسطة:** Sovereign Master-Brain  
**آخر تحديث:** 2026-02-23
