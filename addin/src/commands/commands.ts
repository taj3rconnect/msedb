/* global Office */

Office.onReady(() => {
  // Register function commands
  Office.actions.associate('showTaskpane', showTaskpane);
});

/**
 * Placeholder function command for showing the taskpane.
 * The actual ShowTaskpane action is handled by the manifest Action element.
 * This function is registered for potential future use as an ExecuteFunction command.
 */
function showTaskpane(_event: Office.AddinCommands.Event): void {
  _event.completed();
}
