import { App } from "./app.js";
import { env } from "./config/env.js";
import { MongoAdapter } from "./infrastructure/mongo/mongodb.adapter.js";
import { createDatabaseAdapter } from "./infrastructure/database.adapter.factory.js";
import { createSchemaIntrospector } from "./modules/schema/schema-introspector.factory.js";
import { SchemaIngestionInitiator } from "./services/schema.injestion.initiator.js";
import type { ISqlDatabaseAdapter } from "./interfaces/sql-database.adapter.js";
import { ExecutorFactory } from "./modules/execution/executor.factory.js";
import { PostgresExecutor } from "./modules/execution/postgres.executor.js";

const application = new App();

const dbAdapter: ISqlDatabaseAdapter = createDatabaseAdapter();
const mongodb = new MongoAdapter();
const introspector = createSchemaIntrospector(dbAdapter);
const injestionService = new SchemaIngestionInitiator(dbAdapter, introspector);

// Set up executor factory for query execution
const executorFactory = new ExecutorFactory();

const bootstrap = async (): Promise<void> => {
  try {
    await dbAdapter.connect();
    await mongodb.connect();

    const dbName = dbAdapter.getDatabaseName();
    const dialect = dbAdapter.getDialect();
    console.log(`DB: ${dbName} (${dialect}) connected!`);

    // Register executor for this database
    if (dialect === "postgresql") {
      // Need access to the pool — this is the tricky part
      // Option: expose getPool() from PostgreSQLAdapter
      const pool = (dbAdapter as any).getPool?.() || createPostgresPool();
      executorFactory.register(dbName, dialect, new PostgresExecutor(pool));
    }

    const server = application.app.listen(env.PORT, () => {
      console.log(`SchemaMind running on port ${env.PORT}`);
    });

    await injestionService.start();

    const shutdown = async (): Promise<void> => {
      console.log("Shutting down SchemaMind...");

      server.close(async () => {
        await dbAdapter.disconnect();
        console.log(`${dialect} disconnected`);
        process.exit(0);
      });
    };

    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
  } catch (error) {
    console.error("Failed to start SchemaMind:", error);
    await dbAdapter.disconnect();
    process.exit(1);
  }
};

bootstrap();
function createPostgresPool(): any {
  throw new Error("Function not implemented.");
}
