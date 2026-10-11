"""Inserting an activity above or below another one inside a chapter."""

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlmodel import select

from src.db.courses.activities import (
    Activity,
    ActivityCreate,
    ActivitySubTypeEnum,
    ActivityTypeEnum,
)
from src.db.courses.chapter_activities import ChapterActivity
from src.db.courses.chapters import Chapter
from src.services.courses.activities.placement import make_room_for_insert


async def _chapter(db, org, course, name):
    chapter = Chapter(
        name=name, description="", org_id=org.id, course_id=course.id,
        chapter_uuid=f"chapter_pl_{name}", creation_date="x", update_date="x",
    )
    db.add(chapter)
    await db.commit()
    await db.refresh(chapter)
    return chapter


async def _lessons(db, org, course, chapter, names, base_id):
    """Activities placed in order 0..n-1; returns {name: uuid}."""
    uuids = {}
    for i, name in enumerate(names):
        activity = Activity(
            id=base_id + i, name=name, activity_uuid=f"activity_pl_{base_id + i}",
            activity_type=ActivityTypeEnum.TYPE_DYNAMIC,
            activity_sub_type=ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE,
            published=True, org_id=org.id, course_id=course.id, content={},
            creation_date="x", update_date="x",
        )
        db.add(activity)
        db.add(ChapterActivity(
            activity_id=activity.id, course_id=course.id, chapter_id=chapter.id,
            org_id=org.id, order=i, creation_date="x", update_date="x",
        ))
        uuids[name] = activity.activity_uuid
    await db.commit()
    return uuids


async def _order_of_names(db, chapter):
    rows = (await db.execute(
        select(Activity.name, ChapterActivity.order)
        .join(ChapterActivity, ChapterActivity.activity_id == Activity.id)
        .where(ChapterActivity.chapter_id == chapter.id)
        .order_by(ChapterActivity.order)
    )).all()
    return [name for name, _ in rows], [order for _, order in rows]


@pytest.mark.asyncio
async def test_below_opens_the_slot_right_after_the_target(db, org, course):
    chapter = await _chapter(db, org, course, "A")
    ids = await _lessons(db, org, course, chapter, ["l1", "l2", "l3"], 8100)

    order = await make_room_for_insert(db, chapter.id, ids["l1"], "below")
    assert order == 1
    await db.commit()
    names, orders = await _order_of_names(db, chapter)
    # l1 stays at 0; l2 and l3 moved down, leaving order 1 free for the new one.
    assert names == ["l1", "l2", "l3"] and orders == [0, 2, 3]


@pytest.mark.asyncio
async def test_above_takes_the_targets_position(db, org, course):
    chapter = await _chapter(db, org, course, "B")
    ids = await _lessons(db, org, course, chapter, ["l1", "l2", "l3"], 8200)

    order = await make_room_for_insert(db, chapter.id, ids["l2"], "above")
    assert order == 1
    await db.commit()
    _, orders = await _order_of_names(db, chapter)
    assert orders == [0, 2, 3]


@pytest.mark.asyncio
async def test_default_position_is_below_and_last_item_works(db, org, course):
    chapter = await _chapter(db, org, course, "C")
    ids = await _lessons(db, org, course, chapter, ["l1", "l2"], 8300)

    assert await make_room_for_insert(db, chapter.id, ids["l2"], None) == 2
    _, orders = await _order_of_names(db, chapter)
    assert orders == [0, 1]  # nothing after the last item needed to move


@pytest.mark.asyncio
async def test_other_chapters_are_not_shifted(db, org, course):
    first = await _chapter(db, org, course, "D1")
    second = await _chapter(db, org, course, "D2")
    ids = await _lessons(db, org, course, first, ["a1", "a2"], 8400)
    await _lessons(db, org, course, second, ["b1", "b2"], 8500)

    await make_room_for_insert(db, first.id, ids["a1"], "above")
    await db.commit()
    _, orders = await _order_of_names(db, second)
    assert orders == [0, 1]


@pytest.mark.asyncio
async def test_target_in_another_chapter_is_refused(db, org, course):
    first = await _chapter(db, org, course, "E1")
    second = await _chapter(db, org, course, "E2")
    ids = await _lessons(db, org, course, first, ["x1"], 8600)

    with pytest.raises(HTTPException) as exc:
        await make_room_for_insert(db, second.id, ids["x1"], "below")
    assert exc.value.status_code == 400

    with pytest.raises(HTTPException):
        await make_room_for_insert(db, first.id, "activity_does_not_exist", "below")


def test_create_model_accepts_placement_and_rejects_bad_position():
    base = dict(
        name="n", chapter_id=1, activity_type=ActivityTypeEnum.TYPE_DYNAMIC,
        activity_sub_type=ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE,
    )
    ok = ActivityCreate(**base, insert_relative_to="activity_x", insert_position="above")
    assert ok.insert_position == "above"
    assert ActivityCreate(**base).insert_relative_to is None
    with pytest.raises(ValidationError):
        ActivityCreate(**base, insert_relative_to="activity_x", insert_position="sideways")
