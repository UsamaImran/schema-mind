import type { DatabaseSchema } from "./schema.types.js";

export interface ISchemaIntrospector {
  getSchema(): Promise<DatabaseSchema>;
}
