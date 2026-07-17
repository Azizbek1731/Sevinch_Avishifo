# AviShifo — Klinikalar uchun CRM/HIS

Multi-tenant SaaS klinika boshqaruv tizimi (practice management + yengil EHR) — O'zbekistondagi xususiy klinikalar uchun. Bitta deployment ko'plab mustaqil klinikalarga (tenantlarga) xizmat qiladi; har bir klinikada filiallar, xodimlar, bemorlar, narxlar to'liq izolyatsiyalangan.

**Asosiy imkoniyatlar:** jonli navbat (WebSocket + TV-ekran + ovozli e'lon) · bemor kartasi va tibbiy tarix · qabullar kalendari va slot-dvijok · SOAP tashriflar, ICD-10, retseptlar · hisob-fakturalar, kassa smenalari, qarzlar, Payme/Click/Uzum (sandbox) · laboratoriya moduli · SMS (Eskiz) + Telegram-bot bildirishnomalari · analitika va XLSX eksport · bemor portali + onlayn yozilish · super-admin panel · to'liq audit-jurnal.

## Arxitektura

```
avishifo/
├── apps/
│   ├── api/        NestJS 11 + Prisma 6 + PostgreSQL 16 + Redis 7 + Socket.IO + BullMQ  (port 3001)
│   ├── web/        Next.js 15 — xodimlar paneli + super-admin (uz/ru/en)               (port 3000)
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
pnpm db:seed                                             # demo ma'lumotlar (2 klinika, 100 bemor...)
pnpm dev                                                 # hammasi birga (turbo)
# yoki alohida:
pnpm --filter @avishifo/api dev        # API      → http://localhost:3001  (Swagger: /api/docs)
pnpm --filter @avishifo/web dev        # Panel    → http://localhost:3000
pnpm --filter @avishifo/display dev    # TV ekran → http://localhost:3002
pnpm --filter @avishifo/portal dev     # Portal   → http://localhost:3003
```

## Demo loginlar (parol hamma uchun: `Demo123!`, super-admin: `Admin123!`)

| Rol | Shifo Med Servis | Nur Klinika |
|---|---|---|
| Egasi | `owner@shifomed.uz` | `owner@nurklinika.uz` |
| Administrator | `admin@shifomed.uz` | `admin@nurklinika.uz` |
| Shifokor (kardiolog) | `kardiolog@shifomed.uz` | `kardiolog@nurklinika.uz` |
| Shifokor (pediatr) | `pediatr@shifomed.uz` | `pediatr@nurklinika.uz` |
| Shifokor (nevrolog) | `nevrolog@shifomed.uz` | `nevrolog@nurklinika.uz` |
| Shifokor (UTT) | `utt@shifomed.uz` | `utt@nurklinika.uz` |
| Qabulxona | `qabul1@shifomed.uz` | `qabul1@nurklinika.uz` |
| Kassir | `kassir@shifomed.uz` | `kassir@nurklinika.uz` |
| Laborant | `labor@shifomed.uz` | `labor@nurklinika.uz` |
| **Super-admin (platforma)** | `admin@avishifo.uz` | — |

Telefon orqali ham kirish mumkin (masalan `+998901000001`). To'liq demo ssenariy (klik-yo'llar): [docs/DEMO.md](docs/DEMO.md).

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
- uz-Cyrl lokalizatsiya — kalitlar tuzilmasi tayyor, tarjimalar kiritilmagan (uz-Latn/ru/en to'liq).
- AviRadiology integratsiyasi — interfeys nuqtasi rejalashtirilgan (Phase 4), hali implement qilinmagan.
