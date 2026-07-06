/**
 * Render the email summary as a PDF via the browser print dialog.
 * Builds a hidden iframe with a print-friendly document and triggers window.print().
 */
export function printSummary(
  summaryContent: string,
  summaryStats: { total: number; read: number; unread: number; deleted: number } | null,
): void {
  const statsHtml = summaryStats
    ? `<div style="margin-bottom:16px;padding:8px 12px;background:#f5f5f5;border-radius:6px;font-size:14px;color:#555"><strong style="color:#000">${summaryStats.total}</strong> emails today — <span style="color:#16a34a">${summaryStats.read} read</span>, <span style="color:#2563eb">${summaryStats.unread} unread</span></div>`
    : '';
  const printContent = `<!DOCTYPE html><html><head><title>Email Summary</title><style>body{font-family:system-ui,-apple-system,sans-serif;padding:24px;max-width:700px;margin:0 auto}h3{margin-top:16px;margin-bottom:8px}div{padding:2px 0}</style></head><body><h1>Today's Email Summary</h1>${statsHtml}${summaryContent}</body></html>`;
  const iframe = document.createElement('iframe');
  iframe.style.display = 'none';
  document.body.appendChild(iframe);
  iframe.contentDocument?.open();
  iframe.contentDocument?.write(printContent);
  iframe.contentDocument?.close();
  setTimeout(() => {
    iframe.contentWindow?.print();
    setTimeout(() => document.body.removeChild(iframe), 1000);
  }, 250);
}
