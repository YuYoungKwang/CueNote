import type { AnnotationScope } from '@cuenote/score-domain';
import type { EnsembleCapabilities, EnsembleRole } from './client';

export const DEFAULT_VIEWER_CAPABILITIES: EnsembleCapabilities = {
  canManageMembers: false,
  canCreateScore: false,
  canPublishScoreVersion: false,
  canCreatePrivateAnnotation: false,
  canCreatePartAnnotation: false,
  canCreateEnsembleAnnotation: false,
  canCreateRehearsalSession: false,
  canControlRehearsal: false,
  canTransferLeader: false,
  canBeRehearsalLeader: false
};

export function capabilitiesForRole(role: EnsembleRole | string | undefined): EnsembleCapabilities {
  switch (role) {
    case 'OWNER':
      return {
        canManageMembers: true,
        canCreateScore: true,
        canPublishScoreVersion: true,
        canCreatePrivateAnnotation: true,
        canCreatePartAnnotation: true,
        canCreateEnsembleAnnotation: true,
        canCreateRehearsalSession: true,
        canControlRehearsal: true,
        canTransferLeader: true,
        canBeRehearsalLeader: true
      };
    case 'ADMIN':
      return {
        ...capabilitiesForRole('OWNER'),
        canManageMembers: true
      };
    case 'EDITOR':
      return {
        ...capabilitiesForRole('OWNER'),
        canManageMembers: false
      };
    case 'MEMBER':
      return {
        ...DEFAULT_VIEWER_CAPABILITIES,
        canCreatePrivateAnnotation: true,
        canCreatePartAnnotation: true
      };
    case 'VIEWER':
    default:
      return DEFAULT_VIEWER_CAPABILITIES;
  }
}

export function resolveCapabilities(capabilities: EnsembleCapabilities | undefined, role: EnsembleRole | string | undefined): EnsembleCapabilities {
  return capabilities ?? capabilitiesForRole(role);
}

export function canCreateAnnotationScope(capabilities: EnsembleCapabilities, scope: AnnotationScope): boolean {
  if (scope === 'PRIVATE') {
    return capabilities.canCreatePrivateAnnotation;
  }
  if (scope === 'PART') {
    return capabilities.canCreatePartAnnotation;
  }
  return capabilities.canCreateEnsembleAnnotation;
}
