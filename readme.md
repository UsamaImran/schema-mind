# Schema Mind

Schema Mind is a schema-aware Retrieval-Augmented Generation (RAG) system that converts natural-language questions into SQL. It introspects a live PostgreSQL database, embeds its schema into MongoDB Atlas, and retrieves the most relevant tables for a question using a hybrid of vector search, keyword search, and foreign-key graph traversal — then hands that context to Gemini to generate the SQL.

## Architecture

```
                         ┌──────────────────────┐
                         │       User            │
                         │ "Show top 5 films"    │
                         └──────────┬────────────┘
                                    │
                                    ▼
                         ┌──────────────────────┐
                         │   API / Controller    │
                         │                       │
                         │ question              │
                         │ databaseName          │
                         └──────────┬────────────┘
                                    │
                                    ▼
                  ┌─────────────────────────────────┐
                  │       Schema Retrieval           │
                  │                                  │
                  │         ┌─────────────┐          │
                  │         │ Query        │         │
                  │         │ Processing   │         │
                  │         └──────┬───────┘         │
                  │                │                 │
                  │        ┌───────┴────────┐        │
                  │        ▼                ▼        │
                  │   Semantic Search   Keyword       │
                  │        │             Search       │
                  │        └───────┬────────┘         │
                  │                ▼                  │
                  │         Hybrid / RRF               │
                  │                │                  │
                  │                ▼                  │
                  │        Graph Expansion             │
                  │                │                  │
                  │                ▼                  │
                  │          Final Ranking             │
                  └────────────────┬────────────────┘
                                   │
                                   ▼
                         ┌──────────────────────┐
                         │  Retrieved Schema     │
                         │                       │
                         │ film                  │
                         │ inventory             │
                         │ rental                │
                         │ ...                   │
                         └──────────┬────────────┘
                                    │
                                    ▼
                         ┌──────────────────────┐
                         │    SQL Generator      │
                         │       Gemini          │
                         │                       │
                         │ Question + Schema     │
                         │       ↓               │
                         │       SQL              │
                         └──────────┬────────────┘
                                    │
                                    ▼
                         ┌──────────────────────┐
                         │    SQL Validation      │
                         │                       │
                         │ syntax                │
                         │ SELECT only           │
                         │ schema references     │
                         │ safety                │
                         └──────────┬────────────┘
                                    │
                                    ▼
                         ┌──────────────────────┐
                         │    SQL Executor        │
                         │                       │
                         │ PostgreSQL            │
                         └──────────┬────────────┘
                                    │
                                    ▼
                         ┌──────────────────────┐
                         │       Results          │
                         │                       │
                         │ rows / aggregates     │
                         └──────────┬────────────┘
                                    │
                                    ▼
                         ┌──────────────────────┐
                         │    Response / UI       │
                         └──────────────────────┘
```

## Status

Everything from **User** down through **Final Ranking → Retrieved Schema → SQL Generator** is implemented and working. **SQL Validation, SQL Executor, Results, and Response/UI are not yet built** — today the API returns generated SQL as text; it does not run it.

### ✅ Done

- **Schema introspection** — `PostgreSQLSchemaIntrospector` reads tables, columns, and foreign keys directly from a live Postgres database
- **Fingerprint-based re-ingestion** — a hash of the schema is computed on every boot; ingestion only re-runs when the schema has actually changed
- **Semantic unit generation** — each table is turned into a natural-language description suitable for embedding
- **Embedding pipeline** — semantic units are tokenized and embedded via Gemini's embedding model
- **Dual MongoDB Atlas storage** — semantic units (for vector/keyword search) and a schema graph (tables as nodes, foreign keys as edges) are stored in separate Mongoose-backed repositories
- **Hybrid retrieval**
  - Vector search and keyword search run in parallel against Atlas
  - Results are merged with Reciprocal Rank Fusion (RRF)
- **Graph-based re-ranking**
  - Top hybrid hits seed a foreign-key graph traversal (max depth 2)
  - Hybrid results confirmed by graph proximity get a distance-decayed score boost; graph-only discoveries are not injected into results, only used to re-rank
- **SQL generation** — retrieved schema context + the question are sent to Gemini with a prompt constrained to read-only `SELECT` statements
- **REST API** — `POST /api/schema/retrieve` returns the question, generated SQL, and the ranked schema context used to produce it
- **Health check** — `GET /health`
- **Dockerized dev environment** — app + Postgres (seeded with the Pagila sample database) + MongoDB Atlas Local via `docker-compose`
- **Env validation** — all required config (Postgres, Mongo, Gemini) is validated with Zod at startup

### 🚧 Not yet done

- **SQL validation** — no syntax check, no enforcement that only `SELECT` statements and known schema references are returned (currently relies solely on prompt instructions to Gemini, which is not a safety guarantee)
- **SQL execution** — generated SQL is never run against PostgreSQL
- **Result processing** — no formatting/aggregation of query results
- **Answer generation** — no natural-language summarization of results back to the user
- **Observability / evaluation** — no logging, tracing, or retrieval-quality metrics
- **Automated tests / CI** — only manual scripts (`test:schema`) exist; no test runner or pipeline
- **Response/UI layer** — no client beyond the raw JSON API

## Tech stack

- **Runtime**: Node.js 22, TypeScript, Express 5
- **Databases**: PostgreSQL (source schema), MongoDB Atlas (vector + keyword search, schema graph)
- **AI**: Google Gemini (`@google/genai`) for embeddings and SQL generation
- **Validation**: Zod
- **Tooling**: tsx, Docker Compose

## Getting started

### Prerequisites

- Docker and Docker Compose
- A Gemini API key

### Setup

1. Create a `.env` file in the project root with:

   ```
   NODE_ENV=development
   PORT=3000

   POSTGRES_HOST=postgres
   POSTGRES_PORT=5432
   POSTGRES_DATABASE=schema_mind
   POSTGRES_USER=postgres
   POSTGRES_PASSWORD=your_password

   MONGO_HOST=mongodb
   MONGO_PORT=27017
   MONGO_ROOT_USERNAME=root
   MONGO_ROOT_PASSWORD=your_password
   MONGO_DATABASE=schema_mind

   GEMINI_API_KEY=your_gemini_api_key
   ```

2. Start the stack:

   ```bash
   docker compose up --build
   ```

   Postgres starts pre-seeded with the [Pagila](https://github.com/devrimgunduz/pagila) sample database (`docker/postgres/init/pagila.sql`), and Mongo Atlas Local provides local vector search.

3. On boot, Schema Mind introspects the Postgres schema and ingests it into MongoDB automatically — no manual step required.

### Usage

```bash
curl -X POST http://localhost:3000/api/schema/retrieve \
  -H "Content-Type: application/json" \
  -d '{"question": "Show me the top 5 rented films", "databaseName": "schema_mind"}'
```

Response:

```json
{
  "question": "Show me the top 5 rented films",
  "sql": "SELECT ...",
  "results": [
    /* ranked schema context used to generate the SQL */
  ]
}
```

### Local development (without Docker)

```bash
npm install
npm run dev     # tsx watch src/server.ts
npm run build   # tsc
npm start       # node dist/server.js
npm run test:schema  # manual schema introspection check
```
