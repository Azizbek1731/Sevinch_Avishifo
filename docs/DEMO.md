# AviShifo — Demo ssenariy (klik-yo'llar)

Oldindan: stack ishga tushgan (`pnpm dev`), seed bajarilgan (`pnpm db:seed`). Parollar: xodimlar `Demo123!`, super-admin `Admin123!`.

## 1. Qabulxona oqimi (front-desk, spec Phase 1 DoD)

Ikkita brauzer oynasini yonma-yon oching: **(A)** panel `localhost:3000`, **(B)** TV ekran `localhost:3002`.

1. (A) `qabul1@shifomed.uz` bilan kiring → **Qabulxona** sahifasi ochiladi (chapda bugungi qabullar, o'ngda jonli navbat).
2. TV token: **Sozlamalar → Filiallar → Markaziy filial → TV displey tokeni** → nusxalang; (B) da `localhost:3002/?token=<TOKEN>` oching — filialning jonli navbati ko'rinadi.
3. (A) **+ Yangi bemor** — ism, telefon, tug'ilgan sana → saqlang (30 soniyadan tez). Xuddi shu telefon bilan qayta urinib ko'ring — dublikat ogohlantirishi chiqadi.
4. **Navbatga yozish (walk-in)** — bemorni tanlang, shifokor: *Botir Yusupov (kardiolog)* → talon raqami yaratiladi va (B) ekranidagi «NAVBATDA» ro'yxatida paydo bo'ladi.

## 2. Shifokor oqimi

1. Yangi tab: `kardiolog@shifomed.uz` bilan kiring → **Shifokor kabineti**.
2. **Keyingisini chaqirish** → xona tanlang → (B) TV katta talon raqami + xonani ko'rsatadi va ovoz chiqaradi: «Bemor A-00X, 101-xonaga marhamat».
3. **Boshlash** (IN_ROOM) → **Yakunlash** → tashrif formasi ochiladi.
4. Formada: vitallar (bo'y/vazn/AB/puls), SOAP matnlari, **Tashxis** — «gipertenziya» deb qidiring (ICD-10 I10), **Retsept** — dori qo'shing, **Tashrifni yakunlash**.
5. **Chop etish** — A4 xulosani (vrach xulosasi) chop qilish ko'rinishi.

## 3. Kassir oqimi

1. `kassir@shifomed.uz` bilan kiring → **Kassa**.
2. Smena yopiq bo'lsa: **Smena ochish** (boshlang'ich naqd).
3. «To'lov kutilmoqda» ro'yxatidan hisobni tanlang → **To'lov** → summa/usul (Naqd) → tasdiqlang → holat **PAID**, chek chiqarish mumkin.
4. Kun oxiri: **Smenani yopish** → haqiqiy naqdni kiriting → X/Z hisobot (kutilgan vs haqiqiy, farq).

## 4. Laboratoriya oqimi

1. Shifokor tashrifida **Yo'llanma → Laboratoriya** → testlarni tanlang (masalan, Umumiy qon tahlili) → buyurtma yaratiladi.
2. `labor@shifomed.uz` bilan kiring → **Laboratoriya** worklist → buyurtma: **Namuna olindi → Boshlash** → qiymatlarni kiriting (chegaradan tashqarisi avtomatik H/L belgilanadi) → **Tasdiqlash** → **Topshirildi**. Natija formasi chop etiladi.

## 5. Egasi / analitika

`owner@shifomed.uz` → **Boshqaruv paneli**: bugungi tushum, tashriflar, navbatda kutayotganlar (jonli). **Hisobotlar**: tushum dinamikasi, shifokorlar KPI, xizmatlar reytingi — har birida **XLSX** eksport. **Baholashlar**: bemor baholari. **Audit jurnali**: barcha o'zgarishlar kim/qachon.

## 6. Bemor portali

1. `localhost:3003` → telefon kiriting → OTP (dev rejimda kod API logida: `[PORTAL OTP → ...]`).
2. Klinika sahifasi → shifokor → bo'sh slotlar → yozilish → kabinetda qabullar/natijalar/hisoblar.

## 7. Super-admin

`admin@avishifo.uz` → **Klinikalar**: yangi klinika + egasi yaratish, tarif biriktirish, to'xtatish/faollashtirish, feature-flaglar, impersonatsiya (auditga yoziladi). **Tariflar** va **Analitika** bo'limlari.
