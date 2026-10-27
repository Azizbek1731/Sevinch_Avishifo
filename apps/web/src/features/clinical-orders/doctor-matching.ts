import { localizedText } from '@/lib/localized';
import type { ServiceOption } from '@/features/billing/api';

export type DoctorOption = {
  id: string;
  fullName: string;
  specialty: string | null;
};

/** UZI / UTT / ultrasound specialists only. */
export function isUziSpecialty(specialty: string | null | undefined): boolean {
  if (!specialty) return false;
  const value = specialty.toLowerCase();
  return (
    value.includes('uzi') ||
    value.includes('utt') ||
    value.includes('узи') ||
    value.includes('узд') ||
    value.includes('ultrasound')
  );
}

/** Match consultation price row named like "Specialty — Doctor Name". */
export function serviceMatchesDoctor(
  service: ServiceOption,
  doctor: DoctorOption,
  locale: string,
): boolean {
  const title = localizedText(service.name, locale).toLowerCase();
  const fullName = doctor.fullName.trim().toLowerCase();
  if (!fullName) return false;
  if (title.includes(fullName)) return true;
  const parts = fullName.split(/\s+/).filter((part) => part.length > 2);
  if (parts.length === 0) return false;
  const nameHit = parts.every((part) => title.includes(part));
  if (!nameHit) return false;
  if (!doctor.specialty) return true;
  return title.includes(doctor.specialty.trim().toLowerCase());
}

export function findDoctorConsultationService(
  services: ServiceOption[],
  doctor: DoctorOption,
  locale: string,
): ServiceOption | undefined {
  return services.find((service) => serviceMatchesDoctor(service, doctor, locale));
}
