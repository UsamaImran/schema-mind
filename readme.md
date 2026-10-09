# Schema Mind

Schema-aware Retrieval-Augmented Generation (RAG) system that converts natural-language questions into **safe, executable SQL** against relational databases.

It introspects a live database, builds semantic units and a foreign-key graph, embeds them into MongoDB Atlas, retrieves only the most relevant tables using hybrid search + graph expansion, generates dialect-aware SQL with Gemini, validates the query through multiple safety layers, and executes it — returning real results.

Currently supports **PostgreSQL**, **MySQL**, and **Oracle Database**. The architecture is designed to support additional relational databases (target: 4–5 total).

---

## Features

- **Live Schema Introspection**  
  Reads tables, columns, primary keys, foreign keys, and indexes from PostgreSQL, MySQL, and Oracle.

- **Automatic Schema Synchronization**
  - Fingerprint-based change detection (SHA-256 stored in MongoDB to prevent redundant re-ingestion across application restarts)
  - Real-time schema change listeners
    - PostgreSQL: event-driven (`LISTEN/NOTIFY` + DDL event trigger)
    - MySQL: periodic fingerprint polling
    - Oracle: periodic DDL metadata polling (`ALL_OBJECTS.LAST_DDL_TIME`)
  - Configurable polling intervals (`SCHEMA_POLL_INTERVAL_MS`)
  - Automatically re-ingests when the schema changes

- **Hybrid Retrieval + Graph Bridge Discovery**
  - Semantic (vector) search
  - Keyword search
  - Reciprocal Rank Fusion (RRF)
  - Foreign-key graph expansion (max depth 2)
  - Automatic discovery and inclusion of intermediate/junction bridge tables missing from direct search
  - Distance-calibrated scoring and graph boosting

- **Dialect-aware SQL Generation**  
  Uses Gemini, constrained to a single read-only `SELECT` based on the retrieved schema context.

- **Multi-layer Evaluation** (query is never executed unless all pass)
  - **Structural** — valid syntax, single `SELECT`, only references tables present in the retrieved context (`node-sql-parser`)
  - **Safety** — blocks `DROP`, `DELETE`, `UPDATE`, `INSERT`, `ALTER`, `TRUNCATE`, stacked statements, and common injection patterns
  - **Semantic** — quality scoring

- **Safe Execution**  
  Dialect-specific executors with read-only mode, row limits, and timeouts.
  - PostgreSQL: `BEGIN TRANSACTION READ ONLY` + statement timeouts
  - MySQL: `SET TRANSACTION READ ONLY` + socket timeout protection
  - Oracle: `SET TRANSACTION READ ONLY` + `connection.break()` timeout cancellation and ANSI `FETCH FIRST n ROWS ONLY` clamping

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
│  • Bridge Discovery │
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
│   SQL Executor      │  (PostgreSQL / MySQL / Oracle)
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
| Runtime              | Node.js 22+ · TypeScript · Express 5     |
| Source Databases     | PostgreSQL · MySQL · Oracle Database     |
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

# Choose dialect: postgresql | mysql | oracle
DATABASE_DIALECT=postgresql

# Database connection credentials
DB_HOST=postgres                     # or mysql / localhost
DB_PORT=5432                         # 5432 for Postgres, 3306 for MySQL, 1521 for Oracle
DB_NAME=schema_mind                  # or Oracle service/PDB name
DB_USER=postgres
DB_PASSWORD=your_password

# Optional Oracle configuration
ORACLE_SERVICE_NAME=FREEPDB1         # optional PDB / service name override

# Polling interval for schema change detection (MySQL & Oracle, in ms)
SCHEMA_POLL_INTERVAL_MS=30000

MONGO_URI=mongodb://admin:admin@mongodb:27017/schema_mind?authSource=admin
GEMINI_API_KEY=your_gemini_api_key
```

### 2. Start the stack

```bash
# PostgreSQL
docker compose --profile postgresql up --build

# or MySQL
docker compose --profile mysql up --build

# or Oracle Database 23ai Free
docker compose --profile oracle up --build
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
    "databaseName": "schema_mind",
    "deepEvaluation": false
  }'
```

**Successful response:**

```json
{
  "success": true,
  "question": "Show me the top 5 most rented films",
  "sql": "SELECT f.title, COUNT(r.rental_id) AS rental_count\nFROM film f\nJOIN inventory i ON f.film_id = i.film_id\nJOIN rental r ON i.inventory_id = r.inventory_id\nGROUP BY f.title\nORDER BY rental_count DESC\nLIMIT 5;",
  "selfHealed": false,
  "evaluation": {
    "passed": true,
    "score": 100
  },
  "execution": {
    "rows": [...],
    "rowCount": 5,
    "executionTimeMs": 12
  }
}
```

- **Fast Path (Default)**: Leverages deterministic AST validation + safety pattern checks and read-only execution for sub-second responses (~1.2s). Set `"deepEvaluation": true` to opt into secondary LLM-as-a-judge scoring.
- **Automated Self-Correction**: If the initial SQL encounters an AST constraint or a database runtime error (e.g. column typo or join ambiguity), the engine automatically initiates a self-correction loop with the error diagnostics and returns `"selfHealed": true`.
- If evaluation still fails after self-healing, the API returns `400` with the failure details and **does not execute** the query.

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
│   ├── oracle/                 # Oracle adapter, introspector, change listener
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
