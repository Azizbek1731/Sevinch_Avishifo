# Sevinch Avishifo — bitta klinika uchun CRM/HIS

Bu nusxa bitta klinika uchun sozlangan. Klinikani **egasi (CLINIC_OWNER)** va
**administrator (CLINIC_ADMIN)** boshqaradi. Super-admin hisobi va platforma
endpointlari, yangi klinika ro‘yxatdan o‘tishi, pulli tariflar va sinov muddati
cheklovlari bu rejimda o‘chirilgan. Xodim rollari va bemor ma’lumotlarining
klinika bo‘yicha himoyasi saqlangan.

Loyiha brendi **AviShifo**, klinikaning nomi **Sevinch Medical Center**. Chek va tibbiy
hujjatlardagi klinika ma’lumotlari **Sozlamalar → Klinika** profilidan olinadi.
Manzil, telefon, email, STIR va filial ish vaqtini haqiqiy rekvizitlar bilan
to‘ldirish kerak; boshlang‘ich demo qiymatlar klinikaning haqiqiy rekvizitlari emas.
Botning amaldagi havolasi `@AviShifoBot`; demo hisoblarning loginlari o‘zgarmagan.

`SINGLE_CLINIC_MODE=true` (API va seed) va
`NEXT_PUBLIC_SINGLE_CLINIC_MODE=true` (panel) standart qiymatlar.
Faqat ko‘p klinikali SaaS rejimiga qaytish kerak bo‘lsa, ikkisini ham `false` qiling.

Asosiy modullar: bemor kartalari, qabullar, jonli navbat, tashriflar,
kassa va hisob-fakturalar, laboratoriya, statsionar, xodimlar va hisobotlar,
TV navbat ekrani va bemor portali.

## Arxitektura

```
avishifo/
├── apps/
│   ├── api/        NestJS 11 + Prisma 6 + PostgreSQL 16 + Redis 7 + Socket.IO + BullMQ  (port 3001)
│   ├── web/        Next.js 15 — klinika xodimlari paneli     (uz/uz-Cyrl/ru/en)       (port 3000)
│   ├── display/    Next.js — TV navbat ekrani (fullscreen, TTS)                        (port 3002)
│   └── portal/     Next.js — bemor portali + onlayn yozilish (OTP)                     (port 3003)
├── packages/
│   ├── shared/     Zod sxemalar, enumlar, RBAC ruxsatlar, socket eventlar (yagona manba)
│   └── config/     tsconfig presetlari
└── docs/           CONVENTIONS.md (muhandislik qoidalari), DEMO.md (demo ssenariy)
```

- **Tenant izolyatsiyasi** — Prisma client extension har bir so'rovga `clinicId` filtrini avtomatik qo'shadi (AsyncLocalStorage kontekstidan); e2e-testlar bilan isbotlangan.
- **RBAC** — 10 rol, granular `module.action` ruxsatlari, per-user overridelar. Hammasi server tomonda tekshiriladi.
- **Auth** — JWT RS256 (15 min access) + aylanuvchi refresh-token (httpOnly cookie, reuse-detection), Argon2id.
- **Real-time** — Socket.IO (Redis adapter, gorizontal masshtab): navbat, kalendar, lab worklist, bildirishnomalar. WS — faqat transport; haqiqat manbai REST.
- **Pul** — `DECIMAL(14,2)`, wire orqali string. Vaqt — UTC saqlanadi, Asia/Tashkent ko'rsatiladi.

## Ishga tushirish

Talablar: **Node.js 22+**, **pnpm 9** (`npm i -g pnpm@9`). Docker bo'lsa — yaxshi, bo'lmasa ham ishlaydi.

```bash
pnpm install
cp .env.example .env          # kerak bo'lsa tahrirlang
pnpm keys:generate            # JWT RS256 kalitlari (.keys/)
ln -s ../../.env apps/api/.env # Prisma CLI uchun ildizdagi sozlamalar
```

### 1-variant: Docker bilan

```bash
docker compose up -d          # postgres:16 (5432), redis:7, mailhog
# .env dagi DATABASE_URL portini 5432 ga qo'ying
```

