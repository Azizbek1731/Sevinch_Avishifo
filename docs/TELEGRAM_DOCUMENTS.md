# Bemorning Telegram orqali hujjat olishi

Bot lokal API bilan `long polling` orqali ishlaydi. Klinika kompyuteri va API ishlayotgan, internet mavjud paytda hujjatlar botdan olinadi; ochiq domen yoki webhook talab qilinmaydi. Bir bot tokeni bilan bir vaqtda bitta API nusxasi ishlashi kerak.

## Sozlash

Repo ildizidagi lokal `.env` faylida bot egasi bergan qiymatlar yoziladi:

```dotenv
TELEGRAM_ENABLED=true
TELEGRAM_BOT_TOKEN=<BotFather bergan token>
TELEGRAM_BOT_USERNAME=<bot username, @ belgisiz>
SINGLE_CLINIC_MODE=true
TELEGRAM_CLINIC_ID=<klinika ID, ixtiyoriy>
```

API qayta ishga tushiriladi. Token Git’ga kiritilmaydi. Token yo‘q paytda `TELEGRAM_ENABLED=false` qoladi; klinika paneli va PDF yuklash odatdagidek ishlaydi.

`TELEGRAM_CLINIC_ID` bo‘sh bo‘lsa, yagona faol klinika avtomatik tanlanadi. Bir nechta faol klinika bo‘lsa, ID aniq belgilanmaguncha kirish yopiq qoladi. Bitta klinika rejimida bot bemorlar uchun ishlaydi: telefon ulash xodim yoki superadmin hisobini ochmaydi. Alohida bemor veb-kabineti o‘rnida Telegramga kirish sahifasi ko‘rsatiladi; portal OTP va oldin berilgan portal sessiyalari orqali shaxsiy ma’lumot olish yopiladi.

Tasdiqlash kodlari faqat klinikaning o‘z Telegram botidagi ulangan shaxsiy chatga yuboriladi. Telegram’ning «Verification Codes» xizmati ishlatilmaydi; kod SMS yoki dastur jurnaliga yuborilmaydi. Botga ulanmagan hisob avval `/start` orqali o‘z raqamini ulashi kerak. Botga ulanmagan hisob Telegram kodi bilan kira olmaydi. Ikki bosqichli himoya yoqilgan bo‘lsa, botga kod yuborilmagani parolning o‘zi bilan kirishga ruxsat bermaydi. Bemorning bitta klinika rejimidagi bot orqali hujjat olish tartibi o‘zgarmaydi.

## Bemor uchun

1. Botning shaxsiy chatida `/start` bosiladi.
2. «Raqamni yuborish» tugmasidan o‘z telefon raqami yuboriladi. Raqam bemor kartasidagi asosiy telefon bilan mos bo‘lishi kerak. Boshqa odamning kontakti va guruh chatlari qabul qilinmaydi.
3. «Tahlillarim», «UZI natijalarim», «Shifokor xulosalari» yoki «Hujjatlarim» tanlanadi. «Mening ma’lumotlarim» bemorning ismi, karta raqami, asosiy telefoni va tug‘ilgan sanasini ko‘rsatadi.
4. Kerakli hujjat tugmasi bosilganda PDF yoki tasdiqlangan asl fayl yuboriladi. Eski hujjatlar sahifalanadi.
5. `/unlink` orqali bog‘lanish uziladi.

Qo‘lda yozilgan raqam, yuborilgan begona kontakt yoki `user_id` bo‘lmagan kontakt bemorni ulamaydi. Bemorning Telegram raqami klinikada kiritilgan raqamdan farq qilsa, qabulxona asosiy telefonni tekshiradi.

Agar karta hali yaratilmagan bo‘lsa, raqam tasdiqlangan holda saqlanadi. Qabulxona kartani yaratgach yoki telefonni tuzatgach, bemor «Yangilash» yoki `/start` orqali ulanadi — kontaktni qayta yuborishi shart emas. Bitta klinikada bir raqamga bir nechta faol karta topilsa, bot ularning hech birini ko‘rsatmaydi va qabulxonaga yo‘naltiradi. Bir oiladagi turli bemorlarga avtomatik ravishda bir-birining hujjatlarini ochmaydi.

Bot har bir yuklashda amaldagi telefon bog‘lanishi, bemor kartasi va hujjat tasdiqlanganini qayta tekshiradi. Telefon o‘zgarsa, karta o‘chirilsa yoki bog‘lanish uzilsa, eski tugma hujjatga kirish bermaydi. Telefonning qo‘shimcha/emergency maydoni mustaqil bemor kirishini bermaydi.

Telefon boshqa Telegram chatiga qayta ulanganda eski chat yo‘nalishlari bitta tranzaksiyada o‘chiriladi. Navbatda turgan Telegram xabari ham yuborilishidan oldin egasini tekshiradi: eski chatga yetkazilmaydi. Kompyuter qayta ishga tushganda botning kutilayotgan buyruqlari tashlab yuborilmaydi. Klinika kompyuteri, API va internet ishlab turishi kerak.

Laboratoriya natijasi faqat `APPROVED` yoki `DELIVERED` bo‘lganda ochiladi. Tahlilga biriktirilgan fayl ham tasdiqlangan natijaga aniq bog‘langan bo‘lishi kerak; oddiy ishchi ilova bemorga chiqmaydi. UZI va konsultatsiya PDF’i faqat `COMPLETED` xulosadan yaratiladi. Unda tasdiqlagan shifokor, vaqt, hujjat ID’si va mavjud bo‘lsa oxirgi tuzatishning muallifi/vaqti/sababi ko‘rsatiladi.

Bemor tasdiqlangan xulosani olishi uchun yana admin tasdig‘i so‘ralmaydi. Ko‘p klinikali rejimdagi portal va to‘liq kasallik tarixiga alohida ruxsat berish jarayoni `SINGLE_CLINIC_MODE=false` bo‘lganda saqlanadi.

## Tekshirish

Avtomatik testlar Telegram yetkazib berishini mock qiladi; haqiqiy bemorga xabar yubormaydi:

```sh
pnpm --filter @avishifo/api exec vitest run src/modules/notifications/telegram-patient-access.service.spec.ts src/modules/notifications/telegram-patient-flow.spec.ts src/modules/notifications/telegram-document-delivery.spec.ts src/modules/notifications/telegram-recipient-guard.spec.ts src/modules/portal/telegram-only-patient-channel.spec.ts src/modules/portal/portal-otp-recipient.spec.ts src/modules/record-access/record-access-recipient.spec.ts
```
