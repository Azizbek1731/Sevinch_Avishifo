# AviShifo logotipi

Brend belgisi — yurak ichida chip. Ranglar CRM palitrasidan olingan
(`#14A5E4 → #0B87C1 → #0A5C8C`, panelning `--primary` rangi atrofida), asl
fayldagi ko'k–siyohrang gradient o'rniga.

**Manba — `svg/` papkasidagi fayllar.** PNG'lar shulardan chiqarilgan; belgini
o'zgartirsangiz, SVG'ni tahrirlab qayta chiqaring:

```bash
pnpm logo:export
```

## Qaysi faylni qachon ishlatish kerak

| Vazifa | Fayl |
|---|---|
| Veb, ilova, hujjat — istalgan o'lcham | `svg/avishifo-mark.svg` |
| 32px dan kichik joylar (favicon, ro'yxat ikonkasi) | `svg/avishifo-mark-simple.svg` |
| Belgi + «AviShifo» yozuvi, yorug' fon | `svg/avishifo-lockup.svg` |
| Belgi + yozuv, qorong'i fon | `svg/avishifo-lockup-dark.svg` |
| Brauzer yorlig'i (eski brauzerlar ham) | `favicon.ico` |
| iOS «asosiy ekranga qo'shish» | `png/apple-touch-icon-180.png` |
| Android/PWA maskable ikonka | `png/maskable-512.png` |
| Telegram/Facebook havola ko'rinishi | `social/og-light-1200x630.png` (yoki `-dark-`) |
| Chop etish, hamkorlar, ilova do'konlari | `png/` dagi kerakli o'lcham |

## Nega ikki xil belgi bor

To'liq belgida chipning oyoqchalari va ichki yurak bor. Taxminan **32px dan
pastda** bu nozik chiziqlar bir-biriga qo'shilib, dog'ga aylanadi — shuning
uchun kichik o'lchamlar uchun soddalashtirilgan variant bor: faqat yurak silueti
va bitta qalin chip kvadrati. `pnpm logo:export` 16/20/24px larni avtomatik
soddalashtirilganidan chiqaradi.

## Nega SVG asosiy

Bir xil belgi brauzer yorlig'ida 16px, kirish sahifasida 56px, TV ekranda esa
undan ham kattaroq bo'lib ko'rinadi. Bitta rasm buni uddalay olmaydi — SVG har
qanday o'lchamda tiniq qoladi va tarmoqqa murojaat qilmaydi (klinikadagi TV
sekin internetda ham darrov chizadi).

Mahsulot ichida belgi rasm sifatida emas, React komponenti sifatida turadi —
`apps/web/src/components/logo.tsx` (`Logo`, `LogoMark`), portalda
`apps/portal/src/components/logo-mark.tsx`. Bu yerdagi fayllar mahsulotdan
tashqarida ishlatish uchun.

## Yozuv haqida

Lockup SVG'da «AviShifo» — jonli matn (Inter / tizim shrifti). Inter o'rnatilmagan
kompyuterda tizim shriftiga tushadi. Jamoadan tashqariga chiqadigan har qanday
narsa uchun (chop etish, hamkorlar, ilova do'konlari) `png/` dagi lockup
fayllarini ishlating — ular bir marta chizilgan va hamma joyda bir xil.

Asl logodagi «Digital health platform» shiori olib tashlangan: u 300px kenglikda
o'qiladi, sidebar yoki favicon o'lchamida esa shunchaki dog'. Kerak bo'lsa uni
alohida matn sifatida qo'shish mumkin.
