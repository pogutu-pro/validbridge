'use client'
import React from 'react'
import {
  Loader2, BookOpen, FileText, ChevronRight, ChevronDown,
  Plus, Trash2, Check, Sparkles, Play, RotateCcw, ArrowUpRight,
  LayoutList, Wand2,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import Image from 'next/image'
import lrnaiIcon from 'public/validbridge_ai_icon.png'
import toast from 'react-hot-toast'
import type { CoursePlan, ChapterPlan, ActivityPlan, CreatedChapter } from '@services/ai/courseplanning'
import {
  generateActivityContent,
  parseActivityContentFromStream,
  ENABLE_ACTIVITY_CONTENT_GENERATION,
} from '@services/ai/courseplanning'
import { updateActivity } from '@services/courses/activities'

interface AICoursePreviewProps {
  plan: CoursePlan | null
  createdChapters: CreatedChapter[]
  courseUuid: string | null
  sessionUuid: string | null
  accessToken: string
  onUpdatePlan: (plan: CoursePlan) => void
  isLoading: boolean
  streamingContent: string
  isCourseCreated: boolean
  onCreateCourse: () => void
  isCreatingCourse: boolean
  onOpenInEditor: () => void
}

interface ActivityGenState {
  isGenerating: boolean
  isGenerated: boolean
  streamContent: string
  error: string | null
}

type LeftTab = 'plan' | 'content'

function AICoursePreview({
  plan,
  createdChapters,
  courseUuid,
  sessionUuid,
  accessToken,
  onUpdatePlan,
  isLoading,
  streamingContent,
  isCourseCreated,
  onCreateCourse,
  isCreatingCourse,
  onOpenInEditor,
}: AICoursePreviewProps) {
  const { t } = useTranslation()
  const [activeTab, setActiveTab] = React.useState<LeftTab>('plan')
  const [activityStates, setActivityStates] = React.useState<Record<string, ActivityGenState>>({})

  const totalActivities = createdChapters.reduce((sum, ch) => sum + ch.activities.length, 0)
  const generatedCount = Object.values(activityStates).filter((s) => s.isGenerated).length
  const isAnyGenerating = Object.values(activityStates).some((s) => s.isGenerating)

  const handleGenerateContent = async (
    activityUuid: string,
    activityName: string,
    activityDescription: string,
    chapterName: string
  ) => {
    if (!sessionUuid || !plan) return

    setActivityStates((prev) => ({
      ...prev,
      [activityUuid]: { isGenerating: true, isGenerated: false, streamContent: '', error: null },
    }))

    let fullContent = ''

    const onChunk = (chunk: string) => {
      fullContent += chunk
      setActivityStates((prev) => ({
        ...prev,
        [activityUuid]: { ...prev[activityUuid], streamContent: fullContent },
      }))
    }

    const onComplete = async () => {
      const parsedContent = parseActivityContentFromStream(fullContent)
      if (parsedContent) {
        try {
          const result = await updateActivity({ content: parsedContent }, activityUuid, accessToken)
          if (result.success) {
            setActivityStates((prev) => ({
              ...prev,
              [activityUuid]: { isGenerating: false, isGenerated: true, streamContent: '', error: null },
            }))
          } else {
            throw new Error(result.data?.detail || 'Failed to save content')
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Failed to save'
          setActivityStates((prev) => ({
            ...prev,
            [activityUuid]: { isGenerating: false, isGenerated: false, streamContent: '', error: errorMsg },
          }))
          toast.error(errorMsg)
        }
      } else {
        setActivityStates((prev) => ({
          ...prev,
          [activityUuid]: { isGenerating: false, isGenerated: false, streamContent: '', error: 'Failed to parse content' },
        }))
        toast.error(t('courses.create.ai.content_parse_error'))
      }
    }

    const onError = (error: string) => {
      setActivityStates((prev) => ({
        ...prev,
        [activityUuid]: { isGenerating: false, isGenerated: false, streamContent: '', error },
      }))
      toast.error(error)
    }

    try {
      await generateActivityContent(
        sessionUuid, activityUuid, activityName, activityDescription,
        chapterName, plan.name, plan.description, accessToken,
        onChunk, onComplete, onError
      )
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Unknown error')
    }
  }

  const handleGenerateAll = async () => {
    for (const chapter of createdChapters) {
      for (const activity of chapter.activities) {
        const state = activityStates[activity.activity_uuid]
        if (!state?.isGenerated && !state?.isGenerating) {
          await handleGenerateContent(activity.activity_uuid, activity.name, activity.description, chapter.name)
          await new Promise((resolve) => setTimeout(resolve, 1000))
        }
      }
    }
  }

  // The tabs + content are ALWAYS rendered with the same structure
  return (
    <div className="absolute inset-0 flex flex-col">
      {/* Tab bar - always visible, full width */}
      <div className="flex flex-shrink-0 border-b border-gray-200">
        <button
          onClick={() => setActiveTab('plan')}
          className={cn(
            "flex-1 flex items-center justify-center gap-2 py-2.5 text-xs font-semibold transition-all",
            activeTab === 'plan'
              ? "text-gray-900 border-b-2 border-orange-500 bg-gray-50"
              : "text-gray-400 hover:text-gray-600 hover:bg-gray-50"
          )}
        >
          <LayoutList className="w-3.5 h-3.5" />
          {t('courses.create.ai.tab_plan')}
        </button>
        {ENABLE_ACTIVITY_CONTENT_GENERATION && (
          <button
            onClick={() => setActiveTab('content')}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 py-2.5 text-xs font-semibold transition-all",
              activeTab === 'content'
                ? "text-gray-900 border-b-2 border-orange-500 bg-gray-50"
                : "text-gray-400 hover:text-gray-600 hover:bg-gray-50"
            )}
          >
            <Wand2 className="w-3.5 h-3.5" />
            {t('courses.create.ai.tab_content')}
            {totalActivities > 0 && (
              <span className={cn(
                "ms-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold",
                generatedCount === totalActivities && totalActivities > 0
                  ? "bg-green-100 text-green-700"
                  : "bg-gray-200 text-gray-600"
              )}>
                {generatedCount}/{totalActivities}
              </span>
            )}
          </button>
        )}
      </div>

      {/* Tab content */}
      <div className="flex-1 relative overflow-hidden">
        {activeTab === 'plan' ? (
          <PlanTabContent
            plan={plan}
            onUpdatePlan={onUpdatePlan}
            isLoading={isLoading}
            streamingContent={streamingContent}
            isCourseCreated={isCourseCreated}
            onCreateCourse={onCreateCourse}
            isCreatingCourse={isCreatingCourse}
            onOpenInEditor={onOpenInEditor}
          />
        ) : (
          <ContentTabContent
            plan={plan}
            createdChapters={createdChapters}
            isCourseCreated={isCourseCreated}
            activityStates={activityStates}
            onGenerateContent={handleGenerateContent}
            onGenerateAll={handleGenerateAll}
            totalActivities={totalActivities}
            generatedCount={generatedCount}
            isAnyGenerating={isAnyGenerating}
            onOpenInEditor={onOpenInEditor}
          />
        )}
      </div>
    </div>
  )
}

