package com.cuenote.backend.api.collaboration;

import com.cuenote.backend.api.auth.AuthService;
import com.cuenote.backend.api.auth.AuthenticatedUser;
import com.cuenote.backend.api.error.ApiException;
import com.cuenote.backend.api.error.ErrorCode;
import com.cuenote.backend.api.storage.ObjectStorageService;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;
import org.w3c.dom.Document;
import org.xml.sax.InputSource;

@Service
public class CollaborationService {

    private static final List<String> MUSICXML_MIME_TYPES = List.of(
            "application/vnd.recordare.musicxml+xml",
            "application/xml",
            "text/xml",
            "application/octet-stream",
            ""
    );

    private final JdbcTemplate jdbcTemplate;
    private final ObjectStorageService objectStorage;
    private final ObjectMapper objectMapper;
    private final long maxMusicXmlBytes;

    public CollaborationService(
            JdbcTemplate jdbcTemplate,
            ObjectStorageService objectStorage,
            ObjectMapper objectMapper,
            @Value("${cuenote.musicxml.max-bytes:2097152}") long maxMusicXmlBytes
    ) {
        this.jdbcTemplate = jdbcTemplate;
        this.objectStorage = objectStorage;
        this.objectMapper = objectMapper;
        this.maxMusicXmlBytes = maxMusicXmlBytes;
    }

