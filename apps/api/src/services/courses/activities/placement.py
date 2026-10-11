"""Where a new activity goes inside a chapter."""

from fastapi import HTTPException
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from src.db.courses.activities import Activity
from src.db.courses.chapter_activities import ChapterActivity


async def make_room_for_insert(
    db_session: AsyncSession,
    chapter_id: int,
    target_activity_uuid: str,
    position: str | None,
) -> int:
    """Open a slot next to ``target_activity_uuid`` and return its order value.

    Every activity at or after the slot moves down by one, in the caller's
    transaction, so the new activity and the shift commit together and the
    chapter is never left with two activities competing for one position.

    Raises 400 when the target is not in this chapter. Guessing a position
    instead would put the activity somewhere the author did not ask for.
    """
    target_order = (await db_session.execute(
        select(ChapterActivity.order)
        .join(Activity, Activity.id == ChapterActivity.activity_id)  # type: ignore
        .where(
            Activity.activity_uuid == target_activity_uuid,
            ChapterActivity.chapter_id == chapter_id,
        )
    )).scalars().first()
    if target_order is None:
        raise HTTPException(
            status_code=400,
            detail="The activity to insert next to is not in this chapter",
        )

    new_order = target_order if position == "above" else target_order + 1
    await db_session.execute(
        update(ChapterActivity)
        .where(
            ChapterActivity.chapter_id == chapter_id,  # type: ignore
            ChapterActivity.order >= new_order,  # type: ignore
        )
        .values(order=ChapterActivity.order + 1)
    )
    return new_order
