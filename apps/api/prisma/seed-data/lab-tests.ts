/**
 * 15 lab tests per clinic, each linked 1:1 to the matching LAB service
 * (serviceCode). Parameter reference ranges follow the schema json:
 * [{ gender?: "MALE"|"FEMALE", low, high }]
 */

export interface LabParamDef {
  name: string;
  unit: string | null;
  ranges: Array<{ gender?: "MALE" | "FEMALE"; low: number; high: number }>;
  /** For qualitative parameters (no numeric range) — value used in results. */
  textValue?: string;
}

export interface LabTestDef {
  code: string;
  serviceCode: string;
  uz: string;
  ru: string;
  specimenType: string;
  parameters: LabParamDef[];
}

export const LAB_TEST_DEFS: readonly LabTestDef[] = [
  {
    code: "LT-001",
    serviceCode: "SVC-006",
    uz: "Umumiy qon tahlili",
    ru: "Общий анализ крови",
    specimenType: "blood",
    parameters: [
      { name: "Gemoglobin", unit: "g/l", ranges: [{ gender: "MALE", low: 130, high: 160 }, { gender: "FEMALE", low: 120, high: 140 }] },
      { name: "Eritrotsitlar", unit: "10^12/l", ranges: [{ gender: "MALE", low: 4.0, high: 5.5 }, { gender: "FEMALE", low: 3.5, high: 4.7 }] },
      { name: "Leykotsitlar", unit: "10^9/l", ranges: [{ low: 4.0, high: 9.0 }] },
      { name: "Trombotsitlar", unit: "10^9/l", ranges: [{ low: 150, high: 400 }] },
      { name: "ECHT", unit: "mm/soat", ranges: [{ gender: "MALE", low: 1, high: 10 }, { gender: "FEMALE", low: 2, high: 15 }] },
      { name: "Gematokrit", unit: "%", ranges: [{ gender: "MALE", low: 39, high: 49 }, { gender: "FEMALE", low: 35, high: 45 }] },
    ],
  },
  {
    code: "LT-002",
    serviceCode: "SVC-007",
    uz: "Umumiy siydik tahlili",
    ru: "Общий анализ мочи",
    specimenType: "urine",
    parameters: [
      { name: "Rangi", unit: null, ranges: [], textValue: "somon sariq" },
      { name: "Tiniqligi", unit: null, ranges: [], textValue: "tiniq" },
      { name: "Solishtirma og'irlik", unit: null, ranges: [{ low: 1.01, high: 1.025 }] },
      { name: "pH", unit: null, ranges: [{ low: 5.0, high: 7.0 }] },
      { name: "Oqsil", unit: "g/l", ranges: [{ low: 0, high: 0.033 }] },
      { name: "Leykotsitlar", unit: "k/m", ranges: [{ low: 0, high: 5 }] },
    ],
  },
  {
    code: "LT-003",
    serviceCode: "SVC-008",
    uz: "Glyukoza (och qoringa)",
    ru: "Глюкоза (натощак)",
    specimenType: "blood",
    parameters: [{ name: "Glyukoza", unit: "mmol/l", ranges: [{ low: 3.3, high: 5.5 }] }],
  },
  {
    code: "LT-004",
    serviceCode: "SVC-009",
    uz: "Umumiy xolesterin",
    ru: "Общий холестерин",
    specimenType: "blood",
    parameters: [{ name: "Umumiy xolesterin", unit: "mmol/l", ranges: [{ low: 3.0, high: 5.2 }] }],
  },
  {
    code: "LT-005",
    serviceCode: "SVC-010",
    uz: "ALT",
    ru: "АЛТ",
    specimenType: "blood",
    parameters: [{ name: "ALT", unit: "U/l", ranges: [{ gender: "MALE", low: 0, high: 41 }, { gender: "FEMALE", low: 0, high: 33 }] }],
  },
  {
    code: "LT-006",
    serviceCode: "SVC-011",
    uz: "AST",
    ru: "АСТ",
    specimenType: "blood",
    parameters: [{ name: "AST", unit: "U/l", ranges: [{ gender: "MALE", low: 0, high: 40 }, { gender: "FEMALE", low: 0, high: 32 }] }],
  },
  {
    code: "LT-007",
    serviceCode: "SVC-012",
    uz: "Umumiy bilirubin",
    ru: "Общий билирубин",
    specimenType: "blood",
    parameters: [
      { name: "Umumiy bilirubin", unit: "mkmol/l", ranges: [{ low: 5, high: 21 }] },
      { name: "To'g'ri bilirubin", unit: "mkmol/l", ranges: [{ low: 0, high: 5.1 }] },
    ],
  },
  {
    code: "LT-008",
    serviceCode: "SVC-013",
    uz: "Kreatinin",
    ru: "Креатинин",
    specimenType: "blood",
    parameters: [{ name: "Kreatinin", unit: "mkmol/l", ranges: [{ gender: "MALE", low: 62, high: 106 }, { gender: "FEMALE", low: 44, high: 80 }] }],
  },
  {
    code: "LT-009",
    serviceCode: "SVC-014",
    uz: "Mochevina",
    ru: "Мочевина",
    specimenType: "blood",
    parameters: [{ name: "Mochevina", unit: "mmol/l", ranges: [{ low: 2.5, high: 8.3 }] }],
  },
  {
    code: "LT-010",
    serviceCode: "SVC-015",
    uz: "TTG",
    ru: "ТТГ",
    specimenType: "blood",
    parameters: [{ name: "TTG", unit: "mIU/l", ranges: [{ low: 0.4, high: 4.0 }] }],
  },
  {
    code: "LT-011",
    serviceCode: "SVC-016",
    uz: "Vitamin D (25-OH)",
    ru: "Витамин D (25-OH)",
    specimenType: "blood",
    parameters: [{ name: "25-OH vitamin D", unit: "ng/ml", ranges: [{ low: 30, high: 100 }] }],
  },
  {
    code: "LT-012",
    serviceCode: "SVC-017",
    uz: "HbA1c",
    ru: "HbA1c",
    specimenType: "blood",
    parameters: [{ name: "HbA1c", unit: "%", ranges: [{ low: 4.0, high: 6.0 }] }],
  },
  {
    code: "LT-013",
    serviceCode: "SVC-018",
    uz: "C-reaktiv oqsil (CRP)",
    ru: "С-реактивный белок",
    specimenType: "blood",
    parameters: [{ name: "CRP", unit: "mg/l", ranges: [{ low: 0, high: 5 }] }],
  },
  {
    code: "LT-014",
    serviceCode: "SVC-019",
    uz: "Ferritin",
    ru: "Ферритин",
    specimenType: "blood",
    parameters: [{ name: "Ferritin", unit: "ng/ml", ranges: [{ gender: "MALE", low: 30, high: 400 }, { gender: "FEMALE", low: 13, high: 150 }] }],
  },
  {
    code: "LT-015",
    serviceCode: "SVC-020",
    uz: "Umumiy oqsil",
    ru: "Общий белок",
    specimenType: "blood",
    parameters: [
      { name: "Umumiy oqsil", unit: "g/l", ranges: [{ low: 64, high: 83 }] },
      { name: "Albumin", unit: "g/l", ranges: [{ low: 35, high: 52 }] },
    ],
  },
];
