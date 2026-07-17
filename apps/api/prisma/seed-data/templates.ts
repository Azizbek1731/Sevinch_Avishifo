/**
 * Notification templates per clinic: 6 events x (SMS, TELEGRAM) x (uz, ru).
 * Variables: {{patient_name}}, {{time}}, {{clinic_name}}, {{doctor_name}}.
 */

export interface TemplateDef {
  event:
    | "APPOINTMENT_CREATED"
    | "APPOINTMENT_REMINDER_24H"
    | "APPOINTMENT_REMINDER_2H"
    | "LAB_RESULT_READY"
    | "PAYMENT_RECEIPT"
    | "FEEDBACK_REQUEST";
  channel: "SMS" | "TELEGRAM";
  locale: "uz" | "ru";
  body: string;
}

export const NOTIFICATION_TEMPLATE_DEFS: readonly TemplateDef[] = [
  // ---- APPOINTMENT_CREATED
  {
    event: "APPOINTMENT_CREATED",
    channel: "SMS",
    locale: "uz",
    body: "Hurmatli {{patient_name}}! Siz {{clinic_name}} klinikasida {{doctor_name}} qabuliga yozildingiz. Vaqt: {{time}}.",
  },
  {
    event: "APPOINTMENT_CREATED",
    channel: "SMS",
    locale: "ru",
    body: "Уважаемый(ая) {{patient_name}}! Вы записаны в клинику {{clinic_name}} к врачу {{doctor_name}}. Время: {{time}}.",
  },
  {
    event: "APPOINTMENT_CREATED",
    channel: "TELEGRAM",
    locale: "uz",
    body: "Hurmatli {{patient_name}}!\n{{clinic_name}} klinikasida {{doctor_name}} qabuliga muvaffaqiyatli yozildingiz.\nQabul vaqti: {{time}}.\nIltimos, 10 daqiqa oldin yetib keling.",
  },
  {
    event: "APPOINTMENT_CREATED",
    channel: "TELEGRAM",
    locale: "ru",
    body: "Уважаемый(ая) {{patient_name}}!\nВы успешно записаны в клинику {{clinic_name}} к врачу {{doctor_name}}.\nВремя приёма: {{time}}.\nПожалуйста, приходите за 10 минут до начала.",
  },
  // ---- APPOINTMENT_REMINDER_24H
  {
    event: "APPOINTMENT_REMINDER_24H",
    channel: "SMS",
    locale: "uz",
    body: "Eslatma: ertaga {{time}} da {{clinic_name}} klinikasida {{doctor_name}} qabuli. Kelolmasangiz, iltimos oldindan xabar bering.",
  },
  {
    event: "APPOINTMENT_REMINDER_24H",
    channel: "SMS",
    locale: "ru",
    body: "Напоминание: завтра в {{time}} приём у {{doctor_name}} в клинике {{clinic_name}}. Если не сможете прийти, сообщите заранее.",
  },
  {
    event: "APPOINTMENT_REMINDER_24H",
    channel: "TELEGRAM",
    locale: "uz",
    body: "Eslatma!\nHurmatli {{patient_name}}, ertaga {{time}} da {{clinic_name}} klinikasida {{doctor_name}} qabuliga yozilgansiz.\nBekor qilish uchun qabulxonaga qo'ng'iroq qiling.",
  },
  {
    event: "APPOINTMENT_REMINDER_24H",
    channel: "TELEGRAM",
    locale: "ru",
    body: "Напоминание!\nУважаемый(ая) {{patient_name}}, завтра в {{time}} вы записаны к врачу {{doctor_name}} в клинике {{clinic_name}}.\nДля отмены позвоните в регистратуру.",
  },
  // ---- APPOINTMENT_REMINDER_2H
  {
    event: "APPOINTMENT_REMINDER_2H",
    channel: "SMS",
    locale: "uz",
    body: "{{patient_name}}, bugun {{time}} da {{doctor_name}} qabuli. {{clinic_name}} sizni kutadi!",
  },
  {
    event: "APPOINTMENT_REMINDER_2H",
    channel: "SMS",
    locale: "ru",
    body: "{{patient_name}}, сегодня в {{time}} приём у {{doctor_name}}. Клиника {{clinic_name}} ждёт вас!",
  },
  {
    event: "APPOINTMENT_REMINDER_2H",
    channel: "TELEGRAM",
    locale: "uz",
    body: "Qabulingizga 2 soat qoldi.\n{{doctor_name}} qabuli bugun {{time}} da, {{clinic_name}} klinikasida.\nO'zingiz bilan pasportingizni olishni unutmang.",
  },
  {
    event: "APPOINTMENT_REMINDER_2H",
    channel: "TELEGRAM",
    locale: "ru",
    body: "До вашего приёма осталось 2 часа.\nПриём у {{doctor_name}} сегодня в {{time}}, клиника {{clinic_name}}.\nНе забудьте взять с собой паспорт.",
  },
  // ---- LAB_RESULT_READY
  {
    event: "LAB_RESULT_READY",
    channel: "SMS",
    locale: "uz",
    body: "{{patient_name}}, tahlil natijalaringiz tayyor. {{clinic_name}} qabulxonasidan olishingiz mumkin.",
  },
  {
    event: "LAB_RESULT_READY",
    channel: "SMS",
    locale: "ru",
    body: "{{patient_name}}, результаты ваших анализов готовы. Их можно получить в регистратуре клиники {{clinic_name}}.",
  },
  {
    event: "LAB_RESULT_READY",
    channel: "TELEGRAM",
    locale: "uz",
    body: "Tahlil natijalari tayyor!\nHurmatli {{patient_name}}, laboratoriya natijalaringiz shifokor tomonidan tasdiqlandi.\nNatijalarni bemor portalida ko'rishingiz yoki {{clinic_name}} qabulxonasidan olishingiz mumkin.",
  },
  {
    event: "LAB_RESULT_READY",
    channel: "TELEGRAM",
    locale: "ru",
    body: "Результаты анализов готовы!\nУважаемый(ая) {{patient_name}}, ваши лабораторные результаты подтверждены врачом.\nИх можно посмотреть в портале пациента или получить в регистратуре клиники {{clinic_name}}.",
  },
  // ---- PAYMENT_RECEIPT
  {
    event: "PAYMENT_RECEIPT",
    channel: "SMS",
    locale: "uz",
    body: "{{clinic_name}}: to'lovingiz qabul qilindi. Ishonchingiz uchun rahmat, {{patient_name}}!",
  },
  {
    event: "PAYMENT_RECEIPT",
    channel: "SMS",
    locale: "ru",
    body: "{{clinic_name}}: ваш платёж принят. Спасибо за доверие, {{patient_name}}!",
  },
  {
    event: "PAYMENT_RECEIPT",
    channel: "TELEGRAM",
    locale: "uz",
    body: "To'lov qabul qilindi.\nHurmatli {{patient_name}}, {{clinic_name}} klinikasidagi to'lovingiz muvaffaqiyatli amalga oshirildi.\nElektron chek ilovada mavjud. Sog' bo'ling!",
  },
  {
    event: "PAYMENT_RECEIPT",
    channel: "TELEGRAM",
    locale: "ru",
    body: "Платёж принят.\nУважаемый(ая) {{patient_name}}, ваш платёж в клинике {{clinic_name}} успешно проведён.\nЭлектронный чек доступен в приложении. Будьте здоровы!",
  },
  // ---- FEEDBACK_REQUEST
  {
    event: "FEEDBACK_REQUEST",
    channel: "SMS",
    locale: "uz",
    body: "{{patient_name}}, {{clinic_name}} xizmatidan mamnunmisiz? {{doctor_name}} qabulini 1-5 ball bilan baholang.",
  },
  {
    event: "FEEDBACK_REQUEST",
    channel: "SMS",
    locale: "ru",
    body: "{{patient_name}}, довольны ли вы обслуживанием в клинике {{clinic_name}}? Оцените приём у {{doctor_name}} от 1 до 5.",
  },
  {
    event: "FEEDBACK_REQUEST",
    channel: "TELEGRAM",
    locale: "uz",
    body: "Fikringiz biz uchun muhim!\nHurmatli {{patient_name}}, bugun {{clinic_name}} klinikasida {{doctor_name}} qabulida bo'ldingiz.\nXizmat sifatini 1 dan 5 gacha baholab, izoh qoldiring.",
  },
  {
    event: "FEEDBACK_REQUEST",
    channel: "TELEGRAM",
    locale: "ru",
    body: "Ваше мнение важно для нас!\nУважаемый(ая) {{patient_name}}, сегодня вы были на приёме у {{doctor_name}} в клинике {{clinic_name}}.\nОцените качество обслуживания от 1 до 5 и оставьте комментарий.",
  },
];
