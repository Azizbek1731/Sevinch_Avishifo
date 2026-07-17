import type { NotificationEvent } from '@avishifo/shared';

/** Languages the built-in fallback templates are provided in. */
export type TemplateLang = 'uz' | 'ru';

/** Map any clinic locale to a fallback template language (uz-Cyrl/en → uz). */
export function templateLang(locale: string): TemplateLang {
  return locale === 'ru' ? 'ru' : 'uz';
}

/** Substitute {{variable}} placeholders; unknown variables are left as-is. */
export function renderTemplate(body: string, vars: Record<string, string>): string {
  return body.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key: string) => vars[key] ?? match);
}

/**
 * Built-in fallback bodies used when the clinic has no NotificationTemplate
 * row for (event, channel, locale). Variables: {{patient_name}}, {{doctor_name}},
 * {{time}}, {{clinic_name}}, {{ticket_number}}, {{amount}}, {{link}}.
 */
export const DEFAULT_TEMPLATES: Record<NotificationEvent, Record<TemplateLang, string>> = {
  APPOINTMENT_CREATED: {
    uz: "Hurmatli {{patient_name}}, siz {{time}} da {{clinic_name}} da {{doctor_name}} qabuliga yozildingiz.",
    ru: 'Уважаемый(ая) {{patient_name}}, вы записаны на приём к {{doctor_name}} в {{clinic_name}} на {{time}}.',
  },
  APPOINTMENT_REMINDER_24H: {
    uz: 'Hurmatli {{patient_name}}, ertaga soat {{time}} da {{clinic_name}} da qabulingiz bor.',
    ru: 'Уважаемый(ая) {{patient_name}}, напоминаем: завтра в {{time}} у вас приём в {{clinic_name}}.',
  },
  APPOINTMENT_REMINDER_2H: {
    uz: 'Hurmatli {{patient_name}}, bugun soat {{time}} da {{clinic_name}} da qabulingiz bor.',
    ru: 'Уважаемый(ая) {{patient_name}}, напоминаем: сегодня в {{time}} у вас приём в {{clinic_name}}.',
  },
  APPOINTMENT_CANCELLED: {
    uz: "Hurmatli {{patient_name}}, {{time}} dagi qabulingiz bekor qilindi. Ma'lumot uchun: {{clinic_name}}.",
    ru: 'Уважаемый(ая) {{patient_name}}, ваш приём на {{time}} отменён. Справки: {{clinic_name}}.',
  },
  QUEUE_TURN_NEAR: {
    uz: 'Hurmatli {{patient_name}}, navbatingiz yaqinlashdi ({{ticket_number}}). Iltimos, kabinet yoniga keling.',
    ru: 'Уважаемый(ая) {{patient_name}}, ваша очередь приближается ({{ticket_number}}). Пожалуйста, подойдите к кабинету.',
  },
  LAB_RESULT_READY: {
    uz: 'Hurmatli {{patient_name}}, tahlil natijalaringiz tayyor. {{clinic_name}}.',
    ru: 'Уважаемый(ая) {{patient_name}}, ваши результаты анализов готовы. {{clinic_name}}.',
  },
  PAYMENT_RECEIPT: {
    uz: "Hurmatli {{patient_name}}, {{amount}} so'mlik to'lovingiz qabul qilindi. Rahmat! {{clinic_name}}.",
    ru: 'Уважаемый(ая) {{patient_name}}, ваш платёж на сумму {{amount}} сум принят. Спасибо! {{clinic_name}}.',
  },
  BIRTHDAY: {
    uz: "Hurmatli {{patient_name}}, tug'ilgan kuningiz muborak bo'lsin! Sog'lik va baxt tilaymiz. {{clinic_name}} jamoasi.",
    ru: 'Уважаемый(ая) {{patient_name}}, поздравляем вас с днём рождения! Желаем здоровья и счастья. Команда {{clinic_name}}.',
  },
  DEBT_REMINDER: {
    uz: "Hurmatli {{patient_name}}, {{clinic_name}} oldida {{amount}} so'm qarzingiz mavjud. Iltimos, to'lovni amalga oshiring.",
    ru: 'Уважаемый(ая) {{patient_name}}, у вас имеется задолженность {{amount}} сум перед {{clinic_name}}. Пожалуйста, произведите оплату.',
  },
  FEEDBACK_REQUEST: {
    uz: 'Hurmatli {{patient_name}}, {{clinic_name}} xizmatini baholashingizni so‘raymiz: {{link}}',
    ru: 'Уважаемый(ая) {{patient_name}}, пожалуйста, оцените обслуживание в {{clinic_name}}: {{link}}',
  },
};