### 2-variant: Dockersiz (embedded servislar)

```bash
pnpm dev:services             # embedded PostgreSQL 16 + Redis (alohida terminalda qoladi)
# Diqqat: lokal 5432 band bo'lsa: LOCAL_PG_PORT=5433 pnpm dev:services
# va .env dagi DATABASE_URL ni 5433 ga moslang
```

### Migratsiya, seed, ishga tushirish

```bash
pnpm --filter @avishifo/api exec prisma migrate deploy   # sxema
pnpm db:seed                                             # bitta klinika, super-adminsiz
pnpm dev:clinic                                          # portlarni .env dan oladi
# yoki alohida:
pnpm --filter @avishifo/api dev        # API      → http://localhost:3001  (Swagger: /api/docs)
pnpm --filter @avishifo/web dev        # Panel    → http://localhost:3000
pnpm --filter @avishifo/display dev    # TV ekran → http://localhost:3002
pnpm --filter @avishifo/portal dev     # Portal   → http://localhost:3003
```

### Kundalik mahalliy foydalanish — tezkor rejim

`dev:clinic` kodni o‘zgartirish uchun: sahifa birinchi ochilganda yig‘iladi va sekinroq
ochilishi mumkin. Klinikada foydalanish uchun avval ishlayotgan dev serverlarni
to‘xtating, so‘ng tayyor build bilan ishga tushiring:

```bash
pnpm build:clinic   # barcha ilovalarni ketma-ket oldindan yig‘adi
pnpm start:clinic   # .env dagi portlarda tayyor ilovalarni ishga tushiradi
```

PostgreSQL va Redis ishlayotgan bo‘lishi kerak. Bu buyruqlar ma’lumotlar bazasini
tozalamaydi va demo ma’lumotlarini qayta yaratmaydi. Kod yoki `NEXT_PUBLIC_*`
sozlamalari o‘zgarganda ilovalarni to‘xtatib, `build:clinic` va `start:clinic`ni
qayta bajaring. Ishlayotgan dev yoki tayyor server bilan bir vaqtda build qilmang.

### Konsultatsiyada retsept

Shifokor tashrifidagi **Retseptlar** bo‘limida dorilar, ularning kuchi va shakli,
miqdori, qabul tartibi, davomiyligi va fizioterapiya birgalikda saqlanadi.
Aralashmaga qo‘shilgan dorilar bitta `Rp.` guruhida ko‘rsatiladi; qabul tartibi
guruhning birinchi qatorida yoziladi. Retseptni saqlagandan keyin konsultatsiyani
tasdiqlash mumkin. Tasdiqlangan retsept chop etiladigan hujjat va bemorning
Telegram orqali oladigan xulosasiga ham kiradi.

Mavjud bazaga NodiRetsept namunasi asosidagi 99 ta dori nomini qo‘shish uchun:

```bash
pnpm db:seed-prescription-directory
```

Bu buyruq faqat katalogdagi yetishmayotgan nomlarni qo‘shadi; qayta bajarilganda
dublikat yaratmaydi. Qabul dozasi va davolash tartibini shifokor o‘zi kiritadi.

## Demo loginlar

Barcha demo hisoblar uchun parol: `Demo123!`.

| Rol | Login |
|---|---|
| Egasi | `owner@shifomed.uz` |
| Administrator | `admin@shifomed.uz` |
| Shifokor (kardiolog) | `kardiolog@shifomed.uz` |
| Shifokor (pediatr) | `pediatr@shifomed.uz` |
| Shifokor (nevrolog) | `nevrolog@shifomed.uz` |
| Shifokor (UTT) | `utt@shifomed.uz` |
| Qabulxona | `qabul1@shifomed.uz` |
| Kassir | `kassir@shifomed.uz` |
| Laborant | `labor@shifomed.uz` |

Login sahifasidagi **«Demo hisoblar»** tugmalari formani avtomatik to‘ldiradi.
Super-admin yaratilmaydi. `NEXT_PUBLIC_DEMO_LOGINS=false` bilan demo tugmalarini yashirish mumkin.