    @Transactional
    public Map<String, Object> createEnsemble(AuthenticatedUser user, String name) {
        if (name == null || name.isBlank()) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "name is required");
        }
        String ensembleId = AuthService.newId("ens");
        jdbcTemplate.update(
                "insert into ensembles(id, name, owner_user_id, created_at, updated_at) values (?, ?, ?, now(), now())",
                ensembleId,
                name.trim(),
                user.id()
        );
        jdbcTemplate.update(
                "insert into ensemble_members(id, ensemble_id, user_id, role, created_at) values (?, ?, ?, 'OWNER', now())",
                AuthService.newId("mem"),
                ensembleId,
                user.id()
        );
        return getEnsemble(user, ensembleId);
    }

    public List<Map<String, Object>> listEnsembles(AuthenticatedUser user) {
        return jdbcTemplate.queryForList(
                """
                select e.id, e.name, e.owner_user_id, m.role, e.created_at, e.updated_at
                from ensembles e
                join ensemble_members m on m.ensemble_id = e.id
                where m.user_id = ?
                order by e.created_at desc
                """,
                user.id()
        );
    }

    @Transactional
    public Map<String, Object> addMember(AuthenticatedUser user, String ensembleId, String targetUserId, String role) {
        Map<String, Object> ensemble = getEnsemble(user, ensembleId);
        if (!user.id().equals(ensemble.get("owner_user_id"))) {
            throw new ApiException(ErrorCode.FORBIDDEN, "Only the ensemble owner can add members");
        }
        if (!List.of("MEMBER", "ADMIN").contains(role)) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "role must be MEMBER or ADMIN");
        }
        jdbcTemplate.update(
                """
                insert into ensemble_members(id, ensemble_id, user_id, role, created_at)
                values (?, ?, ?, ?, now())
                on conflict (ensemble_id, user_id) do update set role = excluded.role
                """,
                AuthService.newId("mem"),
                ensembleId,
                targetUserId,
                role
        );
        return getEnsemble(user, ensembleId);
    }

    @Transactional
    public Map<String, Object> createScore(AuthenticatedUser user, String ensembleId, String title, String composer, MultipartFile file) {
        requireMember(user, ensembleId);
        String scoreId = AuthService.newId("scr");
        jdbcTemplate.update(
                """
                insert into scores(id, ensemble_id, owner_user_id, title, composer, created_at, updated_at)
                values (?, ?, ?, ?, ?, now(), now())
                """,
                scoreId,
                ensembleId,
                user.id(),
                requiredText(title, "title"),
                blankToNull(composer)
        );
        Map<String, Object> version = createScoreVersion(user, scoreId, title, file);
        return getScore(user, scoreId);
    }

    @Transactional
    public Map<String, Object> createScoreVersion(AuthenticatedUser user, String scoreId, String title, MultipartFile file) {
        return createScoreVersion(user, scoreId, title, file, new ScoreVersionPublishOptions(null, null, null, null));
    }

    @Transactional
    public Map<String, Object> createScoreVersion(
            AuthenticatedUser user,
            String scoreId,
            String title,
            MultipartFile file,
            ScoreVersionPublishOptions options
    ) {
        Map<String, Object> score = getScore(user, scoreId);
        requireScoreEditor(user, String.valueOf(score.get("ensemble_id")));
        Map<String, Object> lockedScore = lockScore(scoreId);
        validatePublishOptions(scoreId, lockedScore, options);
        byte[] content = readMusicXml(file);
        if (options.baseScoreVersionId() != null && !options.baseScoreVersionId().isBlank()) {
            String rootElement = musicXmlRootElement(new String(content, StandardCharsets.UTF_8));
            if (!"score-partwise".equals(rootElement)) {
                throw new ApiException(ErrorCode.VALIDATION_FAILED, "Edited score versions must be score-partwise MusicXML");
            }
        }
        int versionNumber = jdbcTemplate.queryForObject(
                "select coalesce(max(version_number), 0) + 1 from score_versions where score_id = ?",
                Integer.class,
                scoreId
        );
        String versionId = AuthService.newId("ver");
        String objectKey = "scores/" + scoreId + "/versions/" + versionId + ".musicxml";
        String contentType = file.getContentType() == null ? "application/xml" : file.getContentType();
        objectStorage.put(objectKey, content, contentType);
        jdbcTemplate.update(
                """
                insert into score_versions(
                    id, score_id, version_number, title, object_key, content_hash,
                    byte_size, mime_type, created_by_user_id, base_score_version_id,
                    edit_summary, annotation_migration_policy, created_at
                )
                values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, now())
                """,
                versionId,
                scoreId,
                versionNumber,
                requiredText(title, "title"),
                objectKey,
                sha256(content),
                content.length,
                contentType,
                user.id(),
                blankToNull(options.baseScoreVersionId()),
                blankToNull(options.editSummary()),
                normalizeMigrationPolicy(options.annotationMigrationPolicy())
        );
        jdbcTemplate.update(
                "update scores set current_version_id = ?, revision = revision + 1, updated_at = now() where id = ?",
                versionId,
                scoreId
        );
        return getVersion(user, scoreId, versionId);
    }

    public List<Map<String, Object>> listScores(AuthenticatedUser user, String ensembleId) {
        requireMember(user, ensembleId);
        return jdbcTemplate.queryForList(
                """
                select s.id, s.ensemble_id, s.owner_user_id, s.title, s.composer, s.current_version_id,
                       s.revision, s.created_at, s.updated_at,
                       v.version_number as current_version_number
                from scores s
                left join score_versions v on v.id = s.current_version_id
                where s.ensemble_id = ?
                order by s.updated_at desc
                """,
                ensembleId
        );
    }

    public Map<String, Object> getScore(AuthenticatedUser user, String scoreId) {
        List<Map<String, Object>> scores = jdbcTemplate.queryForList(
                """
                select s.id, s.ensemble_id, s.owner_user_id, s.title, s.composer, s.current_version_id,
                       s.revision, s.created_at, s.updated_at,
                       v.version_number as current_version_number
                from scores s
                left join score_versions v on v.id = s.current_version_id
                where s.id = ?
                """,
                scoreId
        );
        if (scores.isEmpty()) {
            throw new ApiException(ErrorCode.NOT_FOUND, "Score not found");
        }
        requireMember(user, String.valueOf(scores.get(0).get("ensemble_id")));
        Map<String, Object> score = new HashMap<>(scores.get(0));
        score.put("versions", listVersions(scoreId));
        return score;
    }

    public Map<String, Object> getVersion(AuthenticatedUser user, String scoreId, String versionId) {
        getScore(user, scoreId);
        List<Map<String, Object>> versions = jdbcTemplate.queryForList(
                """
                select id, score_id, version_number, title, object_key, content_hash,
                       byte_size, mime_type, created_by_user_id, base_score_version_id,
                       edit_summary, annotation_migration_policy, created_at
                from score_versions
                where score_id = ? and id = ?
                """,
                scoreId,
                versionId
        );
        if (versions.isEmpty()) {
            throw new ApiException(ErrorCode.NOT_FOUND, "Score version not found");
        }
        return versions.get(0);
    }

    public ObjectStorageService.StoredObject getVersionSource(AuthenticatedUser user, String scoreId, String versionId) {
        Map<String, Object> version = getVersion(user, scoreId, versionId);
        return objectStorage.get(String.valueOf(version.get("object_key")));
    }

    public List<Map<String, Object>> listVisibleAnnotations(AuthenticatedUser user, String scoreId, String scoreVersionId) {
        Map<String, Object> score = getScore(user, scoreId);
        return jdbcTemplate.query(
                """
                select id, score_id, score_version_id, scope, part_id, owner_user_id, author_user_id,
                       type, anchor_json, payload_json, revision, deleted_at, created_at, updated_at
                from annotations
                where score_id = ? and score_version_id = ?
                  and (
                    (scope = 'PRIVATE' and owner_user_id = ?)
                    or scope in ('PART', 'ENSEMBLE')
                  )
                order by created_at asc, id asc
                """,
                (rs, rowNum) -> annotationRow(rsRowToMap(rs)),
                scoreId,
                scoreVersionId,
                user.id()
        );
    }

    @Transactional
    public Map<String, Object> syncAnnotations(AuthenticatedUser user, String scoreId, AnnotationSyncRequest request) {
        Map<String, Object> score = getScore(user, scoreId);
        String ensembleId = String.valueOf(score.get("ensemble_id"));
        requireMember(user, ensembleId);
        getVersion(user, scoreId, request.scoreVersionId());

        List<Map<String, Object>> applied = new ArrayList<>();
        List<Map<String, Object>> conflicts = new ArrayList<>();

        for (AnnotationMutation mutation : request.mutations()) {
            ExistingMutation existingMutation = findExistingMutation(user, mutation.clientMutationId());
            if (existingMutation != null) {
                applied.add(Map.of(
                        "clientMutationId", mutation.clientMutationId(),
                        "annotationId", existingMutation.annotationId(),
                        "revision", existingMutation.resultRevision(),
                        "idempotentReplay", true
                ));
                continue;
            }

            String annotationId = mutation.annotationId();
            if ((annotationId == null || annotationId.isBlank()) && mutation.annotation() != null) {
                annotationId = String.valueOf(mutation.annotation().get("id"));
            }
            if (annotationId == null || annotationId.isBlank()) {
                throw new ApiException(ErrorCode.VALIDATION_FAILED, "annotation id is required");
            }

            AnnotationRecord current = findAnnotation(annotationId);
            long expectedRevision = mutation.baseRevision() == null ? 0L : mutation.baseRevision();
            long currentRevision = current == null ? 0L : current.revision();
            if (expectedRevision != currentRevision) {
                conflicts.add(Map.of(
                        "clientMutationId", mutation.clientMutationId(),
                        "annotationId", annotationId,
                        "serverRevision", currentRevision,
                        "serverAnnotation", current == null ? Map.of() : annotationRow(current.values())
                ));
                continue;
            }

            AnnotationRecord updated = applyAnnotationMutation(user, scoreId, request.scoreVersionId(), mutation, current);
            jdbcTemplate.update(
                    "insert into client_mutations(id, user_id, client_mutation_id, annotation_id, result_revision, created_at) values (?, ?, ?, ?, ?, now())",
                    AuthService.newId("mut"),
                    user.id(),
                    mutation.clientMutationId(),
                    updated.id(),
                    updated.revision()
            );
            applied.add(Map.of(
                    "clientMutationId", mutation.clientMutationId(),
                    "annotationId", updated.id(),
                    "revision", updated.revision(),
                    "annotation", annotationRow(updated.values())
            ));
        }

        Map<String, Object> result = Map.of("applied", applied, "conflicts", conflicts);
        if (!conflicts.isEmpty()) {
            throw new ApiException(ErrorCode.CONFLICT, "Annotation revision conflict", result);
        }
        return result;
    }

    private AnnotationRecord applyAnnotationMutation(
            AuthenticatedUser user,
            String scoreId,
            String scoreVersionId,
            AnnotationMutation mutation,
            AnnotationRecord current
    ) {
        String action = mutation.action() == null ? "UPSERT" : mutation.action();
        if ("DELETE".equals(action)) {
            if (current == null) {
                throw new ApiException(ErrorCode.NOT_FOUND, "Annotation not found");
            }
            requireAnnotationWritable(user, current);
            long revision = current.revision() + 1;
            jdbcTemplate.update(
                    "update annotations set revision = ?, deleted_at = now(), updated_at = now(), author_user_id = ? where id = ?",
                    revision,
                    user.id(),
                    current.id()
            );
            return findAnnotation(current.id());
        }

        Map<String, Object> annotation = mutation.annotation();
        if (annotation == null) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "annotation payload is required");
        }

        String id = requiredMapText(annotation, "id");
        String annotationScoreId = requiredMapText(annotation, "scoreId");
        String annotationScoreVersionId = requiredMapText(annotation, "scoreVersionId");
        if (!scoreId.equals(annotationScoreId) || !scoreVersionId.equals(annotationScoreVersionId)) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "Annotation score/version does not match request path");
        }
        String scope = requiredMapText(annotation, "scope");
        String type = requiredMapText(annotation, "type");
        String partId = blankToNull((String) annotation.get("partId"));
        if ("PART".equals(scope) && partId == null) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "PART annotations require partId");
        }
        if (!List.of("PRIVATE", "PART", "ENSEMBLE").contains(scope)) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "Unsupported annotation scope");
        }
        if (!List.of("STROKE", "TEXT").contains(type)) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "Unsupported annotation type");
        }

        String ownerUserId = current == null ? user.id() : current.ownerUserId();
        if ("PRIVATE".equals(scope) && !ownerUserId.equals(user.id())) {
            throw new ApiException(ErrorCode.FORBIDDEN, "PRIVATE annotation belongs to another user");
        }
        if (current != null) {
            requireAnnotationWritable(user, current);
        }

        long revision = current == null ? 1L : current.revision() + 1L;
        Instant createdAt = current == null ? millisToInstant(annotation.get("createdAt")) : current.createdAt();
        Instant updatedAt = millisToInstant(annotation.get("updatedAt"));
        String anchorJson = toJson(annotation.get("anchor"));
        String payloadJson = toJson(annotation.get("payload"));

        if (current == null) {
            jdbcTemplate.update(
                    """
                    insert into annotations(
                        id, score_id, score_version_id, scope, part_id, owner_user_id, author_user_id,
                        type, anchor_json, payload_json, revision, deleted_at, created_at, updated_at
                    )
                    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, null, ?, ?)
                    """,
                    id,
                    scoreId,
                    scoreVersionId,
                    scope,
                    partId,
                    ownerUserId,
                    user.id(),
                    type,
                    anchorJson,
                    payloadJson,
                    revision,
                    Timestamp.from(createdAt),
                    Timestamp.from(updatedAt)
            );
        } else {
            jdbcTemplate.update(
                    """
                    update annotations
                    set scope = ?, part_id = ?, author_user_id = ?, type = ?, anchor_json = ?,
                        payload_json = ?, revision = ?, deleted_at = null, updated_at = ?
                    where id = ?
                    """,
                    scope,
                    partId,
                    user.id(),
                    type,
                    anchorJson,
                    payloadJson,
                    revision,
                    Timestamp.from(updatedAt),
                    id
            );
        }
        return findAnnotation(id);
    }

    private void requireAnnotationWritable(AuthenticatedUser user, AnnotationRecord annotation) {
        if ("PRIVATE".equals(annotation.scope()) && !annotation.ownerUserId().equals(user.id())) {
            throw new ApiException(ErrorCode.FORBIDDEN, "PRIVATE annotation belongs to another user");
        }
    }

    private Map<String, Object> getEnsemble(AuthenticatedUser user, String ensembleId) {
        requireMember(user, ensembleId);
        List<Map<String, Object>> rows = jdbcTemplate.queryForList(
                """
                select e.id, e.name, e.owner_user_id, m.role, e.created_at, e.updated_at
                from ensembles e
                join ensemble_members m on m.ensemble_id = e.id
                where e.id = ? and m.user_id = ?
                """,
                ensembleId,
                user.id()
        );
        if (rows.isEmpty()) {
            throw new ApiException(ErrorCode.NOT_FOUND, "Ensemble not found");
        }
        return rows.get(0);
    }

    private void requireMember(AuthenticatedUser user, String ensembleId) {
        Integer count = jdbcTemplate.queryForObject(
                "select count(*) from ensemble_members where ensemble_id = ? and user_id = ?",
                Integer.class,
                ensembleId,
                user.id()
        );
        if (count == null || count == 0) {
            throw new ApiException(ErrorCode.FORBIDDEN, "Ensemble membership is required");
        }
    }

    private void requireScoreEditor(AuthenticatedUser user, String ensembleId) {
        List<String> roles = jdbcTemplate.queryForList(
                "select role from ensemble_members where ensemble_id = ? and user_id = ?",
                String.class,
                ensembleId,
                user.id()
        );
        if (roles.isEmpty() || !List.of("OWNER", "ADMIN").contains(roles.get(0))) {
            throw new ApiException(ErrorCode.FORBIDDEN, "OWNER or ADMIN role is required to publish score edits");
        }
    }

    private Map<String, Object> lockScore(String scoreId) {
        List<Map<String, Object>> scores = jdbcTemplate.queryForList(
                "select id, current_version_id, revision from scores where id = ? for update",
                scoreId
        );
        if (scores.isEmpty()) {
            throw new ApiException(ErrorCode.NOT_FOUND, "Score not found");
        }
        return scores.get(0);
    }

    private void validatePublishOptions(String scoreId, Map<String, Object> score, ScoreVersionPublishOptions options) {
        Long expectedRevision = options.expectedScoreRevision();
        if (expectedRevision != null) {
            long actualRevision = ((Number) score.get("revision")).longValue();
            if (actualRevision != expectedRevision) {
                throw new ApiException(ErrorCode.CONFLICT, "Score revision conflict", Map.of(
                        "expectedRevision", expectedRevision,
                        "actualRevision", actualRevision,
                        "currentVersionId", String.valueOf(score.get("current_version_id"))
                ));
            }
        }

        String baseScoreVersionId = blankToNull(options.baseScoreVersionId());
        if (baseScoreVersionId != null) {
            Integer baseCount = jdbcTemplate.queryForObject(
                    "select count(*) from score_versions where score_id = ? and id = ?",
                    Integer.class,
                    scoreId,
                    baseScoreVersionId
            );
            if (baseCount == null || baseCount == 0) {
                throw new ApiException(ErrorCode.VALIDATION_FAILED, "baseScoreVersionId must belong to the score");
            }
        }

        normalizeMigrationPolicy(options.annotationMigrationPolicy());
    }

    private String normalizeMigrationPolicy(String policy) {
        String normalized = blankToNull(policy);
        if (normalized == null) {
            return null;
        }
        if (!List.of("NONE", "MEASURE_ONLY").contains(normalized)) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "annotationMigrationPolicy must be NONE or MEASURE_ONLY");
        }
        return normalized;
    }

    private List<Map<String, Object>> listVersions(String scoreId) {
        return jdbcTemplate.queryForList(
                """
                select id, score_id, version_number, title, content_hash, byte_size,
                       mime_type, created_by_user_id, base_score_version_id,
                       edit_summary, annotation_migration_policy, created_at
                from score_versions
                where score_id = ?
                order by version_number asc
                """,
                scoreId
        );
    }

    private byte[] readMusicXml(MultipartFile file) {
        if (file == null || file.isEmpty()) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "MusicXML file is required");
        }
        String contentType = file.getContentType() == null ? "" : file.getContentType();
        if (!MUSICXML_MIME_TYPES.contains(contentType)) {
            throw new ApiException(ErrorCode.UNSUPPORTED_MEDIA_TYPE, "Only MusicXML XML uploads are supported");
        }
        if (file.getSize() > maxMusicXmlBytes) {
            throw new ApiException(ErrorCode.PAYLOAD_TOO_LARGE, "MusicXML file exceeds the configured size limit");
        }
        try {
            byte[] content = file.getBytes();
            String asText = new String(content, StandardCharsets.UTF_8);
            String rootElement = musicXmlRootElement(asText);
            if (!List.of("score-partwise", "score-timewise").contains(rootElement)) {
                throw new ApiException(ErrorCode.VALIDATION_FAILED, "Uploaded file is not a supported MusicXML score");
            }
            return content;
        } catch (IOException exception) {
            throw new ApiException(ErrorCode.INTERNAL_ERROR, "MusicXML upload read failed");
        }
    }

    private String musicXmlRootElement(String xml) {
        try {
            javax.xml.parsers.DocumentBuilderFactory factory = javax.xml.parsers.DocumentBuilderFactory.newInstance();
            factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
            factory.setFeature("http://xml.org/sax/features/external-general-entities", false);
            factory.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
            factory.setXIncludeAware(false);
            factory.setExpandEntityReferences(false);
            Document document = factory.newDocumentBuilder().parse(new InputSource(new java.io.StringReader(xml)));
            return document.getDocumentElement().getTagName();
        } catch (Exception exception) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "Uploaded MusicXML is not well-formed XML");
        }
    }

    private ExistingMutation findExistingMutation(AuthenticatedUser user, String clientMutationId) {
        if (clientMutationId == null || clientMutationId.isBlank()) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "clientMutationId is required");
        }
        List<ExistingMutation> rows = jdbcTemplate.query(
                "select annotation_id, result_revision from client_mutations where user_id = ? and client_mutation_id = ?",
                (rs, rowNum) -> new ExistingMutation(rs.getString("annotation_id"), rs.getLong("result_revision")),
                user.id(),
                clientMutationId
        );
        return rows.isEmpty() ? null : rows.get(0);
    }

    private AnnotationRecord findAnnotation(String annotationId) {
        List<AnnotationRecord> rows = jdbcTemplate.query(
                """
                select id, score_id, score_version_id, scope, part_id, owner_user_id, author_user_id,
                       type, anchor_json, payload_json, revision, deleted_at, created_at, updated_at
                from annotations
                where id = ?
                """,
                (rs, rowNum) -> new AnnotationRecord(rsRowToMap(rs)),
                annotationId
        );
        return rows.isEmpty() ? null : rows.get(0);
    }

    private Map<String, Object> annotationRow(Map<String, Object> row) {
        Map<String, Object> annotation = new HashMap<>();
        annotation.put("id", row.get("id"));
        annotation.put("scoreId", row.get("score_id"));
        annotation.put("scoreVersionId", row.get("score_version_id"));
        annotation.put("scope", row.get("scope"));
        annotation.put("partId", row.get("part_id"));
        annotation.put("type", row.get("type"));
        annotation.put("anchor", fromJson(String.valueOf(row.get("anchor_json"))));
        annotation.put("payload", fromJson(String.valueOf(row.get("payload_json"))));
        annotation.put("serverRevision", row.get("revision"));
        annotation.put("deletedAt", instantToMillis(row.get("deleted_at")));
        annotation.put("createdAt", instantToMillis(row.get("created_at")));
        annotation.put("updatedAt", instantToMillis(row.get("updated_at")));
        return annotation;
    }

    private Map<String, Object> rsRowToMap(java.sql.ResultSet rs) throws java.sql.SQLException {
        Map<String, Object> row = new HashMap<>();
        row.put("id", rs.getString("id"));
        row.put("score_id", rs.getString("score_id"));
        row.put("score_version_id", rs.getString("score_version_id"));
        row.put("scope", rs.getString("scope"));
        row.put("part_id", rs.getString("part_id"));
        row.put("owner_user_id", rs.getString("owner_user_id"));
        row.put("author_user_id", rs.getString("author_user_id"));
        row.put("type", rs.getString("type"));
        row.put("anchor_json", rs.getString("anchor_json"));
        row.put("payload_json", rs.getString("payload_json"));
        row.put("revision", rs.getLong("revision"));
        row.put("deleted_at", rs.getTimestamp("deleted_at") == null ? null : rs.getTimestamp("deleted_at").toInstant());
        row.put("created_at", rs.getTimestamp("created_at").toInstant());
        row.put("updated_at", rs.getTimestamp("updated_at").toInstant());
        return row;
    }

    private String toJson(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (JsonProcessingException exception) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "Annotation JSON payload is invalid");
        }
    }

    @SuppressWarnings("unchecked")
    private Object fromJson(String json) {
        try {
            return objectMapper.readValue(json, Map.class);
        } catch (JsonProcessingException exception) {
            throw new ApiException(ErrorCode.INTERNAL_ERROR, "Stored annotation JSON is invalid");
        }
    }

    private String requiredText(String value, String field) {
        if (value == null || value.isBlank()) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, field + " is required");
        }
        return value.trim();
    }

    private String requiredMapText(Map<String, Object> value, String field) {
        Object raw = value.get(field);
        if (!(raw instanceof String text) || text.isBlank()) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, field + " is required");
        }
        return text;
    }

    private String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }

    private Instant millisToInstant(Object value) {
        if (value instanceof Number number) {
            return Instant.ofEpochMilli(number.longValue());
        }
        return Instant.now();
    }

    private Long instantToMillis(Object value) {
        if (value instanceof Instant instant) {
            return instant.toEpochMilli();
        }
        return null;
    }

    private String sha256(byte[] content) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(content);
            return Base64.getUrlEncoder().withoutPadding().encodeToString(digest);
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 is required", exception);
        }
    }

    private record ExistingMutation(String annotationId, long resultRevision) {
    }

    private record AnnotationRecord(Map<String, Object> values) {
        String id() {
            return String.valueOf(values.get("id"));
        }

        String scope() {
            return String.valueOf(values.get("scope"));
        }

        String ownerUserId() {
            return String.valueOf(values.get("owner_user_id"));
        }

        long revision() {
            return ((Number) values.get("revision")).longValue();
        }

        Instant createdAt() {
            return (Instant) values.get("created_at");
        }
    }
}
