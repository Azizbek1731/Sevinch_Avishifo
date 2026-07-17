/**
 * Per-clinic service catalog (30 services), packages and the global drug directory.
 * Prices in UZS. Category keys map to ServiceCategory rows created in seed.ts.
 */

export type CategoryKey = "CONSULTATION" | "LAB" | "ULTRASOUND" | "PROCEDURE";

export interface ServiceDef {
  code: string;
  category: CategoryKey;
  uz: string;
  ru: string;
  price: number;
  durationMin: number;
}

export const SERVICE_DEFS: readonly ServiceDef[] = [
  // ---- Konsultatsiya (5)
  { code: "SVC-001", category: "CONSULTATION", uz: "Kardiolog konsultatsiyasi", ru: "Консультация кардиолога", price: 150000, durationMin: 20 },
  { code: "SVC-002", category: "CONSULTATION", uz: "Pediatr konsultatsiyasi", ru: "Консультация педиатра", price: 120000, durationMin: 15 },
  { code: "SVC-003", category: "CONSULTATION", uz: "Nevrolog konsultatsiyasi", ru: "Консультация невролога", price: 130000, durationMin: 15 },
  { code: "SVC-004", category: "CONSULTATION", uz: "Terapevt konsultatsiyasi", ru: "Консультация терапевта", price: 100000, durationMin: 15 },
  { code: "SVC-005", category: "CONSULTATION", uz: "Takroriy konsultatsiya", ru: "Повторная консультация", price: 80000, durationMin: 15 },
  // ---- Laboratoriya (15) — 1:1 bilan LabTest (lab-tests.ts)
  { code: "SVC-006", category: "LAB", uz: "Umumiy qon tahlili", ru: "Общий анализ крови", price: 50000, durationMin: 10 },
  { code: "SVC-007", category: "LAB", uz: "Umumiy siydik tahlili", ru: "Общий анализ мочи", price: 40000, durationMin: 10 },
  { code: "SVC-008", category: "LAB", uz: "Glyukoza (och qoringa)", ru: "Глюкоза (натощак)", price: 30000, durationMin: 5 },
  { code: "SVC-009", category: "LAB", uz: "Umumiy xolesterin", ru: "Общий холестерин", price: 45000, durationMin: 5 },
  { code: "SVC-010", category: "LAB", uz: "ALT (alaninaminotransferaza)", ru: "АЛТ (аланинаминотрансфераза)", price: 35000, durationMin: 5 },
  { code: "SVC-011", category: "LAB", uz: "AST (aspartataminotransferaza)", ru: "АСТ (аспартатаминотрансфераза)", price: 35000, durationMin: 5 },
  { code: "SVC-012", category: "LAB", uz: "Umumiy bilirubin", ru: "Общий билирубин", price: 40000, durationMin: 5 },
  { code: "SVC-013", category: "LAB", uz: "Kreatinin", ru: "Креатинин", price: 35000, durationMin: 5 },
  { code: "SVC-014", category: "LAB", uz: "Mochevina", ru: "Мочевина", price: 35000, durationMin: 5 },
  { code: "SVC-015", category: "LAB", uz: "TTG (tireotrop gormon)", ru: "ТТГ (тиреотропный гормон)", price: 90000, durationMin: 5 },
  { code: "SVC-016", category: "LAB", uz: "Vitamin D (25-OH)", ru: "Витамин D (25-OH)", price: 120000, durationMin: 5 },
  { code: "SVC-017", category: "LAB", uz: "Glikirlangan gemoglobin (HbA1c)", ru: "Гликированный гемоглобин (HbA1c)", price: 110000, durationMin: 5 },
  { code: "SVC-018", category: "LAB", uz: "C-reaktiv oqsil (CRP)", ru: "С-реактивный белок (СРБ)", price: 60000, durationMin: 5 },
  { code: "SVC-019", category: "LAB", uz: "Ferritin", ru: "Ферритин", price: 95000, durationMin: 5 },
  { code: "SVC-020", category: "LAB", uz: "Umumiy oqsil", ru: "Общий белок", price: 40000, durationMin: 5 },
  // ---- UTT (5)
  { code: "SVC-021", category: "ULTRASOUND", uz: "Qorin bo'shlig'i UTT", ru: "УЗИ брюшной полости", price: 150000, durationMin: 30 },
  { code: "SVC-022", category: "ULTRASOUND", uz: "Buyraklar UTT", ru: "УЗИ почек", price: 120000, durationMin: 30 },
  { code: "SVC-023", category: "ULTRASOUND", uz: "Qalqonsimon bez UTT", ru: "УЗИ щитовидной железы", price: 130000, durationMin: 30 },
  { code: "SVC-024", category: "ULTRASOUND", uz: "Exokardiografiya (EXOKG)", ru: "Эхокардиография (ЭхоКГ)", price: 200000, durationMin: 30 },
  { code: "SVC-025", category: "ULTRASOUND", uz: "Kichik chanoq a'zolari UTT", ru: "УЗИ органов малого таза", price: 160000, durationMin: 30 },
  // ---- Muolajalar (5)
  { code: "SVC-026", category: "PROCEDURE", uz: "Mushak ichiga in'ektsiya", ru: "Внутримышечная инъекция", price: 50000, durationMin: 10 },
  { code: "SVC-027", category: "PROCEDURE", uz: "Vena ichiga in'ektsiya", ru: "Внутривенная инъекция", price: 60000, durationMin: 10 },
  { code: "SVC-028", category: "PROCEDURE", uz: "Infuzion terapiya (tomchi dori)", ru: "Инфузионная терапия (капельница)", price: 80000, durationMin: 40 },
  { code: "SVC-029", category: "PROCEDURE", uz: "Elektrokardiografiya (EKG)", ru: "Электрокардиография (ЭКГ)", price: 70000, durationMin: 15 },
  { code: "SVC-030", category: "PROCEDURE", uz: "Bog'lam qo'yish", ru: "Наложение повязки", price: 55000, durationMin: 15 },
];

