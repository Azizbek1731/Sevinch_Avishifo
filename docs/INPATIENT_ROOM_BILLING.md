# Statsionar palata haqi

## Qabulxona uchun

Sozlamalar → **Statsionar palatalar** da 2–4-etaj xonalari kiritiladi: raqam va **bitta o‘rin uchun 24 soatlik narx**.

Bemorni statsionarga yotqizishda katalogdan **xona** tanlanadi. Narx avtomatik olinadi, lekin **kunlik haq avtomatik yozilmaydi**.

Kasallik tarixidagi **Palata hisobi** bo‘limida:

1. **Kun soni** maydoniga 1–31 yoziladi va **Kunlik haq qo‘shish** bosiladi (masalan, birdaniga 3–4 kun).
2. **Qo‘shilgan kunlar** ro‘yxatidan xato qo‘shilgan **oxirgi to‘lanmagan** kunni **Qaytarish** bilan olib tashlash mumkin (ketma-ket, oxiridan).
3. To‘langan kun qaytarilmaydi.

Keyin kassada to‘lov qilinadi (qisman to‘lov ham mumkin).

## Kassa va chiqarish

Qo‘shilgan kunlar to‘lov kutilayotgan hisobda ko‘rinadi.

Chiqarishda avtomatik yangi kun yozilmaydi — faqat oldin qo‘lda qo‘shilgan kunlar hisobga olinadi. Qarz bo‘lsa, avval to‘lov (yoki `admissions.force` bilan majburiy chiqarish).

## Texnik ishlash

- `InpatientRoom` — etaj, raqam, `pricePerDay` (24 soat).
- `Admission.dailyRoomRate` + `roomBillingNextAt` — keyingi qo‘lda qo‘shiladigan davr.
- `POST /admissions/:id/room-charges` — `{ days: 1..31 }` (`admissions.write`).
- `DELETE /admissions/:id/room-charges/:date` — oxirgi to‘lanmagan kunni qaytarish.
- Avtomatik scheduler / reconcile o‘chirilgan.
