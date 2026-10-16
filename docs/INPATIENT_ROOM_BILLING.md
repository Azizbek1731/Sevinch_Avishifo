# Statsionar palata haqi

## Qabulxona uchun

Bemorni statsionarga yotqizishda palata, o‘rin va **bir kunlik palata narxi** kiritiladi. Bepul joy uchun `0` yoziladi. Saqlash bilan palata haqi kassadagi bemor qarziga qo‘shiladi; qo‘shimcha tasdiqlash talab qilinmaydi.

Kunlar **Toshkent vaqti bo‘yicha kalendar sana** bilan hisoblanadi. Yotqizilgan kun ham, chiqarilgan kun ham kiradi. Masalan, 15-oktabr soat 23:50 da yotqizilib, 16-oktabr soat 00:10 da chiqarilsa, 2 kun hisoblanadi. Shu kunning o‘zida chiqarilsa, 1 kun hisoblanadi.

Kasallik tarixidagi **Palata haqi** kartasida amaldagi kunlik narx, hisoblangan kunlar, jami summa va sanalar bo‘yicha tafsilotlar ko‘rinadi. Narx o‘zgartirilganda avval hisoblangan kunlar o‘z narxini saqlaydi; yangi narx keyingi hisoblanmagan kundan ishlaydi. Palata yoki o‘rin o‘zgarsa ham oldingi kunlardagi joy ma’lumoti saqlanadi.

Avval ochilgan va kunlik narxi belgilanmagan statsionar tarixlar uchun narx ilk bor kiritilganda hisoblash bugundan boshlanadi. Noma’lum eski narx bo‘yicha o‘tgan kunlarga avtomatik qarz yozilmaydi.

## Kassa va chiqarish

Har yangi kalendar kunning haqi bemorning kassadagi to‘lov kutilayotgan hisobiga qo‘shiladi. Bemor avvalgi hisobni qisman yoki to‘liq to‘lagan bo‘lsa, uning to‘lovi o‘zgarmaydi; yangi kun uchun yangi hisob chiqadi. Kassada tanlangan hisoblarni birga to‘lash mumkin.

Bemor chiqarilayotganda chiqarish kunigacha palata haqi tekshiriladi. Yangi qarz aniqlansa, u kassada saqlanadi va to‘lovdan keyin chiqarish yakunlanadi. Mavjud qarz bilan chiqarish huquqi berilgan xodim avvalgi majburiy chiqarish tartibidan foydalanishi mumkin. Chiqarilgan bemorga keyingi kunlar uchun haq yozilmaydi.

Hisoblangan keyingi kunlar mavjud bo‘lsa, chiqarish sanasini ular oldiga qaytarish mumkin emas. Moliyaviy hujjatni tuzatish yoki bekor qilish mavjud kassa tartibi orqali bajariladi; kun hisobini qayta tekshirish bekor qilingan yoki to‘langan kunni takror yaratmaydi.

## Texnik ishlash

- `Admission.dailyRoomRate` kunlik amaldagi narx; `AdmissionRoomCharge` har sananing narxi va joyini alohida saqlaydi. `(admissionId, billingDate)` takrorlanmaydi.
- Yangi yotqizish, kun haqi va chiqarilgan hisob bitta tranzaksiyada yaratiladi. Hisob chiqarish bajarilmasa, ular birga bekor bo‘ladi.
- Server ishga tushganda va har 60 soniyada muddati kelgan statsionarlar tekshiriladi. Bemor tarixi va kassa hisobini ochish ham yangi kunlarni hisoblaydi. Server vaqtincha o‘chiq bo‘lsa, keyingi tekshiruv o‘tgan sanalarni to‘ldiradi.
- Narx va joy o‘zgarishi oldidan eski narx bilan muddati kelgan sanalar hisoblanadi. Kunlar moliyaviy yozuvlar; klinik tayinlovni olingan deb belgilamaydi.
- `20261015090000_admission_calendar_room_fees` migratsiyasi talab qilinadi. Eski yozuvlarga narx yoki qarz avtomatik ko‘chirilmaydi.
- Tekshiruvlar: `room-billing-calendar.spec.ts`, `test/admission-room-fees.e2e-spec.ts` va statsionar regressiya testlari. Integratsion testlar faqat ajratilgan sinov bazasida, Telegram o‘chirilgan holatda ishlatiladi.
