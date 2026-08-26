import { App } from "./app.js";
import { env } from "./config/env.js";
import { MongoAdapter } from "./infrastructure/mongo/mongodb.adapter.js";
import { PostgreSQLAdapter } from "./infrastructure/postgres/postgres.adapter.js";
import { SchemaIngestionInitiator } from "./services/schema.injestion.initiator.js";

const application = new App();

const postgres = new PostgreSQLAdapter();
const mongodb = new MongoAdapter();

const injestionService = new SchemaIngestionInitiator();

const bootstrap = async (): Promise<void> => {
  try {
    await postgres.connect();
    mongodb.connect();

    console.log(`DB: ${postgres.getDatabaseName()} connected!`);

    const server = application.app.listen(env.PORT, () => {
      console.log(`SchemaMind running on port ${env.PORT}`);
    });

    injestionService.start();

    const shutdown = async (): Promise<void> => {
      console.log("Shutting down SchemaMind...");

      server.close(async () => {
        await postgres.disconnect();

        console.log("PostgreSQL disconnected");

        process.exit(0);
      });
    };

    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
  } catch (error) {
    console.error("Failed to start SchemaMind:", error);

    await postgres.disconnect();

    process.exit(1);
  }
};

bootstrap();
