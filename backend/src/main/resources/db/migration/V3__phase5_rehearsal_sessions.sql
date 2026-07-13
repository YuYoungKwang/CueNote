CREATE TABLE rehearsal_sessions (
    id VARCHAR(64) PRIMARY KEY,
    ensemble_id VARCHAR(64) NOT NULL REFERENCES ensembles(id) ON DELETE CASCADE,
    score_id VARCHAR(64) NOT NULL REFERENCES scores(id) ON DELETE CASCADE,
    score_version_id VARCHAR(64) NOT NULL REFERENCES score_versions(id) ON DELETE CASCADE,
    leader_user_id VARCHAR(64) NOT NULL REFERENCES users(id),
    status VARCHAR(32) NOT NULL,
    created_by_user_id VARCHAR(64) NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ,
    revision BIGINT NOT NULL DEFAULT 1,
    performance_order_json TEXT NOT NULL,
    CONSTRAINT chk_rehearsal_session_status CHECK (status IN ('CREATED', 'ACTIVE', 'ENDED'))
);

CREATE INDEX idx_rehearsal_sessions_ensemble ON rehearsal_sessions(ensemble_id, status, created_at);
CREATE INDEX idx_rehearsal_sessions_score_version ON rehearsal_sessions(score_id, score_version_id);

CREATE TABLE rehearsal_participants (
    session_id VARCHAR(64) NOT NULL REFERENCES rehearsal_sessions(id) ON DELETE CASCADE,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    connection_state VARCHAR(32) NOT NULL,
    follow_mode VARCHAR(32) NOT NULL,
    PRIMARY KEY (session_id, user_id),
    CONSTRAINT chk_rehearsal_connection_state CHECK (connection_state IN ('CONNECTED', 'DISCONNECTED')),
    CONSTRAINT chk_rehearsal_follow_mode CHECK (follow_mode IN ('FOLLOWING_LEADER', 'BROWSING_INDEPENDENTLY'))
);

CREATE TABLE rehearsal_state_snapshots (
    session_id VARCHAR(64) PRIMARY KEY REFERENCES rehearsal_sessions(id) ON DELETE CASCADE,
    score_id VARCHAR(64) NOT NULL REFERENCES scores(id) ON DELETE CASCADE,
    score_version_id VARCHAR(64) NOT NULL REFERENCES score_versions(id) ON DELETE CASCADE,
    playback_status VARCHAR(32) NOT NULL,
    performance_measure_id VARCHAR(512) NOT NULL,
    source_measure_id VARCHAR(512) NOT NULL,
    occurrence INTEGER NOT NULL,
    beat NUMERIC(10, 3) NOT NULL,
    bpm INTEGER NOT NULL,
    count_in_measures INTEGER NOT NULL,
    base_timeline_position_ms BIGINT NOT NULL,
    effective_at_server_time BIGINT NOT NULL,
    sequence BIGINT NOT NULL,
    updated_by_user_id VARCHAR(64) NOT NULL REFERENCES users(id),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_rehearsal_playback_status CHECK (playback_status IN ('STOPPED', 'COUNT_IN', 'PLAYING', 'PAUSED', 'ENDED')),
    CONSTRAINT chk_rehearsal_bpm CHECK (bpm BETWEEN 30 AND 300),
    CONSTRAINT chk_rehearsal_beat CHECK (beat > 0)
);

CREATE TABLE rehearsal_processed_commands (
    session_id VARCHAR(64) NOT NULL REFERENCES rehearsal_sessions(id) ON DELETE CASCADE,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    client_command_id VARCHAR(128) NOT NULL,
    message_type VARCHAR(64) NOT NULL,
    result_sequence BIGINT,
    rejected BOOLEAN NOT NULL DEFAULT false,
    rejection_code VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (session_id, user_id, client_command_id)
);
