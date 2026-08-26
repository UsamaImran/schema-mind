import { PostgreSQLAdapter } from "../infrastructure/postgres/postgres.adapter.js";
import { PostgreSQLSchemaIntrospector } from "../infrastructure/postgres/postgres.schema-introspector.js";
import { SchemaSemanticBuilder } from "../modules/schema/semantic/schema-semantic.builder.js";

const database = new PostgreSQLAdapter();

try {
  await database.connect();

  const introspector = new PostgreSQLSchemaIntrospector(database);

  const schema = await introspector.getSchema();

  const builder = new SchemaSemanticBuilder();

  const documents = builder.build(schema);

  console.dir(documents, {
    depth: null,
  });
} catch (error) {
  console.error("Schema semantic building failed:", error);

  process.exitCode = 1;
} finally {
  await database.disconnect();
}
