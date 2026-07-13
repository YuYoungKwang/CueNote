package com.cuenote.backend.api.auth;

import com.cuenote.backend.api.error.ApiException;
import com.cuenote.backend.api.error.ErrorCode;
import jakarta.servlet.http.HttpServletRequest;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AuthService {

    private static final Duration ACCESS_TOKEN_TTL = Duration.ofHours(2);
    private static final Duration REFRESH_TOKEN_TTL = Duration.ofDays(14);

    private final JdbcTemplate jdbcTemplate;

    public AuthService(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    @Transactional
    public AuthSession loginDev(String email, String displayName) {
        String normalizedEmail = email.trim().toLowerCase();
        if (normalizedEmail.isBlank()) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "email is required");
        }

        AuthenticatedUser user = findUserByEmail(normalizedEmail);
        if (user == null) {
            String userId = newId("usr");
            jdbcTemplate.update(
                    """
                    insert into users(id, provider, provider_subject, email, display_name, created_at, updated_at)
                    values (?, 'dev', ?, ?, ?, now(), now())
                    """,
                    userId,
                    normalizedEmail,
                    normalizedEmail,
                    displayName == null || displayName.isBlank() ? normalizedEmail : displayName.trim()
            );
            user = new AuthenticatedUser(userId, normalizedEmail, displayName == null || displayName.isBlank() ? normalizedEmail : displayName.trim());
        }

        return createSession(user);
    }

    @Transactional
    public AuthSession refresh(String refreshToken) {
        String refreshHash = hashToken(refreshToken);
        List<AuthSessionRecord> sessions = jdbcTemplate.query(
                """
                select s.id as session_id, u.id as user_id, u.email, u.display_name
                from user_sessions s
                join users u on u.id = s.user_id
                where s.refresh_token_hash = ?
                  and s.revoked_at is null
                  and s.refresh_expires_at > now()
                """,
                (rs, rowNum) -> new AuthSessionRecord(
                        rs.getString("session_id"),
                        new AuthenticatedUser(rs.getString("user_id"), rs.getString("email"), rs.getString("display_name"))
                ),
                refreshHash
        );

        if (sessions.isEmpty()) {
            throw new ApiException(ErrorCode.UNAUTHORIZED, "Refresh token is invalid or expired");
        }

        jdbcTemplate.update("update user_sessions set revoked_at = now() where id = ?", sessions.get(0).sessionId());
        return createSession(sessions.get(0).user());
    }

    @Transactional
    public void logout(String bearerToken) {
        String token = normalizeBearerToken(bearerToken);
        if (token == null) {
            return;
        }
        jdbcTemplate.update("update user_sessions set revoked_at = now() where access_token_hash = ?", hashToken(token));
    }

    public AuthenticatedUser requireUser(HttpServletRequest request) {
        String token = normalizeBearerToken(request.getHeader("Authorization"));
        if (token == null) {
            throw new ApiException(ErrorCode.UNAUTHORIZED, "Bearer token is required");
        }
        return requireUserByAccessToken(token);
    }

    public AuthenticatedUser requireUserByAccessToken(String token) {
        if (token == null || token.isBlank()) {
            throw new ApiException(ErrorCode.UNAUTHORIZED, "Access token is required");
        }
        String tokenHash = hashToken(token);
        List<AuthenticatedUser> users = jdbcTemplate.query(
                """
                select u.id, u.email, u.display_name
                from user_sessions s
                join users u on u.id = s.user_id
                where s.access_token_hash = ?
                  and s.revoked_at is null
                  and s.access_expires_at > now()
                """,
                (rs, rowNum) -> new AuthenticatedUser(rs.getString("id"), rs.getString("email"), rs.getString("display_name")),
                tokenHash
        );

        if (users.isEmpty()) {
            throw new ApiException(ErrorCode.UNAUTHORIZED, "Bearer token is invalid or expired");
        }

        return users.get(0);
    }

    public AuthenticatedUser findUserByEmail(String email) {
        List<AuthenticatedUser> users = jdbcTemplate.query(
                "select id, email, display_name from users where email = ?",
                (rs, rowNum) -> new AuthenticatedUser(rs.getString("id"), rs.getString("email"), rs.getString("display_name")),
                email
        );
        return users.isEmpty() ? null : users.get(0);
    }

    public AuthenticatedUser requireUserById(String userId) {
        List<AuthenticatedUser> users = jdbcTemplate.query(
                "select id, email, display_name from users where id = ?",
                (rs, rowNum) -> new AuthenticatedUser(rs.getString("id"), rs.getString("email"), rs.getString("display_name")),
                userId
        );
        if (users.isEmpty()) {
            throw new ApiException(ErrorCode.NOT_FOUND, "User not found");
        }
        return users.get(0);
    }

    private AuthSession createSession(AuthenticatedUser user) {
        Instant now = Instant.now();
        Instant accessExpiresAt = now.plus(ACCESS_TOKEN_TTL);
        Instant refreshExpiresAt = now.plus(REFRESH_TOKEN_TTL);
        String accessToken = "ct_access_" + UUID.randomUUID() + UUID.randomUUID();
        String refreshToken = "ct_refresh_" + UUID.randomUUID() + UUID.randomUUID();

        jdbcTemplate.update(
                """
                insert into user_sessions(
                    id, user_id, access_token_hash, refresh_token_hash,
                    access_expires_at, refresh_expires_at, created_at
                )
                values (?, ?, ?, ?, ?, ?, now())
                """,
                newId("ses"),
                user.id(),
                hashToken(accessToken),
                hashToken(refreshToken),
                Timestamp.from(accessExpiresAt),
                Timestamp.from(refreshExpiresAt)
        );

        return new AuthSession(user, accessToken, refreshToken, accessExpiresAt.toString(), refreshExpiresAt.toString());
    }

    static String hashToken(String token) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(token.getBytes(StandardCharsets.UTF_8));
            return Base64.getUrlEncoder().withoutPadding().encodeToString(hash);
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 is required", exception);
        }
    }

    public static String newId(String prefix) {
        return prefix + "_" + UUID.randomUUID().toString().replace("-", "");
    }

    private String normalizeBearerToken(String authorizationHeader) {
        if (authorizationHeader == null || !authorizationHeader.startsWith("Bearer ")) {
            return null;
        }
        return authorizationHeader.substring("Bearer ".length()).trim();
    }

    private record AuthSessionRecord(String sessionId, AuthenticatedUser user) {
    }

    public record AuthSession(
            AuthenticatedUser user,
            String accessToken,
            String refreshToken,
            String accessTokenExpiresAt,
            String refreshTokenExpiresAt
    ) {
        public Map<String, Object> toResponse() {
            return Map.of(
                    "user", user,
                    "accessToken", accessToken,
                    "refreshToken", refreshToken,
                    "accessTokenExpiresAt", accessTokenExpiresAt,
                    "refreshTokenExpiresAt", refreshTokenExpiresAt
            );
        }
    }
}