**Til:** panel 4 tilda — O'zbekcha (lotin, standart), Ўзбекча (кирилл), Русский, English. Til foydalanuvchi menyusidan (yuqori o'ng burchak) almashtiriladi.

## Bitta klinika: qabulxona va kassa

- **Qabulxona** (`/uz/reception`): bemorni ro‘yxatga oladi, muolaja va tekshiruvlarni tanlab **Kassaga yuborish** orqali hisob yaratadi. Laboratoriya buyurtmasi hisob bilan birga yaratiladi; laborant ish ro‘yxatiga to‘liq to‘lovdan so‘ng tushadi. Qabulxona to‘lov qabul qilmaydi, smena ochmaydi va kassa chiqimi qilmaydi.
- **Statsionar** (`/uz/admissions`): bemorni to‘g‘ridan-to‘g‘ri yotqizish; bemor tarixidagi **Xarajatlar va hisob** bo‘limida katalog xizmati yoki nomi/narxi bilan qo‘shimcha xarajat kiritish. Tanlangan xizmatlar bitta hisobda kassaga yuboriladi. Hisobga kiritilgan xizmat to‘langan degani emas — to‘lov holati hisobda alohida ko‘rinadi.
- **Kassa** (`/uz/cashier`): kassir smenani naqd, karta va Click boshlang‘ich qoldiqlari bilan ochadi. Qabulxona yuborgan hisobni bemor yoki hisob raqami bilan topib, to‘lovni bitta yoki bir nechta usulda qabul qiladi. Kassir bemor va xizmat narxlarini o‘zgartirmaydi.
- **Jarayon ichida yangi bemor**: muolaja, laboratoriya, shifokor qabuli va statsionarga yotqizishda bemor tanlash oynasidan **Yangi bemor qo‘shish** mumkin. Saqlangan bemor avtomatik tanlanadi; tanlangan xizmatlar va boshqa maydonlar saqlanib qoladi. O‘xshash bemor topilsa, mavjud kartani tanlash ham mumkin. Bu amal bemor yaratish huquqi bor xodimlarga ko‘rinadi.
- **Avtomatik chek**: muvaffaqiyatli to‘lovdan so‘ng chek va brauzerning chop etish oynasi avtomatik ochiladi. Qisman to‘lov yangilangan chek beradi; bir nechta usulga bo‘lingan bitta to‘lov uchun bitta chek ochiladi. Chek yuklanmasa, to‘lovni takrorlamasdan **Chekni qayta yuklash** bosiladi. **Chop etish** tugmasi qayta nusxa uchun qoladi. Jismoniy printer va yakuniy chop etish tasdig‘i brauzer/printer sozlamalariga bog‘liq.
- **Chiqimlar** (`/uz/expenses`): kategoriya, sana, summa va qaysi hisobdan chiqqani yoziladi. Uchala usul uchun ochiq smena talab qilinadi. Bekor qilingan chiqim hisob-kitobga kirmaydi.
- **Kun yakuni**: smenani yopishda uchta yakuniy qoldiq kiritiladi, kutilgan summa va tafovut ko‘rsatiladi. Hisobotni chop etish mumkin.
- **Davr hisoboti** (`/uz/reports`): bugun, 7 kun, 30 kun yoki tanlangan davr; naqd/karta/Click kesimida kirim, avans, qaytarish, chiqim va sof harakat. Sana/guruhlash/usul filtri Excel eksportiga ham qo‘llanadi. Kassir faqat moliyaviy hisobotni ko‘radi.
- **Dori va materiallar hisoboti** (`/uz/reports?tab=consumables`): kassadagi **Dori va materiallar** tugmasidan yoki Hisobotlar bo‘limidan ochiladi. Kun/davr, tur va manba bo‘yicha miqdorlar, kiritilgan narxlardagi qiymat hamda Excel hisoboti mavjud. Operatsiya sarflari, katalogdan kiritilgan dori/material xarajatlari va berilgan deb belgilangan tayinlovlar hisoblanadi. Oldindan hisoblangan ko‘p kunlik tayinlovlar alohida ko‘rsatiladi, sarflangan miqdorga qo‘shilmaydi. Turli birliklar qo‘shilmaydi; bu ombor qoldig‘i yoki xarid tannarxi hisoboti emas. Operatsiyadagi qo‘lda kiritilgan sarflar ham olinadi; boshqa umumiy xarajatlarni hisobotga kiritish uchun katalogdagi **Dori** yoki **Material** turini tanlang. To‘lov holati sarf hisobotiga ta’sir qilmaydi.

