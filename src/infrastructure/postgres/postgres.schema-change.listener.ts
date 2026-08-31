import type { PoolClient } from "pg";
import { BaseSchemaChangeListener } from "../schema-change/base.schema-change.listener.js";
import type { PostgreSQLAdapter } from "./postgres.adapter.js";

export class PostgresSchemaChangeListener extends BaseSchemaChangeListener {
  private client: PoolClient | undefined;
  private adapter: PostgreSQLAdapter;

  constructor(adapter: PostgreSQLAdapter, onChange: () => Promise<void>) {
    super(onChange);
    this.adapter = adapter;
  }

  async start(): Promise<void> {
    // Self-install event trigger if missing (requires CREATE privilege)
    await this.installEventTrigger();

    const pool = this.adapter.getPool() as import("pg").Pool;
    this.client = await pool.connect();

    await this.client.query("LISTEN schema_changes");

    this.client.on("notification", (msg) => {
      console.log("Schema change detected:", msg.payload);
      this.handleChange(msg.payload);
    });

    this.client.on("error", (err) => {
      console.error("PG listener error:", err);
      this.scheduleReconnect(() => this.start());
    });

    this.client.on("end", () => {
      console.warn("PG listener disconnected");
      this.scheduleReconnect(() => this.start());
    });

    console.log("[Postgres] Schema change listener active.");
  }

  async stop(): Promise<void> {
    this.clearReconnect();
    if (this.client) {
      this.client.release();
      this.client = undefined;
    }
  }

  private async installEventTrigger(): Promise<void> {
    try {
      await this.adapter.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_event_trigger WHERE evtname = 'schema_change_trigger'
          ) THEN
            CREATE OR REPLACE FUNCTION schema_change_notify()
            RETURNS event_trigger LANGUAGE plpgsql AS $func$
            BEGIN
              PERFORM pg_notify('schema_changes', json_build_object(
                'command', tg_tag, 'timestamp', now()
              )::text);
            END;
            $func$;

            CREATE EVENT TRIGGER schema_change_trigger
            ON ddl_command_end
            EXECUTE FUNCTION schema_change_notify();
          END IF;
        END $$;
      `);
      console.log("[Postgres] Event trigger installed/verified.");
    } catch (err) {
      console.warn(
        "[Postgres] Could not install event trigger (insufficient privileges?). Listener will not detect schema changes.",
        err,
      );
    }
  }
}
