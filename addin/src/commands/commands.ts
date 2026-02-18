/* global Office */

Office.onReady(() => {
  // Register function commands
  // The ribbon button uses ShowTaskpane action (handled by the manifest),
  // not ExecuteFunction. commands.ts is loaded as the FunctionFile referenced
  // in the manifest and provides a noop handler for potential future
  // ExecuteFunction commands.
  Office.actions.associate('noop', noop);
});

/**
 * No-op handler for potential future ExecuteFunction commands.
 * Immediately signals completion to the Office host.
 */
function noop(event: Office.AddinCommands.Event): void {
  event.completed();
}
