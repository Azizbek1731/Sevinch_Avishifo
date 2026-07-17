/**
 * Uzbek name pools for deterministic fake-data generation (seed only).
 */

export const MALE_FIRST_NAMES = [
  "Akmal", "Aziz", "Bekzod", "Botir", "Davron", "Dilshod", "Eldor", "Farrux",
  "G'ayrat", "Humoyun", "Islom", "Jasur", "Javohir", "Kamol", "Laziz",
  "Mirjalol", "Muzaffar", "Nodir", "Otabek", "Rustam", "Sanjar", "Sardor",
  "Shavkat", "Sherzod", "Shohruh", "Temur", "Ulug'bek", "Umid", "Zafar", "Zokir",
] as const;

export const FEMALE_FIRST_NAMES = [
  "Aziza", "Barno", "Charos", "Dilnoza", "Dildora", "Feruza", "Gulbahor",
  "Gulnora", "Hilola", "Iroda", "Kamola", "Laylo", "Madina", "Malika",
  "Maftuna", "Mohira", "Nafisa", "Nargiza", "Nilufar", "Nodira", "Oydin",
  "Rayhona", "Sabina", "Sevara", "Shahnoza", "Shirin", "Umida", "Yulduz",
  "Zarina", "Zulfiya",
] as const;

/** Male-form surnames; append "a" for the female form (Karimov -> Karimova). */
export const LAST_NAMES = [
  "Abdullayev", "Ahmedov", "Aliyev", "Azimov", "Bekmurodov", "Berdiyev",
  "Boboyev", "Choriyev", "Ergashev", "Eshonov", "G'aniyev", "Hakimov",
  "Hamidov", "Ibragimov", "Islomov", "Jo'rayev", "Karimov", "Komilov",
  "Latipov", "Mahmudov", "Mirzayev", "Murodov", "Mustafoyev", "Nazarov",
  "Normatov", "Olimov", "Ortiqov", "Qodirov", "Rahimov", "Rashidov",
  "Rasulov", "Ro'ziyev", "Sattorov", "Sodiqov", "Sultonov", "To'rayev",
  "Tursunov", "Usmonov", "Xolmatov", "Yo'ldoshev",
] as const;

/** Tashkent street/district fragments for fake addresses. */
export const TASHKENT_STREETS = [
  "Chilonzor tumani, Bunyodkor shoh ko'chasi",
  "Yunusobod tumani, Amir Temur shoh ko'chasi",
  "Mirzo Ulug'bek tumani, Buyuk ipak yo'li ko'chasi",
  "Yakkasaroy tumani, Shota Rustaveli ko'chasi",
  "Shayxontohur tumani, Navoiy ko'chasi",
  "Mirobod tumani, Afrosiyob ko'chasi",
  "Olmazor tumani, Beruniy ko'chasi",
  "Uchtepa tumani, Qatortol ko'chasi",
  "Sergeli tumani, Yangi Sergeli ko'chasi",
  "Bektemir tumani, Oqqo'rg'on ko'chasi",
  "Chilonzor tumani, Muqimiy ko'chasi",
  "Yunusobod tumani, Bog'ishamol ko'chasi",
  "Mirzo Ulug'bek tumani, Sayram ko'chasi",
  "Shayxontohur tumani, Zulfiyaxonim ko'chasi",
  "Yashnobod tumani, Parkent ko'chasi",
] as const;

/** Common allergy entries (Patient.allergies json). */
export const ALLERGY_POOL = [
  { name: "Penitsillin", severity: "high", note: "Eshakemi toshadi" },
  { name: "Aspirin", severity: "medium", note: "" },
  { name: "Polen (chang)", severity: "medium", note: "Bahorda kuchayadi" },
  { name: "Novokain", severity: "high", note: "" },
  { name: "Asal", severity: "low", note: "" },
  { name: "Tuxum oqi", severity: "medium", note: "" },
] as const;

/** Chronic conditions (uz). */
export const CHRONIC_POOL = [
  "Qandli diabet 2-tur",
  "Arterial gipertenziya",
  "Bronxial astma",
  "Surunkali gastrit",
  "Surunkali pielonefrit",
  "Yurak ishemik kasalligi",
  "Gipotireoz",
] as const;
