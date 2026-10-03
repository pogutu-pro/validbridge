from typing import List, Optional
from sqlalchemy import Column, Enum as SAEnum, ForeignKey, Index, Integer
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel
from enum import Enum
from pydantic import BaseModel
from src.db.users import UserRead
from src.db.trails import TrailRead
from src.db.courses.chapters import ChapterRead
from src.db.resource_authors import ResourceAuthorshipEnum, ResourceAuthorshipStatusEnum


class CourseSEO(BaseModel):
    """SEO configuration for a course stored as JSON"""
    # Basic SEO
    title: Optional[str] = None
    description: Optional[str] = None
    keywords: Optional[str] = None
    canonical_url: Optional[str] = None
    # Open Graph
    og_title: Optional[str] = None
    og_description: Optional[str] = None
    og_image: Optional[str] = None
    # Twitter Card
    twitter_card: Optional[str] = None  # 'summary' | 'summary_large_image'
    twitter_title: Optional[str] = None
    twitter_description: Optional[str] = None
    # Robots & Structured Data
    robots_noindex: bool = False
    robots_nofollow: bool = False
    enable_jsonld: bool = True


class ThumbnailType(str, Enum):
    IMAGE = "image"
    VIDEO = "video"
    BOTH = "both"


class ProgressionPolicy(str, Enum):
    """Whether a course gates chapters behind each other's assessments.

    OFF is the default and the only state a course is in unless an instructor
    explicitly turns gating on. Nothing here is inferred from the presence of
    assessments: a course full of exams that nobody asked to sequence stays open.
    """

    OFF = "off"
    SEQUENTIAL = "sequential"


class UnlockRequirement(str, Enum):
    """What a learner must achieve on chapter N's assessments to open chapter N+1.

    SUBMITTED  handing the work in is enough.
    PASSED     hand in AND clear the assessment's own pass threshold.

    Both are legitimate, which is why the instructor picks rather than the product
    imposing one: some cohorts need to finish the material before moving on,
    others need to demonstrate it.
    """

    SUBMITTED = "submitted"
    PASSED = "passed"


class LockoutPolicy(str, Enum):
    """What happens to a learner who fails an assessment that blocks them.

    BLOCK_WITH_OVERRIDE is the safe default: they stop, and an instructor can
    release them. NEVER_BLOCK downgrades a block to a warning, for courses where
    trapping a learner is worse than letting them continue unscored.
    """

    BLOCK_WITH_OVERRIDE = "block_with_override"
    NEVER_BLOCK = "never_block"


class AuthorWithRole(SQLModel):
    user: UserRead
    authorship: ResourceAuthorshipEnum
    authorship_status: ResourceAuthorshipStatusEnum
    creation_date: str
    update_date: str


class CourseBase(SQLModel):
    name: str
    description: Optional[str] = None
    about: Optional[str] = None
    learnings: Optional[str] = None
    tags: Optional[str] = None
    thumbnail_type: Optional[ThumbnailType] = Field(default=ThumbnailType.IMAGE)
    thumbnail_image: Optional[str] = Field(default="")
    thumbnail_video: Optional[str] = Field(default="")
    public: bool
    published: bool = Field(default=False)
    open_to_contributors: bool


class Course(CourseBase, table=True):
    __table_args__ = (
        Index("ix_course_org_public_published_created", "org_id", "public", "published", "creation_date"),
        {"extend_existing": True},
    )
    id: Optional[int] = Field(default=None, primary_key=True)
    thumbnail_type: Optional[ThumbnailType] = Field(
        default=ThumbnailType.IMAGE,
        sa_column=Column(SAEnum(ThumbnailType, name="thumbnail_type"), nullable=True),
    )
    org_id: int = Field(
        sa_column=Column(Integer, ForeignKey("organization.id", ondelete="CASCADE"), index=True)
    )
    course_uuid: str = Field(default="", index=True)
    creation_date: str = ""
    update_date: str = ""
    seo: Optional[dict] = Field(default=None, sa_column=Column(JSONB))
    extra_metadata: Optional[dict] = Field(default=None, sa_column=Column(JSONB))
    # Sequential chapter gating. NULL means "not configured" and therefore OFF:
    # an absent policy must never be able to block a learner. See
    # ProgressionPolicy / UnlockRequirement / LockoutPolicy.
    progression_config: Optional[dict] = Field(default=None, sa_column=Column(JSONB))


class CourseCreate(CourseBase):
    org_id: int = Field(default=None, foreign_key="organization.id")
    thumbnail_type: Optional[ThumbnailType] = Field(default=ThumbnailType.IMAGE)
    thumbnail_image: Optional[str] = Field(default="")
    thumbnail_video: Optional[str] = Field(default="")
    extra_metadata: Optional[dict] = None
    pass


class CourseUpdate(SQLModel):
    name: Optional[str] = None
    description: Optional[str] = None
    about: Optional[str] = None
    learnings: Optional[str] = None
    tags: Optional[str] = None
    thumbnail_type: Optional[ThumbnailType] = None
    thumbnail_image: Optional[str] = None
    thumbnail_video: Optional[str] = None
    public: Optional[bool] = None
    published: Optional[bool] = None
    open_to_contributors: Optional[bool] = None
    seo: Optional[dict] = None
    extra_metadata: Optional[dict] = None
    # Setting this to None switches gating off again, which is the intended way
    # to turn the feature off without a separate delete endpoint.
    progression_config: Optional[dict] = None


class CourseRead(CourseBase):
    id: int
    org_id: int = Field(default=None, foreign_key="organization.id")
    authors: List[AuthorWithRole]
    course_uuid: str
    creation_date: str
    update_date: str
    thumbnail_type: Optional[ThumbnailType] = Field(default=ThumbnailType.IMAGE)
    thumbnail_image: Optional[str] = Field(default="")
    thumbnail_video: Optional[str] = Field(default="")
    seo: Optional[dict] = None
    extra_metadata: Optional[dict] = None


class FullCourseRead(CourseBase):
    id: int
    org_id: int
    org_uuid: Optional[str] = None
    course_uuid: Optional[str] = None
    creation_date: Optional[str] = None
    update_date: Optional[str] = None
    thumbnail_type: Optional[ThumbnailType] = Field(default=ThumbnailType.IMAGE)
    thumbnail_image: Optional[str] = Field(default="")
    thumbnail_video: Optional[str] = Field(default="")
    seo: Optional[dict] = None
    extra_metadata: Optional[dict] = None
    # Chapters, Activities
    chapters: List[ChapterRead]
    authors: List[AuthorWithRole]
    pass


class FullCourseReadWithTrail(CourseBase):
    id: int
    course_uuid: Optional[str] = None
    creation_date: Optional[str] = None
    update_date: Optional[str] = None
    org_id: int = Field(default=None, foreign_key="organization.id")
    seo: Optional[dict] = None
    extra_metadata: Optional[dict] = None
    authors: List[AuthorWithRole]
    # Chapters, Activities
    chapters: List[ChapterRead]
    # Trail
    trail: TrailRead | None = None
    pass
