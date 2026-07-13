alter table ensemble_members
    add constraint ck_ensemble_members_role
    check (role in ('OWNER', 'ADMIN', 'EDITOR', 'MEMBER', 'VIEWER'));
