package com.cuenote.backend.api.collaboration;

import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;

@Service
public class RoleAuthorizationService {

    public static final String OWNER = "OWNER";
    public static final String ADMIN = "ADMIN";
    public static final String EDITOR = "EDITOR";
    public static final String MEMBER = "MEMBER";
    public static final String VIEWER = "VIEWER";

    private static final List<String> VALID_ROLES = List.of(OWNER, ADMIN, EDITOR, MEMBER, VIEWER);

    public boolean isValidRole(String role) {
        return VALID_ROLES.contains(role);
    }

    public boolean canManageMembers(String actorRole, String existingTargetRole, String nextTargetRole) {
        if (OWNER.equals(actorRole)) {
            return isValidRole(nextTargetRole);
        }
        if (!ADMIN.equals(actorRole)) {
            return false;
        }
        return !OWNER.equals(existingTargetRole) && !OWNER.equals(nextTargetRole) && isValidRole(nextTargetRole);
    }

    public boolean canCreateScore(String role) {
        return canPublishScoreVersion(role);
    }

    public boolean canPublishScoreVersion(String role) {
        return OWNER.equals(role) || ADMIN.equals(role) || EDITOR.equals(role);
    }

    public boolean canCreateAnnotation(String role, String scope) {
        if (VIEWER.equals(role)) {
            return false;
        }
        if ("ENSEMBLE".equals(scope)) {
            return canPublishScoreVersion(role);
        }
        return OWNER.equals(role) || ADMIN.equals(role) || EDITOR.equals(role) || MEMBER.equals(role);
    }

    public boolean canModifyAnnotation(String role, String scope, boolean ownsAnnotation) {
        if (VIEWER.equals(role)) {
            return false;
        }
        if ("PRIVATE".equals(scope)) {
            return ownsAnnotation;
        }
        if ("ENSEMBLE".equals(scope)) {
            return canPublishScoreVersion(role);
        }
        if ("PART".equals(scope)) {
            return canPublishScoreVersion(role) || ownsAnnotation;
        }
        return false;
    }

    public boolean canCreateRehearsalSession(String role) {
        return canPublishScoreVersion(role);
    }

    public boolean canControlRehearsal(String role) {
        return canPublishScoreVersion(role);
    }

    public boolean canTransferLeader(String role) {
        return canPublishScoreVersion(role);
    }

    public boolean canBeRehearsalLeader(String role) {
        return canPublishScoreVersion(role);
    }

    public Map<String, Object> capabilitiesFor(String role) {
        return Map.of(
                "canManageMembers", OWNER.equals(role) || ADMIN.equals(role),
                "canCreateScore", canCreateScore(role),
                "canPublishScoreVersion", canPublishScoreVersion(role),
                "canCreatePrivateAnnotation", canCreateAnnotation(role, "PRIVATE"),
                "canCreatePartAnnotation", canCreateAnnotation(role, "PART"),
                "canCreateEnsembleAnnotation", canCreateAnnotation(role, "ENSEMBLE"),
                "canCreateRehearsalSession", canCreateRehearsalSession(role),
                "canControlRehearsal", canControlRehearsal(role),
                "canTransferLeader", canTransferLeader(role),
                "canBeRehearsalLeader", canBeRehearsalLeader(role)
        );
    }
}
