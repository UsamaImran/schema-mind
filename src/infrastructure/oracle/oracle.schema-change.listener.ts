import { createHash } from "node:crypto";
import { BaseSchemaChangeListener } from "../schema-change/base.schema-change.listener.js";
import type { OracleAdapter } from "./oracle.adapter.js";
import { env } from "../../config/env.js";

interface OracleObjectRow {
  [key: string]: unknown;
  OBJECT_NAME: string;
  OBJECT_TYPE: string;
  DDL_TIME: string;
  STATUS: string;
}

interface OracleColumnMetaRow {
  [key: string]: unknown;
  TABLE_NAME: string;
  COLUMN_NAME: string;
  DATA_TYPE: string;
  NULLABLE: string;
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

    // Query all tables and views with their individual DDL timestamps and statuses
    const objectRows = await this.adapter.query<OracleObjectRow>(
      `
      SELECT 
        OBJECT_NAME,
        OBJECT_TYPE,
        NVL(TO_CHAR(LAST_DDL_TIME, 'YYYY-MM-DD"T"HH24:MI:SS'), '') AS DDL_TIME,
        STATUS
      FROM ALL_OBJECTS
      WHERE OWNER = :owner
        AND OBJECT_TYPE IN ('TABLE', 'VIEW')
      ORDER BY OBJECT_NAME
      `,
      [schema],
    );

    // Query column structures to ensure column alterations (add, drop, modify) within the same second are caught
    const columnRows = await this.adapter.query<OracleColumnMetaRow>(
      `
      SELECT 
        TABLE_NAME,
        COLUMN_NAME,
        DATA_TYPE,
        NULLABLE
      FROM ALL_TAB_COLUMNS
      WHERE OWNER = :owner
      ORDER BY TABLE_NAME, COLUMN_ID
      `,
      [schema],
    );

    const hash = createHash("sha256");

    for (const obj of objectRows) {
      hash.update(`${obj.OBJECT_NAME}:${obj.OBJECT_TYPE}:${obj.DDL_TIME}:${obj.STATUS}|`);
    }

    hash.update("---COLUMNS---|");

    for (const col of columnRows) {
      hash.update(`${col.TABLE_NAME}.${col.COLUMN_NAME}:${col.DATA_TYPE}:${col.NULLABLE}|`);
    }

    return hash.digest("hex");
  }
}
