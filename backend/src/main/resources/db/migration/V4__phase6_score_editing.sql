ALTER TABLE scores
    ADD COLUMN revision BIGINT NOT NULL DEFAULT 1;

ALTER TABLE score_versions
    ADD COLUMN base_score_version_id VARCHAR(64),
    ADD COLUMN edit_summary TEXT,
    ADD COLUMN annotation_migration_policy VARCHAR(32);

ALTER TABLE score_versions
    ADD CONSTRAINT fk_score_versions_base
    FOREIGN KEY (base_score_version_id) REFERENCES score_versions(id);
