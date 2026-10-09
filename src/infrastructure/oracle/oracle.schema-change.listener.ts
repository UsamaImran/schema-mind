import { BaseSchemaChangeListener } from "../schema-change/base.schema-change.listener.js";
import type { OracleAdapter } from "./oracle.adapter.js";
import { env } from "../../config/env.js";

interface OracleFingerprintRow {
  [key: string]: unknown;
  FINGERPRINT: string;
}

export class OracleSchemaChangeListener extends BaseSchemaChangeListener {
  private adapter: OracleAdapter;
  private intervalMs: number;
  private timer: NodeJS.Timeout | undefined;
  private lastFingerprint: string = "";

  constructor(
    adapter: OracleAdapter,
    onChange: () => Promise<void>,
    intervalMs = 30000,
  ) {
    super(onChange);
    this.adapter = adapter;
    this.intervalMs = intervalMs;
  }

  async start(): Promise<void> {
    await this.check();
    this.timer = setInterval(() => this.check(), this.intervalMs);
  }

  async stop(): Promise<void> {
    this.clearReconnect();
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private async check(): Promise<void> {
    try {
      const fingerprint = await this.computeFingerprint();
      if (this.lastFingerprint && this.lastFingerprint !== fingerprint) {
        await this.handleChange();
      }
      this.lastFingerprint = fingerprint;
    } catch (err) {
      console.error("Oracle schema poll failed:", err);
    }
  }

  private async computeFingerprint(): Promise<string> {
    const schema = env.DB_USER.toUpperCase();

    // Query count of objects and the most recent DDL timestamp
    // This isolates DDL modifications from data row (DML) mutations.
    const rows = await this.adapter.query<OracleFingerprintRow>(
      `
      SELECT 
        COUNT(*) || ':' || NVL(TO_CHAR(MAX(LAST_DDL_TIME), 'YYYY-MM-DD"T"HH24:MI:SS'), 'EMPTY') AS FINGERPRINT
      FROM ALL_OBJECTS
      WHERE OWNER = :owner
        AND OBJECT_TYPE IN ('TABLE', 'VIEW')
      `,
      [schema],
    );

    if (rows.length > 0 && rows[0]?.FINGERPRINT) {
      return String(rows[0].FINGERPRINT);
    }

    return "";
  }
}
