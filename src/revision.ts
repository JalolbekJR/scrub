export interface RevisionToken { documentId: number; revision: number; }

// A token describes editable instructions, not the transient canvas bitmap.
export class DocumentRevision {
  private documentId = 0;
  private revision = 0;
  newDocument() { this.documentId++; this.revision++; }
  change() { this.revision++; }
  token(): RevisionToken { return { documentId: this.documentId, revision: this.revision }; }
  matches(token: RevisionToken): boolean {
    return token.documentId === this.documentId && token.revision === this.revision;
  }
}
