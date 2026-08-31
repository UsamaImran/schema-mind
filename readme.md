# Schema Mind

Schema-aware Retrieval-Augmented Generation (RAG) system that converts natural-language questions into **safe, executable SQL** against relational databases.

It introspects a live database, builds semantic units and a foreign-key graph, embeds them into MongoDB Atlas, retrieves only the most relevant tables using hybrid search + graph expansion, generates dialect-aware SQL with Gemini, validates the query through multiple safety layers, and executes it — returning real results.

Currently supports **PostgreSQL** and **MySQL**. The architecture is designed to support additional relational databases (target: 4–5 total).

---

## Features

- **Live Schema Introspection**  
  Reads tables, columns, primary keys, foreign keys, and indexes from PostgreSQL and MySQL.

- **Automatic Schema Synchronization**
  - Fingerprint-based change detection
  - Real-time schema change listeners
    - PostgreSQL: event-driven (`LISTEN/NOTIFY` + DDL event trigger)
    - MySQL: periodic fingerprint polling
  - Automatically re-ingests when the schema changes

- **Hybrid Retrieval**
  - Semantic (vector) search
  - Keyword search
  - Reciprocal Rank Fusion (RRF)
  - Foreign-key graph expansion (max depth 2) with distance-decayed boosting

- **Dialect-aware SQL Generation**  
  Uses Gemini, constrained to a single read-only `SELECT` based on the retrieved schema context.

- **Multi-layer Evaluation** (query is never executed unless all pass)
  - **Structural** — valid syntax, single `SELECT`, only references tables present in the retrieved context (`node-sql-parser`)
  - **Safety** — blocks `DROP`, `DELETE`, `UPDATE`, `INSERT`, `ALTER`, `TRUNCATE`, stacked statements, and common injection patterns
  - **Semantic** — quality scoring

- **Safe Execution**  
  Dialect-specific executors with read-only mode, row limits, and timeouts.

- **Dockerized**  
  One-command local setup with sample database + MongoDB Atlas Local.

---

## Architecture

```
User Question
      │
      ▼
┌─────────────────────┐
│   API / Controller  │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  Schema Retrieval   │
│                     │
│  • Query Embedding  │
│  • Vector Search    │
│  • Keyword Search   │
│  • RRF Hybrid       │
│  • Graph Expansion  │
│  • Final Ranking    │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  Retrieved Schema   │  ← only relevant tables + relations
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│   SQL Generator     │  (Gemini)
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  Evaluation Layer   │
│  • Structural       │
│  • Safety           │
│  • Semantic         │
└──────────┬──────────┘
           │ (only if passed)
           ▼
┌─────────────────────┐
│   SQL Executor      │  (PostgreSQL / MySQL)
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│      Results        │
└─────────────────────┘
```

---

## Tech Stack

| Layer                | Technology                               |
| -------------------- | ---------------------------------------- |
| Runtime              | Node.js 22 · TypeScript · Express 5      |
| Source Databases     | PostgreSQL · MySQL                       |
| Vector / Graph Store | MongoDB Atlas (vector + keyword + graph) |
| AI                   | Google Gemini (`@google/genai`)          |
| SQL Parsing          | `node-sql-parser`                        |
| Validation           | Zod                                      |
| Tooling              | Docker Compose · tsx · Mongoose          |

---

## Getting Started

### Prerequisites

- Docker & Docker Compose
- A Google Gemini API key

### 1. Environment

Create a `.env` file in the project root:

```env
NODE_ENV=development
PORT=3000

DATABASE_DIALECT=postgresql          # or mysql

DB_HOST=postgres                     # or mysql
DB_PORT=5432
DB_NAME=schema_mind
DB_USER=postgres
DB_PASSWORD=your_password

MONGO_URI=mongodb://admin:admin@mongodb:27017/schema_mind?authSource=admin
GEMINI_API_KEY=your_gemini_api_key
```

### 2. Start the stack

```bash
# PostgreSQL
docker compose --profile postgresql up --build

# or MySQL
docker compose --profile mysql up --build
```

- The selected database starts with a sample schema
- MongoDB Atlas Local provides vector + keyword search
- On boot, Schema Mind introspects the schema and ingests it automatically
- Schema change listeners stay active for continuous synchronization

### 3. Query the API

```bash
curl -X POST http://localhost:3000/api/schema/retrieve \
  -H "Content-Type: application/json" \
  -d '{
    "question": "Show me the top 5 most rented films",
    "databaseName": "schema_mind"
  }'
```

**Successful response:**

```json
{
  "success": true,
  "question": "Show me the top 5 most rented films",
  "sql": "SELECT f.title, COUNT(r.rental_id) AS rental_count\nFROM film f\nJOIN inventory i ON f.film_id = i.film_id\nJOIN rental r ON i.inventory_id = r.inventory_id\nGROUP BY f.title\nORDER BY rental_count DESC\nLIMIT 5;",
  "evaluation": {
    "passed": true,
    "score": 95
  },
  "execution": {
    "rows": [...],
    "rowCount": 5,
    "executionTimeMs": 12
  }
}
```

If evaluation fails, the API returns `400` with the full evaluation details and **does not execute** the query.

### Local development (without Docker)

```bash
npm install
npm run dev          # tsx watch src/server.ts
npm run build        # tsc
npm start            # node dist/server.js
npm run test:schema  # manual schema introspection check
```

---

## Project Structure

```
src/
├── config/                     # Environment & Gemini config
├── controllers/                # HTTP controllers
├── infrastructure/
│   ├── embeddings/             # Gemini embedding service
│   ├── mongo/                  # Semantic units + schema graph repositories
│   ├── postgres/               # Postgres adapter, introspector, change listener
│   ├── mysql/                  # MySQL adapter, introspector, change listener
│   ├── schema-change/          # Base schema change listener
│   └── tokenization/
├── modules/
│   ├── schema/                 # Introspection, graph, retrieval, semantic units
│   ├── generation/             # SQL generator
│   ├── evaluation/             # Structural / Safety / Semantic evaluators
│   └── execution/              # Dialect-aware executors + factory
├── services/                   # Ingestion orchestration
├── routes/
├── app.ts
└── server.ts
```

---

## Safety Model

Schema Mind **never executes** a query until it passes all evaluation layers:

1. **Structural** — Must be a single `SELECT`, valid syntax, and only reference tables present in the retrieved schema context
2. **Safety** — Blocks `DROP`, `DELETE`, `UPDATE`, `INSERT`, `ALTER`, `TRUNCATE`, stacked statements, and obvious injection patterns
3. **Semantic** — Additional quality scoring

Even after passing evaluation, the executor runs in **read-only mode** with row limits and timeouts.

---

## License

MIT

```

```
