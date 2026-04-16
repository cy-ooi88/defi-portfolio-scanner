/**
 * UI render facade for summary/table sections.
 */
export function createRenderers({ renderSummary, renderOpenSectionDiagnostics, renderOpenRowsTable }) {
  return {
    renderSummary,
    renderOpenSectionDiagnostics,
    renderOpenRowsTable
  };
}
