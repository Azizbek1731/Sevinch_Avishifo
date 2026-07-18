# Deploy — AWS EC2 (joriy server: 16.16.120.67)

Server: Ubuntu 26.04, 2 vCPU / 2GB RAM (+4GB swap), eu-north-1 (Stokgolm).

## Joriy arxitektura

```
Internet :80 → Nginx ─┬─ /            → Next.js web        (localhost:3000)
                      ├─ /api/        → NestJS API         (localhost:3001)
                      └─ /socket.io/  → Socket.IO (WS)     (localhost:3001)
          :3002 → TV displey  (security groupda ochilsa)
          :3003 → Bemor portali (security groupda ochilsa)
PostgreSQL 18 (localhost:5432, avishifo/avishifo bazasi) · Redis 8 · pm2 (4 protsess, autostart)
```

- Kod: `/home/ubuntu/avishifo` · Sozlamalar: `/home/ubuntu/avishifo/.env` (DB paroli shu yerda)
- Nginx konfiguratsiyasi: `/etc/nginx/sites-available/avishifo`
- Protsesslar: `pm2 ls` · loglar: `pm2 logs avishifo-api` · restart: `pm2 restart all`
- Server qayta yoqilsa pm2 hammasini o'zi ko'taradi (systemd startup o'rnatilgan).

## Yangi versiyani chiqarish (lokal kompyuterdan)

```bash
# 1. Kodni yuborish
rsync -az --delete \
  --exclude .git --exclude node_modules --exclude .next --exclude dist --exclude .turbo \
  --exclude .local-run --exclude uploads --exclude .env --exclude .keys \
  --exclude test-results --exclude playwright-report \
  -e "ssh -i ~/avishifo.pem" ./ ubuntu@16.16.120.67:/home/ubuntu/avishifo/

# 2. Serverda build + restart
ssh -i ~/avishifo.pem ubuntu@16.16.120.67 '
  cd /home/ubuntu/avishifo &&
  pnpm install --frozen-lockfile &&
  pnpm --filter @avishifo/api db:generate &&
  (cd apps/api && npx prisma migrate deploy) &&
  export NODE_OPTIONS=--max-old-space-size=1536 &&
  pnpm --filter @avishifo/shared build &&
  pnpm --filter @avishifo/api build &&
  pnpm --filter @avishifo/web build &&
  pnpm --filter @avishifo/display build &&
  pnpm --filter @avishifo/portal build &&
  pm2 restart all'
```

Eslatma: 2GB RAMda buildlar KETMA-KET bajarilishi shart (`pnpm build` turbo-parallel emas).

## TV displey va portalni ochish

AWS Console → EC2 → Security Groups → inbound rules → qo'shing:
- Custom TCP **3002** (TV displey) — 0.0.0.0/0
- Custom TCP **3003** (bemor portali) — 0.0.0.0/0

Keyin: `http://16.16.120.67:3002/?token=<TOKEN>` (token: panel → Sozlamalar → Filiallar).

## Xavfsizlik — jonli foydalanishdan oldin SHART

1. **Demo parollarni almashtiring** — `Demo123!`/`Admin123!` README'da ochiq yozilgan.
   Panel → Sozlamalar → Xodimlar orqali yoki har bir foydalanuvchi o'z profili orqali.
2. Login sahifasidagi demo-panelni o'chiring: `.env`da `NEXT_PUBLIC_DEMO_LOGINS=false` → web'ni qayta build + `pm2 restart avishifo-web`.
3. **HTTPS**: domen ulagach `sudo apt install certbot python3-certbot-nginx && sudo certbot --nginx` (hozir yalang IP, shuning uchun TLS yo'q — parollar ochiq HTTP orqali ketadi!).
4. **Backup cron** (README'dagi pg_dump bo'limi) hali o'rnatilmagan — jonli ma'lumotlardan oldin yoqing.
5. **O'zRQ-547**: bu server Shvetsiyada — haqiqiy bemor ma'lumotlari uchun O'zbekistondagi hostingga ko'chirish shart (ushbu server demo/sinov uchun).
