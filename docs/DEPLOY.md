# Deploy — Airnet, Toshkent (joriy server: 46.8.194.85)

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

- Kod: `/srv/avishifo` · Sozlamalar: `.env` (DB parol shu yerda)
- Nginx: `/etc/nginx/sites-available/avishifo` (+ `snippets/avishifo-*.conf`)
- `pm2 ls` · `pm2 logs avishifo-api` · `pm2 restart all`

## DNS sozlamalari (ahost.uz panelida qo'shing)

`avilab.uz` DNS boshqaruvi **ahost.uz**da (NS: rdns1/2/3.ahost.uz). Quyidagi
**A yozuvlarini** qo'shing (apex `avilab.uz` va `www` tegilmaydi):

| Turi | Nomi (host) | Qiymati (IP) | TTL |
|------|-------------|--------------|-----|
| A | `crm` | `46.8.194.85` | 300 (yoki default) |
| A | `tv.crm` | `46.8.194.85` | 300 |
| A | `bemor.crm` | `46.8.194.85` | 300 |

> Agar panel to'liq nom talab qilsa: `crm.avilab.uz`, `tv.crm.avilab.uz`,
> `bemor.crm.avilab.uz`. `tv.crm` / `bemor.crm` ixtiyoriy — faqat crm ham yetadi.

DNS tarqalishi 5 daqiqadan bir necha soatgacha (TTL'ga bog'liq). Tekshirish:
`dig +short crm.avilab.uz` → `46.8.194.85` chiqishi kerak.

## HTTPS (DNS tarqalgach)

crm.avilab.uz serverga ishora qilgach:

```bash
ssh ubuntu@46.8.194.85
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d crm.avilab.uz -d tv.crm.avilab.uz -d bemor.crm.avilab.uz --agree-tos -m siz@email.uz --redirect
# Keyin cookie'ni HTTPS-only qiling:
cd /srv/avishifo && sed -i 's/^COOKIE_SECURE=.*/COOKIE_SECURE=true/' .env && pm2 restart avishifo-api --update-env
```

certbot 90 kunda avtomatik yangilaydi (systemd timer o'rnatiladi).

## Yangi versiyani chiqarish (lokal kompyuterdan)

Eng oson — deploy skripti (rsync qayta-urinish + **toza build** + restart + tekshiruv):

```bash
./scripts/deploy.sh            # sync + clean-build + restart
./scripts/deploy.sh --migrate  # sxema o'zgargan bo'lsa migratsiya bilan
```

Skript nega **toza build** (`rm -rf dist .next`) qiladi: rsync SSH uzilishida
yarim ko'chishi yoki `nest`/`next` incremental keshi eski `dist`/`.next`ni saqlab
qolib, o'zgarishsiz eski bundle deploy bo'lishi mumkin (bir marta shunday bo'ldi).
Toza build buni butunlay yo'q qiladi.

2GB RAMda buildlar KETMA-KET (turbo-parallel emas). Swap OOM'dan himoya qiladi.
Bu server aloqasi vaqti-vaqti uziladi — skript rsync'ni 5 marta qayta urinadi.

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

## Holat

- ✅ **HTTPS yoqilgan** — Let's Encrypt, `crm/tv.crm/bemor.crm.avilab.uz`, avto-yangilanadi.
  HTTP → HTTPS (301) redirect. `COOKIE_SECURE=true`.
- ✅ Same-origin, 4 pm2 protsess, autostart, DNS ulangan.

## Xavfsizlik — jonli foydalanishdan oldin SHART

1. **Demo parollarni almashtiring** — `Demo123!`/`Admin123!` README'da ochiq.
   Panel → Sozlamalar → Xodimlar.
2. Login demo-panelini o'chiring: `.env`da `NEXT_PUBLIC_DEMO_LOGINS=false` →
   web'ni qayta build + `pm2 restart avishifo-web`.
3. **Backup cron** (README'dagi pg_dump) hali yo'q — jonli ma'lumotlardan oldin yoqing.
4. **O'zRQ-547**: server Shvetsiyada — haqiqiy bemor ma'lumoti uchun O'zbekiston
   hostingi shart (bu server demo/sinov uchun).
