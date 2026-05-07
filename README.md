# Async Document Workflow

Async document processing system built with FastAPI, Celery, Redis, PostgreSQL, and React.

The app allows users to:
- upload documents
- process them asynchronously
- track live progress
- review/edit extracted results
- finalize and export processed data

## Tech Stack

- React + TypeScript
- FastAPI
- PostgreSQL
- Celery
- Redis
- Docker Compose

---

## Running with Docker

```bash
docker compose up --build