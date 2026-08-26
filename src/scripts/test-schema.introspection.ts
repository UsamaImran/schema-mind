import { PostgreSQLAdapter } from "../infrastructure/postgres/postgres.adapter.js";
import { PostgreSQLSchemaIntrospector } from "../infrastructure/postgres/postgres.schema-introspector.js";

const database = new PostgreSQLAdapter();

try {
  const result = await database.query(`
  SELECT
    current_database() AS database,
    current_user AS user,
    inet_server_addr() AS host,
    inet_server_port() AS port;
`);

  console.log("Connection info:");
  console.dir(result, { depth: null });
  await database.connect();

  const introspector = new PostgreSQLSchemaIntrospector(database);

  const schema = await introspector.getSchema();

  console.dir(schema, {
    depth: null,
  });
} catch (error) {
  console.error("Schema introspection failed:", error);
  process.exitCode = 1;
} finally {
  await database.disconnect();
}
