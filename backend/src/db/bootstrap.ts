/**
 * Idempotent schema bootstrap for Postgres (the migration mechanism for V1).
 *
 * We author DDL by hand rather than via drizzle-kit because the schema needs
 * pgvector-specific objects drizzle-kit cannot express cleanly: the `vector`
 * column, a generated `tsvector`, GIN indexes on text[] and tsvector, and an HNSW
 * index that must be built AFTER bulk ingest. The Drizzle schema modules stay the
 * typed query layer; this file is the source of DDL and is kept in sync with them.
 */
import type pg from 'pg';

/** Core tables + standard/GIN indexes. Safe to run repeatedly. Does NOT build the HNSW index. */
export async function ensureSchema(pool: pg.Pool): Promise<void> {
  await pool.query(`
    CREATE EXTENSION IF NOT EXISTS vector;

    -- ===== Core curriculum =====
    CREATE TABLE IF NOT EXISTS courses (
      course_code   text PRIMARY KEY,
      current_stage integer NOT NULL DEFAULT 1,
      owner_user_id text,
      created_at    timestamptz NOT NULL DEFAULT now(),
      updated_at    timestamptz NOT NULL DEFAULT now(),
      data          jsonb NOT NULL
    );
    ALTER TABLE courses ADD COLUMN IF NOT EXISTS owner_user_id text;
    CREATE INDEX IF NOT EXISTS courses_owner_idx ON courses (owner_user_id);

    CREATE TABLE IF NOT EXISTS clos (
      clo_id      text PRIMARY KEY,
      course_code text NOT NULL REFERENCES courses(course_code) ON DELETE CASCADE,
      seq         serial,
      data        jsonb NOT NULL
    );
    CREATE INDEX IF NOT EXISTS clos_course_idx ON clos (course_code);

    CREATE TABLE IF NOT EXISTS topics (
      topic_id    text PRIMARY KEY,
      clo_id      text NOT NULL REFERENCES clos(clo_id) ON DELETE CASCADE,
      course_code text NOT NULL,
      seq         serial,
      data        jsonb NOT NULL
    );
    CREATE INDEX IF NOT EXISTS topics_clo_idx ON topics (clo_id);
    CREATE INDEX IF NOT EXISTS topics_course_idx ON topics (course_code);

    CREATE TABLE IF NOT EXISTS learning_nodes (
      node_id     text PRIMARY KEY,
      clo_id      text NOT NULL,
      topic_id    text,
      course_code text NOT NULL,
      node_type   text,
      ui_x        integer,
      ui_y        integer,
      seq         serial,
      data        jsonb NOT NULL
    );
    CREATE INDEX IF NOT EXISTS learning_nodes_clo_idx ON learning_nodes (clo_id);
    CREATE INDEX IF NOT EXISTS learning_nodes_course_idx ON learning_nodes (course_code);

    CREATE TABLE IF NOT EXISTS node_prerequisites (
      id          serial PRIMARY KEY,
      course_code text NOT NULL,
      clo_id      text NOT NULL,
      node_id     text NOT NULL,
      prereq_id   text NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS node_prereq_uniq ON node_prerequisites (node_id, prereq_id);
    CREATE INDEX IF NOT EXISTS node_prereq_clo_idx ON node_prerequisites (clo_id);
    CREATE INDEX IF NOT EXISTS node_prereq_course_idx ON node_prerequisites (course_code);

    CREATE TABLE IF NOT EXISTS accreditation_tags (
      tag_id text PRIMARY KEY,
      name   text NOT NULL
    );
    CREATE TABLE IF NOT EXISTS course_accreditation_tags (
      course_code text NOT NULL,
      tag_id      text NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS course_acc_tag_pk ON course_accreditation_tags (course_code, tag_id);

    -- ===== References / RAG =====
    CREATE TABLE IF NOT EXISTS reference_documents (
      doc_id      text PRIMARY KEY,
      course_code text NOT NULL,
      doc_text    text,
      data        jsonb NOT NULL,
      created_at  timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS reference_documents_course_idx ON reference_documents (course_code);

    CREATE TABLE IF NOT EXISTS reference_chunks (
      chunk_id        text PRIMARY KEY,
      doc_id          text NOT NULL,
      course_code     text NOT NULL,
      seq             integer NOT NULL DEFAULT 0,
      text            text NOT NULL,
      citation        text NOT NULL DEFAULT '',
      section_heading text,
      context_header  text,
      content_hash    text,
      token_estimate  integer,
      clo_ids         text[] NOT NULL DEFAULT '{}',
      subtopic_ids    text[] NOT NULL DEFAULT '{}',
      embedding       vector(1536),
      tsv             tsvector GENERATED ALWAYS AS (to_tsvector('english', coalesce(text, ''))) STORED
    );
    CREATE INDEX IF NOT EXISTS reference_chunks_course_idx ON reference_chunks (course_code);
    CREATE INDEX IF NOT EXISTS reference_chunks_doc_idx ON reference_chunks (doc_id);
    CREATE INDEX IF NOT EXISTS reference_chunks_clo_ids_idx ON reference_chunks USING gin (clo_ids);
    CREATE INDEX IF NOT EXISTS reference_chunks_subtopic_ids_idx ON reference_chunks USING gin (subtopic_ids);
    CREATE INDEX IF NOT EXISTS reference_chunks_tsv_idx ON reference_chunks USING gin (tsv);

    -- ===== Node-engine (M7) =====
    CREATE TABLE IF NOT EXISTS node_sets (
      node_set_id text PRIMARY KEY,
      course_code text NOT NULL,
      subtopic_id text NOT NULL,
      status      text,
      data        jsonb NOT NULL,
      updated_at  timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS node_sets_subtopic_uniq ON node_sets (course_code, subtopic_id);
    CREATE INDEX IF NOT EXISTS node_sets_course_idx ON node_sets (course_code);

    CREATE TABLE IF NOT EXISTS maestro_nodes (
      node_id                     text PRIMARY KEY,
      subtopic_id                 text NOT NULL,
      course_code                 text NOT NULL,
      clo_ids                     text[] NOT NULL DEFAULT '{}',
      node_type                   text,
      node_title                  text,
      knowledge_component         text,
      node_order                  integer NOT NULL DEFAULT 0,
      prepares_for_assessment_id  text,
      status                      text
    );
    CREATE INDEX IF NOT EXISTS maestro_nodes_subtopic_idx ON maestro_nodes (subtopic_id);
    CREATE INDEX IF NOT EXISTS maestro_nodes_course_idx ON maestro_nodes (course_code);

    CREATE TABLE IF NOT EXISTS knowledge_components (
      node_id   text PRIMARY KEY,
      statement text,
      kc_ids    text[] NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS evidence_check_requirements (
      evidence_check_id     text PRIMARY KEY,
      node_id               text NOT NULL,
      preferred_evidence_mode text,
      must_capture_signals  text[] NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS maestro_node_prerequisites (
      id          serial PRIMARY KEY,
      subtopic_id text NOT NULL,
      node_id     text NOT NULL,
      prereq_id   text NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS maestro_node_prereq_uniq ON maestro_node_prerequisites (node_id, prereq_id);

    -- ===== Artifacts + config + blobs + outbox =====
    CREATE TABLE IF NOT EXISTS stage_artifacts (
      id            serial PRIMARY KEY,
      course_code   text NOT NULL,
      stage         text,
      artifact_type text NOT NULL,
      node_id       text NOT NULL DEFAULT '',
      data          jsonb NOT NULL,
      updated_at    timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS stage_artifacts_key_uniq ON stage_artifacts (course_code, artifact_type, node_id);
    CREATE INDEX IF NOT EXISTS stage_artifacts_course_idx ON stage_artifacts (course_code);

    CREATE TABLE IF NOT EXISTS app_config (
      key        text PRIMARY KEY,
      data       jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS blob_files (
      id          serial PRIMARY KEY,
      course_code text NOT NULL,
      kind        text NOT NULL,
      doc_type    text,
      format      text,
      path        text NOT NULL,
      bytes       bigint,
      created_at  timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS blob_files_course_idx ON blob_files (course_code);

    CREATE TABLE IF NOT EXISTS projection_outbox (
      id          serial PRIMARY KEY,
      entity_type text NOT NULL,
      entity_key  text NOT NULL,
      op          text NOT NULL DEFAULT 'upsert',
      status      text NOT NULL DEFAULT 'pending',
      attempts    integer NOT NULL DEFAULT 0,
      last_error  text,
      created_at  timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS projection_outbox_status_idx ON projection_outbox (status);

    -- ===== Auth: users + course access grants =====
    CREATE TABLE IF NOT EXISTS users (
      id            text PRIMARY KEY,
      email         text NOT NULL,
      name          text NOT NULL DEFAULT '',
      role          text NOT NULL DEFAULT 'professor',
      password_hash text NOT NULL,
      is_active     boolean NOT NULL DEFAULT true,
      avatar_path   text,
      title         text NOT NULL DEFAULT '',
      department    text NOT NULL DEFAULT '',
      bio           text NOT NULL DEFAULT '',
      phone         text NOT NULL DEFAULT '',
      created_at    timestamptz NOT NULL DEFAULT now(),
      updated_at    timestamptz NOT NULL DEFAULT now()
    );
    ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_path text;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS title      text NOT NULL DEFAULT '';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS department text NOT NULL DEFAULT '';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS bio        text NOT NULL DEFAULT '';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS phone      text NOT NULL DEFAULT '';
    CREATE UNIQUE INDEX IF NOT EXISTS users_email_uniq ON users (lower(email));

    CREATE TABLE IF NOT EXISTS course_review_assignments (
      course_code text NOT NULL,
      professor_id text NOT NULL,
      assigned_by  text NOT NULL DEFAULT '',
      assigned_at  timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS course_review_assignment_pk ON course_review_assignments (course_code, professor_id);
    CREATE INDEX IF NOT EXISTS course_review_assignment_professor_idx ON course_review_assignments (professor_id);

    CREATE TABLE IF NOT EXISTS course_student_assignments (
      course_code text NOT NULL,
      student_id  text NOT NULL,
      assigned_by text NOT NULL DEFAULT '',
      assigned_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS course_student_assignment_pk ON course_student_assignments (course_code, student_id);
    CREATE INDEX IF NOT EXISTS course_student_assignment_student_idx ON course_student_assignments (student_id);

    CREATE TABLE IF NOT EXISTS course_review_requests (
      id           text PRIMARY KEY,
      course_code  text NOT NULL,
      requester_id text NOT NULL,
      reviewer_id  text NOT NULL,
      status       text NOT NULL DEFAULT 'pending',
      message      text NOT NULL DEFAULT '',
      created_at   timestamptz NOT NULL DEFAULT now(),
      responded_at timestamptz
    );
    CREATE INDEX IF NOT EXISTS course_review_request_reviewer_idx ON course_review_requests (reviewer_id);
    CREATE INDEX IF NOT EXISTS course_review_request_course_idx ON course_review_requests (course_code);
    CREATE INDEX IF NOT EXISTS course_review_request_requester_idx ON course_review_requests (requester_id);
  `);
}

/**
 * Build the HNSW cosine index on reference_chunks. Per the plan this runs AFTER a
 * bulk ingest (inserting thousands of rows into a live HNSW index is far slower
 * than loading then building). Idempotent; bumps maintenance_work_mem for the build.
 */
export async function buildVectorIndex(pool: pg.Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`SET maintenance_work_mem = '512MB'`);
    await client.query(
      `CREATE INDEX IF NOT EXISTS reference_chunks_embedding_hnsw
         ON reference_chunks USING hnsw (embedding vector_cosine_ops)`
    );
  } finally {
    client.release();
  }
}

/** True if the HNSW index already exists. */
export async function hasVectorIndex(pool: pg.Pool): Promise<boolean> {
  const res = await pool.query(
    `SELECT 1 FROM pg_indexes WHERE indexname = 'reference_chunks_embedding_hnsw'`
  );
  return (res.rowCount ?? 0) > 0;
}
