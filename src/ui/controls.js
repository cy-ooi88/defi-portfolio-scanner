/**
 * UI controls facade for settings/status interactions.
 */
export function createUiControls({ setBusy, setStatus, openSettings, closeSettings }) {
  return {
    setBusy,
    setStatus,
    openSettings,
    closeSettings
  };
}
