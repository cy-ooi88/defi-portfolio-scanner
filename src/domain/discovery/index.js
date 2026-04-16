/**
 * Discovery facade for contract-identification pipeline.
 */
export function createDiscoveryFacade(impl) {
  return {
    ...impl
  };
}
