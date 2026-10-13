import { ServiceKind } from '@avishifo/shared';
import type { billingApi, ServiceOption } from './api';

type CatalogueKind = NonNullable<Parameters<typeof billingApi.searchServices>[1]>;
type CatalogueSearch = (search: string, kind?: CatalogueKind) => Promise<{ data: ServiceOption[] }>;

/** Query each allowed kind so excluded kinds cannot consume the first results page. */
export async function searchServiceCatalogue(
  fetchServices: CatalogueSearch,
  search: string,
  options: { kind?: CatalogueKind; proceduresOnly?: boolean; excludeSurgery?: boolean } = {},
): Promise<ServiceOption[]> {
  const kinds: readonly (CatalogueKind | undefined)[] = options.kind
    ? [options.kind]
    : options.proceduresOnly
      ? ['PROCEDURE', 'DIAGNOSTICS', 'OTHER']
      : options.excludeSurgery
        ? Object.values(ServiceKind).filter((kind) => kind !== 'SURGERY')
        : [undefined];
  const allowedKinds = options.excludeSurgery ? kinds.filter((kind) => kind !== 'SURGERY') : kinds;
  const results = await Promise.all(allowedKinds.map((kind) => fetchServices(search.trim(), kind)));
  return results.flatMap((result) => result.data);
}
