"""Scope credentials (course vs chapter) and record what was awarded

Chapter-level progress credentials ("milestones") are the reason for this
migration. Rather than add a parallel table set, `Certifications` is generalised
so a milestone is an ordinary credential row with `scope_kind = CHAPTER` and
`scope_id = <chapter.id>`. Issuance, the unique-constraint race guard, the
public verification page, the QR code and the PDF/image export all keep working
unchanged, because they only ever knew about `Certifications` /
`CertificateUser`.

Additive and back-compatible by construction:

- `scope_kind` is nullable and NULL means COURSE, so every pre-existing row
  keeps its current meaning without a data rewrite.
- `award_kind` is nullable and NULL means COMPLETED (a plain course
  certificate, where possession is the whole claim).
- `award_detail` defaults to `{}`.

Unique index on (course_id, scope_kind, scope_id) enforces one credential per
scope. Note that Postgres treats NULLs as distinct, so this index alone would
NOT stop a second course-scoped credential being inserted (NULL, NULL twice is
allowed) — that is exactly the state a course-scoped table has always been in
and it is caught by `scripts/audit_assessments.py` plus the existing
service-level "first one wins" lookup. The partial index below is the real
guarantee for course scope.

Revision ID: d5e6f7a8b9c0
Revises: z1a2b3c4d5e6
Create Date: 2026-10-03

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel  # noqa: F401


# revision identifiers, used by Alembic.
revision: str = 'd5e6f7a8b9c0'
down_revision: Union[str, None] = 'z1a2b3c4d5e6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_CERT_SCOPE_UQ = 'uq_certifications_course_scope'
_CERT_COURSE_UNIQUE = 'uq_certifications_one_course_scope'
_CERTUSER_USER_CERT = 'uq_certificateuser_user_certification'


def _columns(inspector, table):
    return {c['name'] for c in inspector.get_columns(table)}


def _has_table(inspector, table):
    return table in inspector.get_table_names()


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if _has_table(inspector, 'certifications'):
        cols = _columns(inspector, 'certifications')
        if 'scope_kind' not in cols:
            op.add_column(
                'certifications',
                sa.Column('scope_kind', sa.String(length=32), nullable=True),
            )
            op.create_index(
                'ix_certifications_scope_kind', 'certifications', ['scope_kind']
            )
        if 'scope_id' not in cols:
            op.add_column(
                'certifications',
                sa.Column('scope_id', sa.BigInteger(), nullable=True),
            )
            op.create_index(
                'ix_certifications_scope_id', 'certifications', ['scope_id']
            )

        existing_uq = {
            uc['name'] for uc in inspector.get_unique_constraints('certifications')
        }
        if _CERT_SCOPE_UQ not in existing_uq:
            # A course-scoped credential is the row that already exists, so a
            # duplicate here means two "the certificate" templates for one
            # course and the read path silently picks one of them.
            duplicates = bind.execute(
                sa.text(
                    """
                    SELECT course_id, count(*) AS n
                    FROM certifications
                    WHERE scope_id IS NULL
                    GROUP BY course_id
                    HAVING count(*) > 1
                    ORDER BY n DESC, course_id
                    LIMIT 10
                    """
                )
            ).fetchall()
            if duplicates:
                detail = ", ".join(
                    f"course_id={row[0]} (x{row[1]})" for row in duplicates
                )
                raise RuntimeError(
                    "Cannot add uq_certifications_course_scope: these courses "
                    f"already have more than one course-scoped credential: {detail}. "
                    "Delete the duplicates in the admin UI and re-run this migration."
                )
            op.create_unique_constraint(
                _CERT_SCOPE_UQ, 'certifications',
                ['course_id', 'scope_kind', 'scope_id'],
            )

        # Real one-per-course guarantee: a unique index restricted to rows with
        # no scope_id, where the NULL-distinctness problem does not apply.
        if _CERT_COURSE_UNIQUE not in {
            ix['name'] for ix in inspector.get_indexes('certifications')
        }:
            op.create_index(
                _CERT_COURSE_UNIQUE,
                'certifications',
                ['course_id'],
                unique=True,
                postgresql_where=sa.text('scope_id IS NULL'),
            )

    if _has_table(inspector, 'certificateuser'):
        cols = _columns(inspector, 'certificateuser')
        if 'award_kind' not in cols:
            op.add_column(
                'certificateuser',
                sa.Column('award_kind', sa.String(length=32), nullable=True),
            )
            op.create_index(
                'ix_certificateuser_award_kind', 'certificateuser', ['award_kind']
            )
        if 'award_detail' not in cols:
            op.add_column(
                'certificateuser',
                sa.Column(
                    'award_detail',
                    sa.JSON(),
                    nullable=False,
                    server_default=sa.text("'{}'::json"),
                ),
            )
            # Drop the server default once the backfill is in place, so new rows
            # go through the model default rather than a DB-level constant.
            op.alter_column('certificateuser', 'award_detail', server_default=None)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if _has_table(inspector, 'certificateuser'):
        cols = _columns(inspector, 'certificateuser')
        if 'award_detail' in cols:
            op.drop_column('certificateuser', 'award_detail')
        if 'award_kind' in cols:
            indexes = {ix['name'] for ix in inspector.get_indexes('certificateuser')}
            if 'ix_certificateuser_award_kind' in indexes:
                op.drop_index('ix_certificateuser_award_kind', 'certificateuser')
            op.drop_column('certificateuser', 'award_kind')

    if _has_table(inspector, 'certifications'):
        indexes = {ix['name'] for ix in inspector.get_indexes('certifications')}
        if _CERT_COURSE_UNIQUE in indexes:
            op.drop_index(_CERT_COURSE_UNIQUE, 'certifications')

        existing_uq = {
            uc['name'] for uc in inspector.get_unique_constraints('certifications')
        }
        if _CERT_SCOPE_UQ in existing_uq:
            op.drop_constraint(
                _CERT_SCOPE_UQ, 'certifications', type_='unique'
            )

        for name, column in (
            ('ix_certifications_scope_id', 'scope_id'),
            ('ix_certifications_scope_kind', 'scope_kind'),
        ):
            indexes = {ix['name'] for ix in inspector.get_indexes('certifications')}
            if name in indexes:
                op.drop_index(name, 'certifications')
            if column in _columns(inspector, 'certifications'):
                op.drop_column('certifications', column)