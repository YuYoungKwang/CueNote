CREATE TABLE users (
    id VARCHAR(64) PRIMARY KEY,
    provider VARCHAR(32) NOT NULL,
    provider_subject VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    display_name VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_users_provider_subject UNIQUE (provider, provider_subject),
    CONSTRAINT uq_users_email UNIQUE (email)
);

CREATE TABLE user_sessions (
    id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    access_token_hash VARCHAR(128) NOT NULL UNIQUE,
    refresh_token_hash VARCHAR(128) NOT NULL UNIQUE,
    access_expires_at TIMESTAMPTZ NOT NULL,
    refresh_expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ensembles (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    owner_user_id VARCHAR(64) NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ensemble_members (
    id VARCHAR(64) PRIMARY KEY,
    ensemble_id VARCHAR(64) NOT NULL REFERENCES ensembles(id) ON DELETE CASCADE,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(32) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_ensemble_members UNIQUE (ensemble_id, user_id)
);

CREATE TABLE scores (
    id VARCHAR(64) PRIMARY KEY,
    ensemble_id VARCHAR(64) NOT NULL REFERENCES ensembles(id) ON DELETE CASCADE,
    owner_user_id VARCHAR(64) NOT NULL REFERENCES users(id),
    title VARCHAR(255) NOT NULL,
    composer VARCHAR(255),
    current_version_id VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE score_versions (
    id VARCHAR(64) PRIMARY KEY,
    score_id VARCHAR(64) NOT NULL REFERENCES scores(id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL,
    title VARCHAR(255) NOT NULL,
    object_key VARCHAR(512) NOT NULL,
    content_hash VARCHAR(128) NOT NULL,
    byte_size BIGINT NOT NULL,
    mime_type VARCHAR(255) NOT NULL,
    created_by_user_id VARCHAR(64) NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_score_versions_number UNIQUE (score_id, version_number)
);

ALTER TABLE scores
    ADD CONSTRAINT fk_scores_current_version
    FOREIGN KEY (current_version_id) REFERENCES score_versions(id);

CREATE TABLE annotations (
    id VARCHAR(64) PRIMARY KEY,
    score_id VARCHAR(64) NOT NULL REFERENCES scores(id) ON DELETE CASCADE,
    score_version_id VARCHAR(64) NOT NULL REFERENCES score_versions(id) ON DELETE CASCADE,
    scope VARCHAR(32) NOT NULL,
    part_id VARCHAR(255),
    owner_user_id VARCHAR(64) NOT NULL REFERENCES users(id),
    author_user_id VARCHAR(64) NOT NULL REFERENCES users(id),
    type VARCHAR(32) NOT NULL,
    anchor_json TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    revision BIGINT NOT NULL,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_annotations_score_version ON annotations(score_id, score_version_id);
CREATE INDEX idx_annotations_owner ON annotations(owner_user_id);

CREATE TABLE client_mutations (
    id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    client_mutation_id VARCHAR(128) NOT NULL,
    annotation_id VARCHAR(64) NOT NULL,
    result_revision BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_client_mutations UNIQUE (user_id, client_mutation_id)
);
