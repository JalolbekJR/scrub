// Synthetic blocking decoder: terminated by the client before completing.
self.onmessage = () => {
  const start = performance.now();
  while (performance.now() - start < 2000) { /* deliberate synchronous work */ }
  self.postMessage({ findings: [], inspectionFailed: false, metaFieldCount: 0, trailingBytes: 0 });
};
