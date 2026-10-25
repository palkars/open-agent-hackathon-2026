export type ZetarisErrorKind = "config" | "connection" | "auth" | "query";

export class ZetarisClientError extends Error {
  readonly kind: ZetarisErrorKind;

  constructor(kind: ZetarisErrorKind, message: string) {
    super(message);
    this.name = "ZetarisClientError";
    this.kind = kind;
  }
}

export interface ZetarisColumn {
  name: string;
  type?: string;
}

export interface ZetarisConnection {
  databaseCount: number;
}

export interface ZetarisQueryResult {
  columns: ZetarisColumn[];
  rows: unknown[][];
}
