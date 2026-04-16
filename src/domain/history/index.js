/**
 * History facade for transfers/ownership reconstruction pipeline.
 */
export function createHistoryFacade(impl) {
  return {
    ...impl
  };
}
