from enum import Enum
from typing import Optional
from sqlalchemy import JSON, Column, ForeignKey, UniqueConstraint
from sqlmodel import Field, SQLModel


class CredentialScopeKind(str, Enum):
    """What a credential is awarded for.

    A whole-course certificate is the original case and stays the default, so
    every existing ``Certifications`` row keeps behaving exactly as before
    (NULL ``scope_kind`` reads as COURSE). CHAPTER exists so a chapter can carry
    its own shareable progress credential — a "milestone" — without inventing a
    parallel set of tables and re-implementing issuance, verification and export
    a second time.
    """

    COURSE = "COURSE"
    CHAPTER = "CHAPTER"


class AwardKind(str, Enum):
    """How strong a granted credential is.

    Only meaningful for non-COURSE scopes, and only ever escalated: a learner who
    fails a chapter test and retries earns PARTICIPATED first and is upgraded to
    PASSED in place when they pass. The two are deliberately different labels —
    a "passed" card claims demonstrated skill, a "participated" card does not —
    so an existing shared link must never silently change meaning.
    """

    PASSED = "PASSED"
    PARTICIPATED = "PARTICIPATED"
    COMPLETED = "COMPLETED"


class CertificationBase(SQLModel):
    course_id: int = Field(sa_column= Column("course_id", ForeignKey("course.id", ondelete="CASCADE")))
    config: dict = Field(default_factory=dict, sa_column= Column("config", JSON))
    # The bar a learner must clear on the course's WEIGHTED aggregate.
    #
    # Nullable on purpose, and it has no database default: a NULL means "use
    # DEFAULT_WEIGHTED_PASS_THRESHOLD (50)", which is the same bar the legacy
    # all-must-pass gate already applied. Backfilling every existing
    # certification with 50 would look identical today but would quietly freeze
    # the default into data, so a later change to the default could no longer
    # reach those courses. It is ignored entirely in AND mode.
    pass_threshold_percentage: Optional[float] = Field(default=None)


class Certifications(CertificationBase, table=True):
    # One credential template per scope. For COURSE, scope_id is NULL, and
    # Postgres treats NULLs as distinct in a unique index — so the partial
    # index below (migration) is what actually enforces one-per-course. For
    # CHAPTER, scope_id is the chapter id and this constraint is exact.
    __table_args__ = (
        UniqueConstraint(
            "course_id", "scope_kind", "scope_id",
            name="uq_certifications_course_scope",
        ),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    certification_uuid: str = Field(unique=True)
    course_id: int = Field(sa_column= Column("course_id", ForeignKey("course.id", ondelete="CASCADE")))
    config: dict = Field(default_factory=dict, sa_column= Column("config", JSON))
    # NULL scope_kind means COURSE (pre-existing rows). See CredentialScopeKind.
    scope_kind: Optional[str] = Field(default=CredentialScopeKind.COURSE.value, index=True)
    # chapter.id for CHAPTER scope, NULL for COURSE scope.
    scope_id: Optional[int] = Field(default=None, index=True)
    creation_date: str = ""
    update_date: str = ""

    @property
    def resolved_scope_kind(self) -> CredentialScopeKind:
        """Scope with the NULL-means-COURSE legacy default applied."""
        try:
            return CredentialScopeKind(self.scope_kind or CredentialScopeKind.COURSE.value)
        except ValueError:
            return CredentialScopeKind.COURSE


class CertificationCreate(SQLModel):
    course_id: int
    config: dict = Field(default_factory=dict)
    scope_kind: Optional[CredentialScopeKind] = CredentialScopeKind.COURSE
    scope_id: Optional[int] = None
    pass_threshold_percentage: Optional[float] = Field(default=None, ge=0, le=100)

class CertificationUpdate(SQLModel):
    config: Optional[dict] = None
    scope_kind: Optional[CredentialScopeKind] = None
    scope_id: Optional[int] = None
    pass_threshold_percentage: Optional[float] = Field(default=None, ge=0, le=100)


class CertificationRead(SQLModel):
    id: int
    certification_uuid: str
    course_id: int
    config: dict
    scope_kind: Optional[str] = None
    scope_id: Optional[int] = None
    # Echoed raw (None = "use the default"), not resolved, so the author UI can
    # show an untouched field as untouched instead of implying 50 was chosen.
    pass_threshold_percentage: Optional[float] = None
    creation_date: str
    update_date: str


class CertificateUserBase(SQLModel):
    user_id: int = Field(sa_column= Column("user_id", ForeignKey("user.id", ondelete="CASCADE")))
    certification_id: int = Field(sa_column= Column("certification_id", ForeignKey("certifications.id", ondelete="CASCADE")))
    user_certification_uuid: str

class CertificateUser(CertificateUserBase, table=True):
    # A user can hold at most one certificate per certification. Enforced in the
    # DB so a race between two concurrent completion checks (e.g. the submit path
    # and a parallel grade) can't create duplicate certificate rows.
    __table_args__ = (
        UniqueConstraint(
            "user_id", "certification_id", name="uq_certificateuser_user_certification"
        ),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(sa_column= Column("user_id", ForeignKey("user.id", ondelete="CASCADE")))
    certification_id: int = Field(sa_column= Column("certification_id", ForeignKey("certifications.id", ondelete="CASCADE")))
    user_certification_uuid: str = Field(unique=True, index=True)
    # See AwardKind. NULL on pre-existing rows and on course certificates, where
    # possession alone is the claim.
    award_kind: Optional[str] = Field(default=None, index=True)
    # Immutable snapshot of the facts as awarded: the score, the percentage, the
    # skills the learner demonstrated, and the chapter's position in the course.
    # Snapshotted rather than read live because the verification URL is public
    # and shareable — an instructor renaming a chapter or re-grading a CAT next
    # month must not silently rewrite what a credential already in someone's
    # feed says it was.
    award_detail: dict = Field(default_factory=dict, sa_column= Column("award_detail", JSON))
    created_at: str = ""
    updated_at: str = ""

    @property
    def resolved_award_kind(self) -> AwardKind:
        """Award kind with the legacy default (a plain course certificate) applied."""
        try:
            return AwardKind(self.award_kind or AwardKind.COMPLETED.value)
        except ValueError:
            return AwardKind.COMPLETED


class CertificateUserCreate(SQLModel):
    user_id: int
    certification_id: int
    user_certification_uuid: str
    award_kind: Optional[AwardKind] = None
    award_detail: dict = Field(default_factory=dict)

class CertificateUserRead(SQLModel):
    id: int
    user_id: int
    certification_id: int
    user_certification_uuid: str
    award_kind: Optional[str] = None
    award_detail: dict = Field(default_factory=dict)
    created_at: str
    updated_at: str


class CertificateUserUpdate(SQLModel):
    user_id: Optional[int] = None
    certification_id: Optional[int] = None
    user_certification_uuid: Optional[str] = None
    award_kind: Optional[AwardKind] = None
    award_detail: Optional[dict] = None

