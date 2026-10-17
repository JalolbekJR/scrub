export interface DownloadCopy { filename: string; blob: Blob; }

// A completion retry owns output bytes only, never the original document or its
// editing state. Only the verified delivery path may populate this receipt.
export class DownloadReceipt {
  private copy: DownloadCopy | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private expiresAt = 0;
  private readonly onExpire: () => void;
  constructor(onExpire: () => void) { this.onExpire = onExpire; }
  keep(copy: DownloadCopy) {
    this.clear();
    this.copy = copy;
    this.expiresAt = Date.now() + 5 * 60 * 1000;
    this.timer = setTimeout(() => { this.clear(); this.onExpire(); }, 5 * 60 * 1000);
  }
  current() {
    if (this.copy && Date.now() >= this.expiresAt) { this.clear(); this.onExpire(); }
    return this.copy;
  }
  clear() { clearTimeout(this.timer); this.timer = undefined; this.copy = null; this.expiresAt = 0; }
}
