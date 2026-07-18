# Deploy — AWS EC2 (joriy server: 16.16.120.67)

Server: Ubuntu 26.04, 2 vCPU / 2GB RAM (+4GB swap), eu-north-1 (Stokgolm).
Domen: **crm.avilab.uz** (+ ixtiyoriy `tv.crm.avilab.uz`, `bemor.crm.avilab.uz`).

## Arxitektura — bitta domen, same-origin (muhim)

Frontend va backend **bitta domenda** yashaydi. Alohida domen SHART EMAS va murakkabroq
(CORS + cross-site cookie). Nginx bitta domen ostida yo'naltiradi:

```
https://crm.avilab.uz/            → Next.js staff panel   (127.0.0.1:3000)
https://crm.avilab.uz/api/        → NestJS API            (127.0.0.1:3001)
https://crm.avilab.uz/socket.io/  → Socket.IO (WebSocket) (127.0.0.1:3001)
```

Frontend API'ni **o'zi ochilgan domendan** chaqiradi (`window.location.origin` + `/api`).
Shuning uchun bitta build IP'da ham, `crm.avilab.uz`da ham ishlaydi — muhit uchun qayta
build KERAK EMAS. `NEXT_PUBLIC_API_URL` bo'sh qoldiriladi (same-origin). Faqat API'ni
butunlay boshqa domenga qo'ymoqchi bo'lsangiz to'ldiriladi.

TV displey va bemor portali alohida subdomenlarda (ular ham o'z `/api` + `/socket.io`ни
same-origin oladi):

```
https://tv.crm.avilab.uz/     → TV displey  (127.0.0.1:3002)
https://bemor.crm.avilab.uz/  → bemor portali (127.0.0.1:3003)
```

Boshqa komponentlar: PostgreSQL 18 (localhost:5432) · Redis 8 (localhost:6379) ·
pm2 (4 protsess, server qayta yoqilsa autostart) · Nginx.

- Kod: `/home/ubuntu/avishifo` · Sozlamalar: `.env` (DB parol shu yerda)
- Nginx: `/etc/nginx/sites-available/avishifo` (+ `snippets/avishifo-*.conf`)
- `pm2 ls` · `pm2 logs avishifo-api` · `pm2 restart all`

## DNS sozlamalari (ahost.uz panelida qo'shing)

`avilab.uz` DNS boshqaruvi **ahost.uz**da (NS: rdns1/2/3.ahost.uz). Quyidagi
**A yozuvlarini** qo'shing (apex `avilab.uz` va `www` tegilmaydi):

| Turi | Nomi (host) | Qiymati (IP) | TTL |
|------|-------------|--------------|-----|
| A | `crm` | `16.16.120.67` | 300 (yoki default) |
| A | `tv.crm` | `16.16.120.67` | 300 |
| A | `bemor.crm` | `16.16.120.67` | 300 |

> Agar panel to'liq nom talab qilsa: `crm.avilab.uz`, `tv.crm.avilab.uz`,
> `bemor.crm.avilab.uz`. `tv.crm` / `bemor.crm` ixtiyoriy — faqat crm ham yetadi.

DNS tarqalishi 5 daqiqadan bir necha soatgacha (TTL'ga bog'liq). Tekshirish:
`dig +short crm.avilab.uz` → `16.16.120.67` chiqishi kerak.

## HTTPS (DNS tarqalgach)

crm.avilab.uz serverga ishora qilgach:

```bash
ssh -i ~/avishifo.pem ubuntu@16.16.120.67
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d crm.avilab.uz -d tv.crm.avilab.uz -d bemor.crm.avilab.uz --agree-tos -m siz@email.uz --redirect
# Keyin cookie'ni HTTPS-only qiling:
cd /home/ubuntu/avishifo && sed -i 's/^COOKIE_SECURE=.*/COOKIE_SECURE=true/' .env && pm2 restart avishifo-api --update-env
```

certbot 90 kunda avtomatik yangilaydi (systemd timer o'rnatiladi).

## Yangi versiyani chiqarish (lokal kompyuterdan)

```bash
rsync -az --delete \
  --exclude .git --exclude node_modules --exclude .next --exclude dist --exclude .turbo \
  --exclude .local-run --exclude uploads --exclude .env --exclude .keys \
  --exclude test-results --exclude playwright-report \
  -e "ssh -i ~/avishifo.pem" ./ ubuntu@16.16.120.67:/home/ubuntu/avishifo/

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
  pm2 restart all --update-env'
```

2GB RAMda buildlar KETMA-KET (turbo-parallel emas). Swap OOM'dan himoya qiladi.

## Bir serverda BIR NECHA loyiha (kelajakdagi loyihalaringiz uchun)

Bitta EC2 ko'p loyihaga xizmat qila oladi — nginx `server_name` bo'yicha ajratadi:

1. **Nginx**: har loyihaga alohida server bloki (o'z domeni/subdomeni → o'z portlari).
   Masalan `loyiha2.avilab.uz` → 127.0.0.1:4000 (web), `/api` → 4001.
2. **Portlar**: har loyiha o'z portlarida. AviShifo: 3000-3003. Keyingisi: 4000+.
3. **PostgreSQL**: bitta server, har loyihaga alohida baza + user
   (`sudo -u postgres createdb loyiha2` + alohida rol).
4. **Redis**: bitta server, ammo har loyiha ALOHIDA logik DB ishlatsin, aks holda
   BullMQ/Socket.IO kalitlari to'qnashadi: AviShifo `redis://localhost:6379/0` (default),
   keyingi loyiha `.../1`, `.../2` ...
5. **pm2**: har loyiha o'z `ecosystem.config.js`si bilan; hammasi `pm2 save` bilan
   autostartga qo'shiladi.
6. **RAM**: 2GB — AviShifo'ning o'zi ~600MB (4 Node protsess) + Postgres + Redis.
   Yana loyiha qo'shsangiz **instansiyani kattalashtiring** (t3.small→medium),
   aks holda OOM/sekinlashuv bo'ladi.

## Xavfsizlik — jonli foydalanishdan oldin SHART

1. **Demo parollarni almashtiring** — `Demo123!`/`Admin123!` README'da ochiq.
   Panel → Sozlamalar → Xodimlar.
2. Login demo-panelini o'chiring: `.env`da `NEXT_PUBLIC_DEMO_LOGINS=false` →
   web'ni qayta build + `pm2 restart avishifo-web`.
3. **HTTPS** (yuqorida) — hozir yalang HTTP; parollar shifrsiz ketmoqda.
4. **Backup cron** (README'dagi pg_dump) hali yo'q — jonli ma'lumotlardan oldin yoqing.
5. **O'zRQ-547**: server Shvetsiyada — haqiqiy bemor ma'lumoti uchun O'zbekiston
   hostingi shart (bu server demo/sinov uchun).