Smena qoldig‘i = boshlang‘ich qoldiq + to‘lov + avans − qaytarish − chiqim.
Bemorning oldingi avansidan hisob yopish yangi kirim sifatida qayta sanalmaydi.
Davr hisoboti Toshkent vaqti bilan ikkala chegara kunini ham qamrab oladi: to‘lov/avans/qaytarish amaliyot sanasi, chiqim esa kiritilgan hisob sanasi bilan olinadi.
Click bu lokal rejimda kassir tasdiqlaydigan to‘lov usuli; internet provayderidan avtomatik tasdiqlash ishlatilmaydi.

Ruxsatlar o‘zgargandan keyin eski brauzer sessiyasidan chiqib qayta kiring. Bazaga yangi maydonlar `pnpm --filter @avishifo/api db:migrate` bilan qo‘shiladi; mavjud ma’lumotlar o‘chirilmaydi.

## Ambulator qabul: laboratoriya, UZI va konsultatsiya

**Qabulxona** sahifasida bemorni tanlang yoki shu oynadan yangi bemor yarating:

1. **Laboratoriya** — tahlillarni tanlang va kassaga yuboring. Hisob to‘liq to‘langach laborant namuna olinganini belgilaydi. Natijani ko‘rsatkichlar bilan to‘ldiradi yoki PDF/rasm faylini yuklab tahlilga bog‘laydi, so‘ng **Tasdiqlash** bosadi. To‘liq bo‘lmagan tahlil tasdiqlanmaydi.
2. **UZI** — UZI mutaxassisi va tekshiriladigan xizmatlarni tanlang. To‘lovdan so‘ng buyurtma mutaxassisning **To‘langan qabullar** ro‘yxatida chiqadi. Tekshiruv davomida qo‘shimcha organ/xizmat qo‘shilsa alohida hisob kassaga tushadi. Xulosa loyihasini yozish va saqlash mumkin; barcha hisoblar yopilgach tasdiqlanadi. A4 ko‘rinish, ko‘p sahifali chop etish va PDF mavjud.
3. **Shifokor konsultatsiyasi** — shifokor va xizmatni tanlang. To‘lovdan so‘ng shifokor qabulni ochadi, shikoyat, tashxis, dorilar va tavsiyalarni yozadi. Shu bemorning oldingi tasdiqlangan UZI, konsultatsiya va laboratoriya natijalari qabul ichida ko‘rinadi. Yangi tahlil kerak bo‘lsa qabulxona yangi buyurtma va hisob ochadi; tasdiqlangan natija bemor kartasida saqlanadi.

Tasdiqlangan xulosa oddiy tahrirdan himoyalangan; shifokor tuzatishni sababi bilan alohida qayd qiladi. Boshqa davolovchi shifokor oldingi tasdiqlangan xulosalarni o‘qiy oladi, muallif o‘rniga o‘zgartira olmaydi. To‘lanmagan hisobni bekor qilish unga bog‘langan laboratoriya buyurtmasini ham bekor qiladi. Yakunlanmagan tekshiruv bo‘yicha pul qaytarilsa, u bekor qilinganlar ro‘yxatiga o‘tadi va xulosa tasdiqlanmaydi; qayta xizmat uchun yangi buyurtma ochiladi.

Bemor botdagi **Hujjatlarim** orqali tasdiqlangan laboratoriya fayllari va UZI/konsultatsiya PDF’larini oladi. Botni lokal kompyuterda ulash va bemor telefonini tekshirish tartibi: [Telegram hujjatlari](docs/TELEGRAM_DOCUMENTS.md). Token sozlanmaguncha bot o‘chiq qoladi.