// ────────────────────────────────────────
// Plan tab content
// ────────────────────────────────────────

function PlanTabContent({
  plan,
  onUpdatePlan,
  isLoading,
  streamingContent,
  isCourseCreated,
  onCreateCourse,
  isCreatingCourse,
  onOpenInEditor,
}: {
  plan: CoursePlan | null
  onUpdatePlan: (plan: CoursePlan) => void
  isLoading: boolean
  streamingContent: string
  isCourseCreated: boolean
  onCreateCourse: () => void
  isCreatingCourse: boolean
  onOpenInEditor: () => void
}) {
  const { t } = useTranslation()

  // Loading first generation
  if (isLoading && !plan) {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div
          style={{ background: 'linear-gradient(135deg, #ff8a4d 0%, #ff5a1f 50%, #e64900 100%)' }}
          className="p-4 rounded-full drop-shadow-md animate-pulse"
        >
          <Image src={lrnaiIcon} alt="AI" width={32} height={32} />
        </div>
        <p className="text-gray-500 mt-4 text-sm">{t('courses.create.ai.generating_plan')}</p>
        {streamingContent && (
          <div className="mt-4 max-w-2xl max-h-[300px] overflow-hidden">
            <pre className="text-xs text-gray-400 font-mono whitespace-pre-wrap break-words">
              {streamingContent.slice(-500)}...
            </pre>
          </div>
        )}
      </div>
    )
  }

  // No plan yet
  if (!plan) {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div
          style={{ background: 'linear-gradient(135deg, #ff8a4d 0%, #ff5a1f 50%, #e64900 100%)' }}
          className="p-4 rounded-full drop-shadow-md"
        >
          <Image src={lrnaiIcon} alt="AI" width={32} height={32} />
        </div>
        <h3 className="text-gray-800 font-semibold mt-4">{t('courses.create.ai.describe_course')}</h3>
        <p className="text-gray-500 text-sm mt-2 text-center max-w-md">{t('courses.create.ai.describe_course_hint')}</p>
      </div>
    )
  }

  return (
    <div className="absolute inset-0 overflow-y-auto p-6 scrollbar-hide">
      <div className="max-w-3xl mx-auto space-y-5">
        {/* Course header */}
        <CoursePlanHeader plan={plan} onUpdatePlan={onUpdatePlan} />

        {/* Chapters */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-700">
              {t('courses.create.ai.chapters')} ({plan.chapters.length})
            </h3>
            <button
              onClick={() => {
                const newChapter: ChapterPlan = { name: `Chapter ${plan.chapters.length + 1}`, description: 'New chapter', activities: [] }
                onUpdatePlan({ ...plan, chapters: [...plan.chapters, newChapter] })
              }}
              className="flex items-center gap-1 text-xs text-orange-600 hover:text-orange-500 transition-colors"
            >
              <Plus className="w-3 h-3" />
              {t('courses.create.ai.add_chapter')}
            </button>
          </div>

          {plan.chapters.map((chapter, ci) => (
            <PlanChapterCard key={ci} chapter={chapter} chapterIndex={ci} plan={plan} onUpdatePlan={onUpdatePlan} />
          ))}
        </div>

        {/* Bottom actions - always visible */}
        <div className="pt-4 pb-8 flex justify-center gap-3">
          {!isCourseCreated ? (
            <button
              onClick={onCreateCourse}
              disabled={isCreatingCourse || isLoading}
              className={cn(
                "flex items-center gap-2 px-8 py-3 rounded-xl text-sm font-semibold transition-all",
                (isCreatingCourse || isLoading)
                  ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                  : "bg-orange-500 text-white hover:bg-orange-600 shadow-sm"
              )}
            >
              {isCreatingCourse ? (
                <><Loader2 className="w-4 h-4 animate-spin" />{t('courses.create.ai.creating_structure')}</>
              ) : (
                t('courses.create.ai.create_course')
              )}
            </button>
          ) : (
            <button
              onClick={onOpenInEditor}
              className="flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold bg-green-600 text-white hover:bg-green-700 shadow-sm transition-all"
            >
              {t('courses.create.ai.open_in_editor')}
              <ArrowUpRight className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ────────────────────────────────────────
// Content tab content
// ────────────────────────────────────────

function ContentTabContent({
  plan,
  createdChapters,
  isCourseCreated,
  activityStates,
  onGenerateContent,
  onGenerateAll,
  totalActivities,
  generatedCount,
  isAnyGenerating,
  onOpenInEditor,
}: {
  plan: CoursePlan | null
  createdChapters: CreatedChapter[]
  isCourseCreated: boolean
  activityStates: Record<string, ActivityGenState>
  onGenerateContent: (uuid: string, name: string, desc: string, chapterName: string) => void
  onGenerateAll: () => void
  totalActivities: number
  generatedCount: number
  isAnyGenerating: boolean
  onOpenInEditor: () => void
}) {
  const { t } = useTranslation()
  const [expandedChapters, setExpandedChapters] = React.useState<Set<number>>(new Set())

  // Use plan chapters as the source (always available), overlay with createdChapters data when available
  const chapters = plan?.chapters || []

  React.useEffect(() => {
    if (chapters.length > 0) {
      setExpandedChapters(new Set(chapters.map((_, i) => i)))
    }
  }, [chapters.length])

  const toggleChapter = (index: number) => {
    const newExpanded = new Set(expandedChapters)
    if (newExpanded.has(index)) newExpanded.delete(index)
    else newExpanded.add(index)
    setExpandedChapters(newExpanded)
  }

  // No plan yet - empty state
  if (!plan || chapters.length === 0) {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center px-8">
        <div className="p-4 rounded-full bg-gray-100 mb-4">
          <Wand2 className="w-7 h-7 text-gray-400" />
        </div>
        <p className="text-gray-400 text-sm text-center max-w-sm">
          {t('courses.create.ai.content_empty_hint')}
        </p>
      </div>
    )
  }

  return (
    <div className="absolute inset-0 overflow-y-auto p-6 scrollbar-hide">
      <div className="max-w-3xl mx-auto space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-gray-900">{t('courses.create.ai.generate_content')}</h3>
            <p className="text-xs text-gray-500 mt-1">{t('courses.create.ai.generate_content_description')}</p>
          </div>
          <div className="flex items-center gap-3">
            {isCourseCreated && (
              <span className="text-xs text-gray-500 tabular-nums">
                {generatedCount}/{totalActivities} {t('courses.create.ai.generated')}
              </span>
            )}
            <button
              onClick={onGenerateAll}
              disabled={!isCourseCreated || isAnyGenerating || generatedCount === totalActivities}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all",
                (!isCourseCreated || isAnyGenerating || generatedCount === totalActivities)
                  ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                  : "bg-orange-500 text-white hover:bg-orange-600"
              )}
            >
              {isAnyGenerating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
              {t('courses.create.ai.generate_all')}
            </button>
          </div>
        </div>

        {/* Chapters and activities - always rendered from plan */}
        <div className="space-y-3">
          {chapters.map((chapter, ci) => {
            const createdChapter = createdChapters[ci]
            const genInChapter = createdChapter
              ? createdChapter.activities.filter(a => activityStates[a.activity_uuid]?.isGenerated).length
              : 0

            return (
              <div key={ci} className="bg-gray-50 rounded-xl ring-1 ring-inset ring-gray-200 overflow-hidden">
                <div
                  className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-100 transition-colors"
                  onClick={() => toggleChapter(ci)}
                >
                  {expandedChapters.has(ci) ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
                  <BookOpen className="w-4 h-4 text-orange-500" />
                  <span className="flex-1 text-sm font-medium text-gray-900">{chapter.name}</span>
                  <span className="text-xs text-gray-500 tabular-nums">
                    {isCourseCreated && createdChapter
                      ? `${genInChapter}/${chapter.activities.length}`
                      : `${chapter.activities.length} ${t('courses.create.ai.activities')}`
                    }
                  </span>
                </div>

                {expandedChapters.has(ci) && (
                  <div className="px-4 pb-3 space-y-2">
                    {chapter.activities.map((activity, ai) => {
                      const createdActivity = createdChapter?.activities[ai]
                      const state = createdActivity ? activityStates[createdActivity.activity_uuid] : null
                      const isGenerating = state?.isGenerating
                      const isGenerated = state?.isGenerated
                      const hasError = state?.error
                      const canGenerate = isCourseCreated && createdActivity

                      return (
                        <div
                          key={ai}
                          className={cn(
                            "flex items-center gap-3 p-3 rounded-lg ring-1 ring-inset transition-all",
                            isGenerated
                              ? "bg-green-50 ring-green-200"
                              : isGenerating
                              ? "bg-orange-50 ring-orange-200"
                              : hasError
                              ? "bg-red-50 ring-red-200"
                              : "bg-white ring-gray-100"
                          )}
                        >
                          <FileText className={cn("w-4 h-4 flex-shrink-0", isGenerated ? "text-green-600" : "text-gray-400")} />
                          <div className="flex-1 min-w-0">
                            <span className="text-sm text-gray-800 block truncate">{activity.name}</span>
                            {activity.description && <p className="text-xs text-gray-400 mt-0.5 line-clamp-1">{activity.description}</p>}
                            {isGenerating && state?.streamContent && (
                              <div className="mt-2 max-h-16 overflow-hidden">
                                <pre className="text-[10px] text-gray-400 font-mono whitespace-pre-wrap break-words">
                                  {state.streamContent.slice(-150)}
                                </pre>
                              </div>
                            )}
                            {hasError && <span className="text-xs text-red-500 mt-1 block">{state?.error}</span>}
                          </div>

                          {isGenerated ? (
                            <div className="flex items-center gap-1 text-green-600 flex-shrink-0">
                              <Check className="w-3.5 h-3.5" />
                              <span className="text-xs">{t('courses.create.ai.done')}</span>
                            </div>
                          ) : isGenerating ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-orange-500 flex-shrink-0" />
                          ) : hasError ? (
                            <button
                              onClick={() => createdActivity && onGenerateContent(createdActivity.activity_uuid, activity.name, activity.description, chapter.name)}
                              className="flex items-center gap-1 px-2 py-1 rounded-md text-xs text-red-600 hover:bg-red-100 transition-colors flex-shrink-0"
                            >
                              <RotateCcw className="w-3 h-3" />
                              {t('courses.create.ai.retry')}
                            </button>
                          ) : (
                            <button
                              onClick={() => canGenerate && onGenerateContent(createdActivity!.activity_uuid, activity.name, activity.description, chapter.name)}
                              disabled={!canGenerate}
                              className={cn(
                                "flex items-center gap-1 px-2.5 py-1 rounded-md text-xs transition-colors flex-shrink-0",
                                canGenerate
                                  ? "text-gray-500 hover:text-orange-600 hover:bg-gray-100"
                                  : "text-gray-300 cursor-not-allowed"
                              )}
                            >
                              <Play className="w-3 h-3" />
                              {t('courses.create.ai.generate')}
                            </button>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* All done */}
        {isCourseCreated && generatedCount === totalActivities && totalActivities > 0 && (
          <div className="bg-green-50 rounded-xl p-4 ring-1 ring-inset ring-green-200">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-100 rounded-full"><Check className="w-5 h-5 text-green-600" /></div>
              <div className="flex-1">
                <h4 className="text-sm font-semibold text-green-700">{t('courses.create.ai.all_content_generated')}</h4>
                <p className="text-xs text-green-600/80 mt-1">{t('courses.create.ai.all_content_generated_hint')}</p>
              </div>
              <button
                onClick={onOpenInEditor}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-green-600 text-white hover:bg-green-700 transition-all"
              >
                {t('courses.create.ai.open_in_editor')}
                <ArrowUpRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ────────────────────────────────────────
// Course header card - always editable
// ────────────────────────────────────────

function CoursePlanHeader({ plan, onUpdatePlan }: { plan: CoursePlan; onUpdatePlan: (plan: CoursePlan) => void }) {
  const [editingName, setEditingName] = React.useState(false)
  const [editingDesc, setEditingDesc] = React.useState(false)
  const [nameValue, setNameValue] = React.useState(plan.name)
  const [descValue, setDescValue] = React.useState(plan.description)

  React.useEffect(() => { setNameValue(plan.name); setDescValue(plan.description) }, [plan.name, plan.description])

  const saveName = () => { if (nameValue.trim()) onUpdatePlan({ ...plan, name: nameValue.trim() }); setEditingName(false) }
  const saveDesc = () => { onUpdatePlan({ ...plan, description: descValue.trim() }); setEditingDesc(false) }

  return (
    <div className="bg-gray-50 rounded-xl p-5 ring-1 ring-inset ring-gray-200">
      <div className="flex items-start gap-4">
        <div
          style={{ background: 'linear-gradient(135deg, #ff8a4d 0%, #ff5a1f 50%, #e64900 100%)' }}
          className="p-3 rounded-xl drop-shadow-md flex-shrink-0"
        >
          <BookOpen className="w-6 h-6 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          {editingName ? (
            <input
              type="text" value={nameValue} onChange={(e) => setNameValue(e.target.value)} onBlur={saveName}
              onKeyDown={(e) => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') { setNameValue(plan.name); setEditingName(false) } }}
              className="w-full bg-white rounded-lg px-3 py-2 text-gray-900 text-lg font-semibold focus:outline-none focus:ring-2 focus:ring-orange-500 ring-1 ring-gray-200" autoFocus
            />
          ) : (
            <h2 onClick={() => setEditingName(true)} className="text-lg font-semibold text-gray-900 cursor-pointer hover:text-orange-600 transition-colors">
              {plan.name}
            </h2>
          )}

          {editingDesc ? (
            <textarea
              value={descValue} onChange={(e) => setDescValue(e.target.value)} onBlur={saveDesc}
              onKeyDown={(e) => { if (e.key === 'Escape') { setDescValue(plan.description); setEditingDesc(false) } }}
              className="w-full mt-2 bg-white rounded-lg px-3 py-2 text-gray-700 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 ring-1 ring-gray-200 min-h-[60px] resize-none" autoFocus
            />
          ) : (
            <p onClick={() => setEditingDesc(true)} className="text-sm text-gray-600 mt-1 cursor-pointer hover:text-gray-800 transition-colors">
              {plan.description}
            </p>
          )}

          {plan.learnings && (
            <div className="flex flex-wrap gap-1.5 mt-3">
              {plan.learnings.split(',').map((l, i) => (
                <span key={i} className="px-2 py-0.5 text-xs bg-orange-100 text-orange-600 rounded-full">{l.trim()}</span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ────────────────────────────────────────
// Plan chapter card - always editable
// ────────────────────────────────────────

function PlanChapterCard({ chapter, chapterIndex, plan, onUpdatePlan }: {
  chapter: ChapterPlan; chapterIndex: number; plan: CoursePlan; onUpdatePlan: (plan: CoursePlan) => void
}) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = React.useState(chapterIndex === 0)
  const [editingName, setEditingName] = React.useState(false)
  const [nameValue, setNameValue] = React.useState(chapter.name)

  React.useEffect(() => setNameValue(chapter.name), [chapter.name])

  const saveName = () => {
    if (nameValue.trim()) {
      const c = [...plan.chapters]; c[chapterIndex] = { ...c[chapterIndex], name: nameValue.trim() }
      onUpdatePlan({ ...plan, chapters: c })
    }
    setEditingName(false)
  }

  return (
    <div className="bg-gray-50 rounded-xl ring-1 ring-inset ring-gray-200 overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-100 transition-colors" onClick={() => setExpanded(!expanded)}>
        {expanded ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
        <BookOpen className="w-4 h-4 text-orange-500" />
        <div className="flex-1 min-w-0">
          {editingName ? (
            <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
              <input type="text" value={nameValue} onChange={(e) => setNameValue(e.target.value)} onBlur={saveName}
                onKeyDown={(e) => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') { setNameValue(chapter.name); setEditingName(false) } }}
                className="flex-1 bg-white rounded px-2 py-1 text-gray-900 text-sm focus:outline-none focus:ring-1 focus:ring-orange-500 ring-1 ring-gray-200" autoFocus />
            </div>
          ) : (
            <span onClick={(e) => { e.stopPropagation(); setEditingName(true) }} className="text-sm font-medium text-gray-900 hover:text-orange-600 cursor-pointer">
              {chapter.name}
            </span>
          )}
        </div>
        <span className="text-xs text-gray-500">{chapter.activities.length} {t('courses.create.ai.activities')}</span>
        <button onClick={(e) => { e.stopPropagation(); onUpdatePlan({ ...plan, chapters: plan.chapters.filter((_, i) => i !== chapterIndex) }) }}
          className="p-1 hover:bg-red-100 rounded transition-colors">
          <Trash2 className="w-3 h-3 text-red-500" />
        </button>
      </div>

      {expanded && (
        <div className="px-4 pb-3 space-y-2">
          {chapter.activities.map((activity, ai) => (
            <PlanActivityItem
              key={ai}
              activity={activity}
              activityIndex={ai}
              chapterIndex={chapterIndex}
              plan={plan}
              onUpdatePlan={onUpdatePlan}
            />
          ))}

          <button
            onClick={() => {
              const newAct: ActivityPlan = { name: `Activity ${chapter.activities.length + 1}`, type: 'TYPE_DYNAMIC', description: 'New activity', suggested_blocks: ['heading', 'paragraph'] }
              const c = [...plan.chapters]; c[chapterIndex] = { ...c[chapterIndex], activities: [...c[chapterIndex].activities, newAct] }
              onUpdatePlan({ ...plan, chapters: c })
            }}
            className="flex items-center gap-1 w-full justify-center py-2 text-xs text-gray-500 hover:text-orange-600 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <Plus className="w-3 h-3" />
            {t('courses.create.ai.add_activity')}
          </button>
        </div>
      )}
    </div>
  )
}

// ────────────────────────────────────────
// Plan activity item - extracted to fix hooks-in-map
// ────────────────────────────────────────

function PlanActivityItem({ activity, activityIndex, chapterIndex, plan, onUpdatePlan }: {
  activity: ActivityPlan; activityIndex: number; chapterIndex: number; plan: CoursePlan; onUpdatePlan: (plan: CoursePlan) => void
}) {
  const [editing, setEditing] = React.useState(false)
  const [val, setVal] = React.useState(activity.name)
  React.useEffect(() => setVal(activity.name), [activity.name])

  const save = () => {
    if (val.trim()) {
      const c = [...plan.chapters]; const a = [...c[chapterIndex].activities]
      a[activityIndex] = { ...a[activityIndex], name: val.trim() }; c[chapterIndex] = { ...c[chapterIndex], activities: a }
      onUpdatePlan({ ...plan, chapters: c })
    }
    setEditing(false)
  }

  const remove = () => {
    const c = [...plan.chapters]
    c[chapterIndex] = { ...c[chapterIndex], activities: c[chapterIndex].activities.filter((_, i) => i !== activityIndex) }
    onUpdatePlan({ ...plan, chapters: c })
  }

  return (
    <div className="flex items-start gap-3 p-3 bg-white rounded-lg ring-1 ring-inset ring-gray-100">
      <FileText className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        {editing ? (
          <input type="text" value={val} onChange={(e) => setVal(e.target.value)} onBlur={save}
            onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { setVal(activity.name); setEditing(false) } }}
            className="w-full bg-white rounded px-2 py-1 text-gray-900 text-sm focus:outline-none focus:ring-1 focus:ring-orange-500 ring-1 ring-gray-200" autoFocus />
        ) : (
          <span onClick={() => setEditing(true)} className="text-sm text-gray-800 hover:text-orange-600 cursor-pointer">{activity.name}</span>
        )}
        {activity.description && <p className="text-xs text-gray-400 mt-0.5 line-clamp-1">{activity.description}</p>}
      </div>
      <button onClick={remove} className="p-1 hover:bg-red-100 rounded transition-colors flex-shrink-0">
        <Trash2 className="w-3 h-3 text-red-500" />
      </button>
    </div>
  )
}

export default AICoursePreview