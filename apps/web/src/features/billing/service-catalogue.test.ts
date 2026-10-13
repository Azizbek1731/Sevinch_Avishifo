import { describe, expect, it, vi } from 'vitest';
import type { ServiceOption } from './api';
import { searchServiceCatalogue } from './service-catalogue';

const kinds = [
  'LAB',
  'PROCEDURE',
  'DIAGNOSTICS',
  'OTHER',
  'CONSULTATION',
  'ULTRASOUND',
  'SURGERY',
  'MATERIAL',
  'MEDICINE',
] as const;
const catalogue = kinds.map((kind) => ({
  kind,
  service: {
    id: kind,
    code: kind,
    name: { uz: kind },
    currentPrice: '1000.00',
    isActive: true,
  } satisfies ServiceOption,
}));
const searchApi = () =>
  vi.fn(async (_search: string, kind?: (typeof kinds)[number]) => ({
    data: catalogue.filter((entry) => !kind || entry.kind === kind).map((entry) => entry.service),
  }));

describe('reception service catalogues', () => {
  it('never mixes laboratory or doctor services into the procedure workflow', async () => {
    const fetchServices = searchApi();
    const result = await searchServiceCatalogue(fetchServices, '  search  ', {
      proceduresOnly: true,
      excludeSurgery: true,
    });
    expect(result.map((service) => service.id)).toEqual(['PROCEDURE', 'DIAGNOSTICS', 'OTHER']);
    expect(
      fetchServices.mock.calls.every(([search, kind]) => search === 'search' && kind !== undefined),
    ).toBe(true);
  });

  it('laboratory selection uses only LAB even when switching from procedure scope', async () => {
    const fetchServices = searchApi();
    await searchServiceCatalogue(fetchServices, '', { proceduresOnly: true });
    const lab = await searchServiceCatalogue(fetchServices, '', {
      kind: 'LAB',
      proceduresOnly: true,
      excludeSurgery: true,
    });
    expect(lab.map((service) => service.id)).toEqual(['LAB']);
    expect(fetchServices).toHaveBeenLastCalledWith('', 'LAB');
    const procedures = await searchServiceCatalogue(fetchServices, '', { proceduresOnly: true });
    expect(procedures.some((service) => service.id === 'LAB')).toBe(false);
  });

  it('queries every non-surgery kind instead of filtering an unscoped first page', async () => {
    const fetchServices = vi.fn(async (_search: string, kind?: (typeof kinds)[number]) => ({
      data: kind
        ? catalogue.filter((entry) => entry.kind === kind).map((entry) => entry.service)
        : Array.from(
            { length: 20 },
            () => catalogue.find((entry) => entry.kind === 'SURGERY')!.service,
          ),
    }));
    const result = await searchServiceCatalogue(fetchServices, '  gauze  ', {
      excludeSurgery: true,
    });
    expect(result.map((service) => service.id).sort()).toEqual(
      kinds.filter((kind) => kind !== 'SURGERY').sort(),
    );
    expect(fetchServices).toHaveBeenCalledTimes(kinds.length - 1);
    expect(
      fetchServices.mock.calls.every(
        ([search, kind]) => search === 'gauze' && kind !== undefined && kind !== 'SURGERY',
      ),
    ).toBe(true);
  });

  it('preserves the unrestricted catalogue outside the reception workflow', async () => {
    const fetchServices = searchApi();
    const result = await searchServiceCatalogue(fetchServices, '');
    expect(result).toHaveLength(kinds.length);
    expect(fetchServices).toHaveBeenCalledTimes(1);
    expect(fetchServices).toHaveBeenCalledWith('', undefined);
  });
});
