/**
 * Portfolio domain facade used by the ESM bridge while incremental extraction continues.
 */
export function createPortfolioFacade({ fetchPortfolio }) {
  return {
    fetchPortfolio
  };
}
