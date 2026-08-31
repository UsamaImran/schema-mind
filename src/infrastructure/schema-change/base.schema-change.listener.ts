import { ISchemaChangeListener } from "../../interfaces/sql-database.adapter.js";

export abstract class BaseSchemaChangeListener implements ISchemaChangeListener {
  protected onChange: () => Promise<void>;
  protected reconnectTimer: NodeJS.Timeout | undefined;

  constructor(onChange: () => Promise<void>) {
    this.onChange = onChange;
  }

  abstract start(): Promise<void>;
  abstract stop(): Promise<void>;

  protected async handleChange(payload?: unknown): Promise<void> {
    try {
      await this.onChange();
    } catch (err) {
      console.error("Re-ingestion failed after schema change:", err);
    }
  }

  protected scheduleReconnect(
    reconnectFn: () => Promise<void>,
    delayMs = 5000,
  ): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      reconnectFn().catch((err) => console.error("Reconnect failed:", err));
    }, delayMs);
  }

  protected clearReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
  }
}