Yangi jarayon yangi buyurtmalarga qo‘llanadi. Avvalgi laboratoriya tarixidagi hisobsiz yozuvlar saqlanadi. Statsionar va operatsiyalar ushbu ambulator jarayondan alohida.

### TV-ekranni ulash

Panel → Sozlamalar → Filiallar → «TV displey tokeni» → tokenni ko'chiring → TV brauzerida `http://localhost:3002/?token=<TOKEN>` oching. Ekran WebSocket orqali jonlanadi, chaqiruvlar ovozli e'lon qilinadi (uz/ru TTS).

## Testlar

```bash
pnpm test                                  # unit (vitest): billing math, slotlar, navbat, payroll, utils
pnpm --filter @avishifo/api test:e2e       # API e2e (supertest): auth, tenant-izolyatsiya, qabullar, navbat, to'lovlar
pnpm typecheck && pnpm lint                # strict TS + ESLint (no-any)
E2E_FULL=1 pnpm --filter @avishifo/web test:e2e   # Playwright smoke (stack ishga tushgan bo'lishi kerak)
```

CI (GitHub Actions): lint → typecheck → migrate → unit → e2e → build har push/PR da.

## Zaxira nusxa (backup)

Kunlik `pg_dump` cron (serverda):

```bash
# /etc/cron.d/avishifo-backup — har kuni 02:00 da, 14 kun saqlanadi
0 2 * * * postgres pg_dump -Fc avishifo > /var/backups/avishifo/$(date +\%F).dump && find /var/backups/avishifo -mtime +14 -delete
```

Tiklashni tekshirish (har chorakda kamida bir marta):

```bash
createdb avishifo_restore_test
pg_restore -d avishifo_restore_test /var/backups/avishifo/2026-07-18.dump
psql avishifo_restore_test -c 'SELECT count(*) FROM "Patient";'   # son asl bazaga mos bo'lsin
dropdb avishifo_restore_test
```

## Deploy eslatmalari

- **O'zRQ-547 (shaxsiy ma'lumotlar):** bemorlar ma'lumotlari O'zbekiston hududidagi serverlarda saqlanishi shart — hosting tanlashda hisobga oling. Rozilik (consent) qayd etish tizimda bor (bemor kartasi → Rozilik).
- TLS — Nginx darajasida; API stateless (Redis/Postgres tashqarida) — `api` ni gorizontal masshtablash mumkin (Socket.IO Redis adapteri buni qo'llaydi).
- Sekretlar faqat env orqali (`.env.example` ga qarang); `.keys/` va `.env` hech qachon commitga kirmaydi.
- SMS: `SMS_PROVIDER=eskiz` + Eskiz.uz akkaunt; Telegram: `TELEGRAM_ENABLED=true` + bot token. Ikkalasi ham devda log-rejimda ishlaydi.
- To'lovlar: Payme/Click/Uzum webhook endpointlari imzo tekshiruvi bilan tayyor; jonli rejim uchun merchant kabinetida webhook URL va kalitlarni sozlang. Fiskalizatsiya — `FiscalizationService` interfeys stub (OFD integratsiyasiga tayyor).

## Hujjatlar

- [docs/CONVENTIONS.md](docs/CONVENTIONS.md) — kod qoidalari (modul tuzilishi, tenancy, xatolar, i18n)
- [docs/DEMO.md](docs/DEMO.md) — demo ssenariy va klik-yo'llar
- [DECISIONS.md](DECISIONS.md) — spec doirasidagi qarorlar va sabablari
- Swagger — dev rejimda `http://localhost:3001/api/docs`

## Ma'lum cheklovlar

- Inventar/dorixona (M10) — sxema tayyor, endpoint/UI keyingi bosqichda (spec Phase 4).
- Payme/Click/Uzum — sandbox rejimda; jonli merchant kaliti talab qiladi. Uzum provayderi strukturaviy stub.
- uz-Cyrl tarjimalar avtomatik transliteratsiya qilingan (`scripts/uz-latin-to-cyrillic.mjs`) — matnlar tushunarli, ammo tahririy sayqal berish mumkin.
- AviRadiology integratsiyasi — interfeys nuqtasi rejalashtirilgan (Phase 4), hali implement qilinmagan.
