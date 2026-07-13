import { describe, expect, it } from 'vitest';
import { canCreateAnnotationScope, capabilitiesForRole } from './roleCapabilities';

describe('role capabilities', () => {
  it('allows editors to publish and lead without member management', () => {
    const editor = capabilitiesForRole('EDITOR');

    expect(editor.canPublishScoreVersion).toBe(true);
    expect(editor.canCreateRehearsalSession).toBe(true);
    expect(editor.canManageMembers).toBe(false);
  });

  it('keeps members and viewers out of publishing and ensemble annotation writes', () => {
    const member = capabilitiesForRole('MEMBER');
    const viewer = capabilitiesForRole('VIEWER');

    expect(member.canPublishScoreVersion).toBe(false);
    expect(canCreateAnnotationScope(member, 'ENSEMBLE')).toBe(false);
    expect(viewer.canCreatePrivateAnnotation).toBe(false);
    expect(viewer.canCreateRehearsalSession).toBe(false);
  });
});
