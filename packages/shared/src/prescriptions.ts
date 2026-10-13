/** Fields needed to display either a legacy prescription or a rich Rp. item. */
export interface PrescriptionFormatItem {
  drugName: string;
  dosage?: string | null;
  strength?: string | null;
  form?: string | null;
  quantity?: string | null;
  route?: string | null;
  frequency?: string | null;
  durationDays?: number | null;
  durationText?: string | null;
  dripRate?: string | null;
  instructions?: string | null;
  combineWithPrevious?: boolean | null;
  sortOrder?: number | null;
}

export interface PrescriptionFormatLabels {
  days: (count: number) => string;
  dripUnit: string;
}

export interface PrescriptionGroupLines {
  components: string[];
  dtd: string;
  signature: string;
  mixed: boolean;
}

/** Keep the supplied prescription order. An initial combined item starts a group. */
export function groupPrescriptionItems<T extends PrescriptionFormatItem>(
  items: readonly T[],
): T[][] {
  const groups: T[][] = [];
  for (const item of items) {
    const previous = groups[groups.length - 1];
    if (item.combineWithPrevious && previous) previous.push(item);
    else groups.push([item]);
  }
  return groups;
}

/**
 * Physician-entered text is preserved. A mixture shares only its first item's
 * dispensing and administration directions; children contribute ingredients.
 */
export function formatPrescriptionGroup(
  group: readonly PrescriptionFormatItem[],
  labels: PrescriptionFormatLabels,
): PrescriptionGroupLines {
  const base = group[0];
  if (!base) return { components: [], dtd: '', signature: '', mixed: false };
  const mixed = group.length > 1;
  const components = group.map((item) => [item.drugName, item.strength].filter(Boolean).join(' '));
  const dispensing: string[] = [];
  if (base.quantity) dispensing.push(`D.t.d. N. ${base.quantity.replace(/^N\.?\s*/i, '')}`);
  if (base.form) dispensing.push(`in ${base.form}`);
  let dtd = dispensing.join(' ');
  if (mixed) dtd = dtd ? `M. ${dtd}` : 'M. D.';
  const duration = base.durationText || (base.durationDays ? labels.days(base.durationDays) : '');
  const drip = base.dripRate ? `${base.dripRate.trim()} ${labels.dripUnit}` : '';
  const signature = [base.dosage, base.route, drip, base.frequency, duration, base.instructions]
    .filter(Boolean)
    .join(', ');
  return { components, dtd, signature, mixed };
}
