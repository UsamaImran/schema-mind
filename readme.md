# Schema Mind

**Schema-aware Retrieval-Augmented Generation (RAG)** system that converts natural-language questions into **safe, executable SQL** against relational databases.

It introspects a live database, embeds the schema into MongoDB Atlas, retrieves only the most relevant tables using hybrid vector + keyword search + foreign-key graph traversal, generates SQL with Gemini, validates it through multiple safety layers, and executes it — returning real results.

---

## Features

- **Live Schema Introspection** — Reads tables, columns, and foreign keys from PostgreSQL or MySQL
- **Fingerprint-based Re-ingestion** — Only re-embeds when the schema actually changes
- **Hybrid Retrieval**
  - Semantic (vector) search
  - Keyword search
  - Reciprocal Rank Fusion (RRF)
  - Foreign-key graph expansion & re-ranking (max depth 2)
- **Dialect-aware SQL Generation** — Gemini, constrained to read-only `SELECT`
- **Multi-layer Evaluation**
  - Structural (syntax + SELECT-only + schema reference checks via `node-sql-parser`)
  - Safety (blocks dangerous statements & injection patterns)
  - Semantic quality scoring
- **Safe Execution** — PostgreSQL + MySQL executors with read-only mode, row limits, and timeouts
- **Dockerized** — One-command local setup with Pagila sample database + MongoDB Atlas Local

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

## Status

| Component                | Status     | Notes                                      |
| ------------------------ | ---------- | ------------------------------------------ |
| Schema Introspection     | ✅ Done    | PostgreSQL + MySQL                         |
| Fingerprint Re-ingestion | ✅ Done    | Hash-based change detection                |
| Semantic Unit Generation | ✅ Done    |                                            |
| Embedding Pipeline       | ✅ Done    | Gemini embeddings                          |
| Hybrid Retrieval + RRF   | ✅ Done    |                                            |
| Graph Expansion & Boost  | ✅ Done    | Max depth 2, distance-decayed boost        |
| SQL Generation           | ✅ Done    | Dialect-aware                              |
| Structural Evaluation    | ✅ Done    | `node-sql-parser` + schema reference check |
| Safety Evaluation        | ✅ Done    | Forbidden patterns + injection heuristics  |
| Semantic Evaluation      | ✅ Done    |                                            |
| SQL Execution            | ✅ Done    | Postgres + MySQL executors                 |
| Multi-dialect Support    | ✅ Done    | PostgreSQL & MySQL                         |
| Natural Language Answers | 🚧 Planned |                                            |
| Observability / Metrics  | 🚧 Planned |                                            |
| Automated Tests / CI     | 🚧 Planned |                                            |
| UI / Frontend            | 🚧 Planned |                                            |

---

## Tech Stack

| Layer            | Technology                               |
| ---------------- | ---------------------------------------- |
| Runtime          | Node.js 22 · TypeScript · Express 5      |
| Source Databases | PostgreSQL · MySQL                       |
| Vector Store     | MongoDB Atlas (vector + keyword + graph) |
| AI               | Google Gemini (`@google/genai`)          |
| SQL Parsing      | `node-sql-parser`                        |
| Validation       | Zod                                      |
| Tooling          | Docker Compose · tsx · Mongoose          |

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

### 2. Start the stack

```bash
docker compose up --build
```

- Postgres starts pre-seeded with the [Pagila](https://github.com/devrimgunduz/pagila) sample database
- MongoDB Atlas Local provides vector search
- On boot, Schema Mind introspects the schema and ingests it automatically

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
├── config/                 # Environment & Gemini config
├── controllers/            # HTTP controllers
├── infrastructure/
│   ├── embeddings/         # Gemini embedding service
│   ├── mongo/              # Repositories (semantic units + schema graph)
│   ├── postgres/           # Postgres adapter & introspector
│   ├── mysql/              # MySQL support
│   └── tokenization/
├── modules/
│   ├── schema/             # Introspection, graph, retrieval, semantic units
│   ├── generation/         # SQL generator
│   ├── evaluation/         # Structural / Safety / Semantic evaluators
│   └── execution/          # Dialect-aware executors + factory
├── services/               # Ingestion orchestration
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

## Roadmap

- [ ] Natural-language answer generation from query results
- [ ] Observability (structured logging, tracing, retrieval quality metrics)
- [ ] Automated test suite + CI
- [ ] Support for more dialects (SQLite, SQL Server, etc.)
- [ ] Optional UI / playground

---

## License

MIT

```

```