export interface PackageDef {
  code: string;
  uz: string;
  ru: string;
  /** ~15% cheaper than the sum of item prices */
  price: number;
  serviceCodes: string[];
}

export const PACKAGE_DEFS: readonly PackageDef[] = [
  {
    code: "PKG-001",
    uz: "Check-up standart",
    ru: "Чек-ап стандарт",
    // sum 265 000 → −15%
    price: 225000,
    serviceCodes: ["SVC-004", "SVC-006", "SVC-007", "SVC-008", "SVC-009"],
  },
  {
    code: "PKG-002",
    uz: "Kardiologik tekshiruv paketi",
    ru: "Кардиологический пакет",
    // sum 495 000 → −15%
    price: 420000,
    serviceCodes: ["SVC-001", "SVC-029", "SVC-024", "SVC-009", "SVC-008"],
  },
  {
    code: "PKG-003",
    uz: "Qalqonsimon bez paketi",
    ru: "Пакет щитовидной железы",
    // sum 490 000 → −15%
    price: 415000,
    serviceCodes: ["SVC-004", "SVC-015", "SVC-023", "SVC-006", "SVC-016"],
  },
];

/** Global drug directory (clinicId null): [name, form, strength]. */
export const DRUGS: ReadonlyArray<readonly [string, string, string | null]> = [
  ["Paratsetamol", "tabletka", "500 mg"],
  ["Amoksitsillin", "kapsula", "500 mg"],
  ["Ibuprofen", "tabletka", "400 mg"],
  ["Sitramon P", "tabletka", null],
  ["No-shpa", "tabletka", "40 mg"],
  ["Analgin", "tabletka", "500 mg"],
  ["Aspirin kardio", "tabletka", "100 mg"],
  ["Loratadin", "tabletka", "10 mg"],
  ["Setirizin", "tabletka", "10 mg"],
  ["Suprastin", "tabletka", "25 mg"],
  ["Omeprazol", "kapsula", "20 mg"],
  ["Pantoprazol", "tabletka", "40 mg"],
  ["Famotidin", "tabletka", "40 mg"],
  ["De-nol", "tabletka", "120 mg"],
  ["Maalox", "suspenziya", "250 ml"],
  ["Mezim forte", "tabletka", "10000 TB"],
  ["Festal", "draje", null],
  ["Kreon", "kapsula", "10000 TB"],
  ["Enterosgel", "pasta", "225 g"],
  ["Smekta", "kukun", "3 g"],
  ["Loperamid", "kapsula", "2 mg"],
  ["Linex", "kapsula", null],
  ["Bifidumbakterin", "kukun", "5 doza"],
  ["Regidron", "kukun", "18.9 g"],
  ["Azitromitsin", "tabletka", "500 mg"],
  ["Siprofloksatsin", "tabletka", "500 mg"],
  ["Amoksiklav", "tabletka", "625 mg"],
  ["Sefiksim", "kapsula", "400 mg"],
  ["Metronidazol", "tabletka", "250 mg"],
  ["Flukonazol", "kapsula", "150 mg"],
  ["Atsiklovir", "tabletka", "400 mg"],
  ["Ambroksol", "sirop", "15 mg/5 ml"],
  ["Bromgeksin", "tabletka", "8 mg"],
  ["ACC", "shipuchka tabletka", "200 mg"],
  ["Mukaltin", "tabletka", "50 mg"],
  ["Salbutamol", "aerozol", "100 mkg/doza"],
  ["Berodual", "ingalyatsiya eritmasi", "20 ml"],
  ["Naftizin", "tomchi", "0.1%"],
  ["Otrivin", "sprey", "0.1%"],
  ["Pinosol", "tomchi", "10 ml"],
  ["Validol", "tabletka", "60 mg"],
  ["Korvalol", "tomchi", "25 ml"],
  ["Kaptopril", "tabletka", "25 mg"],
  ["Enalapril", "tabletka", "10 mg"],
  ["Lizinopril", "tabletka", "10 mg"],
  ["Amlodipin", "tabletka", "5 mg"],
  ["Bisoprolol", "tabletka", "5 mg"],
  ["Metoprolol", "tabletka", "50 mg"],
  ["Losartan", "tabletka", "50 mg"],
  ["Atorvastatin", "tabletka", "20 mg"],
  ["Rozuvastatin", "tabletka", "10 mg"],
  ["Metformin", "tabletka", "850 mg"],
  ["Gliklazid MR", "tabletka", "60 mg"],
  ["L-tiroksin", "tabletka", "100 mkg"],
  ["Vitamin D3", "tomchi", "10 ml"],
  ["Magne B6", "tabletka", null],
  ["Askorbin kislotasi", "draje", "50 mg"],
  ["Kalsiy D3", "chaynaladigan tabletka", null],
  ["Diklofenak", "gel", "1%"],
  ["Nimesulid", "kukun", "100 mg"],
];
