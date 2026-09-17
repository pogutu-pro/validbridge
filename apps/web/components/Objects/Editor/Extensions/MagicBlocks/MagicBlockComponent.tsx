import { NodeViewProps, NodeViewWrapper } from '@tiptap/react'
import { Node } from '@tiptap/core'
import { X, Edit3, Expand, GripHorizontal, Lock } from 'lucide-react'
import React from 'react'
import { v4 as uuidv4 } from 'uuid'
import Image from 'next/image'
import lrnaiIcon from 'public/validbridge_ai_icon.png'
import { useEditorProvider } from '@components/Contexts/Editor/EditorContext'
import { useVBSession } from '@components/Contexts/VBSessionContext'
import { useCourse } from '@components/Contexts/CourseContext'
import { useOrg } from '@components/Contexts/OrgContext'
import { cn } from '@/lib/utils'
import MagicBlockModal from './MagicBlockModal'
import MagicBlockPreview from './MagicBlockPreview'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import type { MagicBlockContext, MagicBlockMessage } from './types'
import { getMagicBlockSession } from '@services/ai/magicblocks'
import { PlanLevel } from '@services/plans/plans'
import PlanBadge from '@components/Dashboard/Shared/PlanRestricted/PlanBadge'
import { useTranslation } from 'react-i18next'
import { usePlan } from '@components/Hooks/usePlan'

interface EditorState {
  isEditable: boolean
}

interface Session {
  data?: {
    tokens?: {
      access_token?: string
    }
  }
}

interface Course {
  courseStructure: {
    course_uuid: string
    name: string
    description: string
  }
}

interface ExtendedNodeViewProps extends Omit<NodeViewProps, 'extension'> {
  extension: Node & {
    options: {
      activity: {
        activity_uuid: string
        name: string
        content?: any
      }
    }
  }
}

function MagicBlockComponent(props: ExtendedNodeViewProps) {
  const { t } = useTranslation()
  const { node, extension, updateAttributes } = props
  const editorState = useEditorProvider() as EditorState
  const session = useVBSession() as Session
  const course = useCourse() as Course | null
  const orgContext = useOrg() as any

  const [isModalOpen, setIsModalOpen] = React.useState(false)
  const [isPreviewModalOpen, setIsPreviewModalOpen] = React.useState(false)
  const [cachedMessages, setCachedMessages] = React.useState<MagicBlockMessage[]>([])
  const [isResizing, setIsResizing] = React.useState(false)

  const isEditable = editorState?.isEditable
  const accessToken = session?.data?.tokens?.access_token

  // Check plan for AI features
  const currentPlan = usePlan()
  const rf = orgContext?.config?.config?.resolved_features
  const canUseAI = rf?.ai?.enabled === true

  // Get attributes from node
  const blockUuid = node.attrs.blockUuid || `magic_${uuidv4()}`
  const sessionUuid = node.attrs.sessionUuid
  const htmlContent = node.attrs.htmlContent
  const iterationCount = node.attrs.iterationCount || 0
  const height = node.attrs.height || 400

  // Predefined height options
  const PRESET_HEIGHTS = [
    { label: 'S', value: 300 },
    { label: 'M', value: 450 },
    { label: 'L', value: 600 },
    { label: 'XL', value: 800 },
    { label: 'XXL', value: 1200 },
  ]

  // Resize handlers
  const handleResizeStart = React.useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsResizing(true)

    const startY = e.clientY
    const startHeight = height

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaY = moveEvent.clientY - startY
      const newHeight = Math.max(200, Math.min(1500, startHeight + deltaY))
      updateAttributes({ height: newHeight })
    }

    const handleMouseUp = () => {
      setIsResizing(false)
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [height, updateAttributes])

  const handlePresetHeight = (presetHeight: number) => {
    updateAttributes({ height: presetHeight })
  }

  // Ensure block has a UUID
  React.useEffect(() => {
    if (!node.attrs.blockUuid) {
      queueMicrotask(() => updateAttributes({ blockUuid }))
    }
  }, [node.attrs.blockUuid, blockUuid, updateAttributes])

  // Load session messages when opening modal with existing session
  React.useEffect(() => {
    if (isModalOpen && sessionUuid && accessToken && cachedMessages.length === 0) {
      getMagicBlockSession(sessionUuid, accessToken).then((result) => {
        if (result.success && result.data?.message_history) {
          setCachedMessages(result.data.message_history)
        }
      })
    }
  }, [isModalOpen, sessionUuid, accessToken, cachedMessages.length])

  // Build context from course and activity
  const buildContext = (): MagicBlockContext => {
    const activityContent = extension.options.activity.content
    let contentSummary = ''

    if (activityContent?.content) {
      // Extract text from editor content
      const extractText = (nodes: any[]): string => {
        return nodes
          .map((node) => {
            if (node.type === 'text') return node.text || ''
            if (node.type === 'paragraph' && node.content) {
              return extractText(node.content)
            }
            if (node.type === 'heading' && node.content) {
              return extractText(node.content)
            }
            if (node.content) return extractText(node.content)
            return ''
          })
          .join(' ')
          .slice(0, 500) // Limit to 500 chars
      }
      contentSummary = extractText(activityContent.content)
    }

    return {
      course_title: course?.courseStructure?.name || 'Course',
      course_description: course?.courseStructure?.description || '',
      activity_name: extension.options.activity.name || 'Activity',
      activity_content_summary: contentSummary,
    }
  }

  const handleSave = (
    newHtmlContent: string,
    newSessionUuid: string,
    newIterationCount: number
  ) => {
    updateAttributes({
      htmlContent: newHtmlContent,
      sessionUuid: newSessionUuid,
      iterationCount: newIterationCount,
    })
  }

  const handleRemove = () => {
    updateAttributes({
      htmlContent: null,
      sessionUuid: null,
      iterationCount: 0,
    })
    setCachedMessages([])
  }

  // Preview mode - show iframe only
  if (!isEditable && htmlContent) {
    return (
      <>
        <NodeViewWrapper className="block-magic w-full">
          <div className="relative group">
            <div className="rounded-xl overflow-hidden nice-shadow" style={{ height: `${height}px` }}>
              <MagicBlockPreview htmlContent={htmlContent} />
            </div>
            <button
              onClick={() => setIsPreviewModalOpen(true)}
              className="absolute top-2 end-2 p-2 bg-black/50 hover:bg-black/70 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
              title={t('editor.blocks.common.expand')}
            >
              <Expand className="w-4 h-4 text-white" />
            </button>
          </div>
        </NodeViewWrapper>

        <Modal
          isDialogOpen={isPreviewModalOpen}
          onOpenChange={setIsPreviewModalOpen}
          dialogTitle={t('editor.blocks.magic_block_content.interactive_element')}
          minWidth="xl"
          minHeight="lg"
          dialogContent={
            <div className="w-full h-[70vh]">
              <MagicBlockPreview htmlContent={htmlContent} />
            </div>
          }
        />
      </>
    )
  }

  // Preview mode - no content
  if (!isEditable && !htmlContent) {
    return null
  }

  // Edit mode
  return (
    <>
      <NodeViewWrapper className="block-magic w-full">
        <div
          className="rounded-2xl border border-border bg-white px-5 py-4 shadow-sm transition-all ease-linear"
        >
          {/* Header */}
          <div className="flex items-center justify-between pb-3">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <Image
                  className="outline outline-1 outline-neutral-200 rounded-lg"
                  width={20}
                  src={lrnaiIcon}
                  alt="Magic Block"
                />
                <span className="text-sm font-semibold text-foreground">
                  {t('editor.blocks.magic_block_content.title')}
                </span>
              </div>
              {sessionUuid && (
                <div className="bg-secondary text-muted-foreground py-0.5 px-3 flex space-x-1 rounded-full items-center border border-border">
                  <span className="text-xs font-semibold antialiased">
                    {t('editor.blocks.magic_block_content.iterations', { count: iterationCount, max: 6 })}
                  </span>
                </div>
              )}
            </div>
            {htmlContent && (
              <X
                size={20}
                className="text-muted-foreground hover:cursor-pointer bg-secondary p-1 rounded-full items-center hover:bg-red-50 hover:text-red-600 transition-colors"
                onClick={handleRemove}
              />
            )}
          </div>

          {/* Content area */}
          {!htmlContent ? (
            // No content - show create button or plan restriction
            <div className="text-center py-8">
              {canUseAI ? (
                <div className="inline-flex flex-col items-center gap-3">
                  <div
                    style={{
                      background: 'linear-gradient(135deg, #ff8a4d 0%, #ff5a1f 50%, #e64900 100%)',
                    }}
                    className="p-4 rounded-full drop-shadow-md"
                  >
                    <Image src={lrnaiIcon} alt="Magic Block" width={32} height={32} />
                  </div>
                  <div className="space-y-1">
                    <p className="font-semibold text-foreground">
                      {t('editor.blocks.magic_block_content.create_interactive')}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {t('editor.blocks.magic_block_content.generate_description')}
                    </p>
                  </div>
                  <button
                    onClick={() => setIsModalOpen(true)}
                    style={{
                      background: 'linear-gradient(135deg, #ff8a4d 0%, #ff5a1f 50%, #e64900 100%)',
                    }}
                    className="mt-2 px-5 py-2.5 text-white text-sm font-bold rounded-full transition-all duration-300 ease-in-out hover:scale-105 flex items-center gap-2 drop-shadow-md"
                  >
                    <Image
                      className="outline outline-1 outline-neutral-200/20 rounded-md"
                      width={16}
                      src={lrnaiIcon}
                      alt=""
                    />
                    {t('editor.blocks.magic_block_content.generate_with_ai')}
                  </button>
                </div>
              ) : (
                <div className="inline-flex flex-col items-center gap-3">
                  <div className="p-4 rounded-full bg-secondary">
                    <Lock className="w-8 h-8 text-muted-foreground" />
                  </div>
                  <div className="space-y-1">
                    <p className="font-semibold text-foreground flex items-center gap-2 justify-center">
                      {t('editor.blocks.magic_block_content.title')}
                      <PlanBadge currentPlan={currentPlan} requiredPlan={(rf?.ai?.required_plan || 'standard') as PlanLevel} size="sm" alwaysShow />
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {t('editor.blocks.magic_block_content.upgrade_required')}
                    </p>
                  </div>
                  <div className="mt-2 px-5 py-2.5 bg-secondary text-muted-foreground text-sm font-bold rounded-full flex items-center gap-2 cursor-not-allowed">
                    <Image
                      className="outline outline-1 outline-neutral-200/20 rounded-md opacity-50 grayscale"
                      width={16}
                      src={lrnaiIcon}
                      alt=""
                    />
                    {t('editor.blocks.magic_block_content.generate_with_ai')}
                  </div>
                </div>
              )}
            </div>
          ) : (
            // Has content - show preview with edit button
            <div className="space-y-3">
              <div
                className="rounded-lg overflow-hidden border border-border relative"
                style={{ height: `${height}px` }}
              >
                <MagicBlockPreview htmlContent={htmlContent} />
              </div>
              <div className="flex justify-between items-center">
                {/* Resize controls */}
                <div className="flex items-center gap-2">
                  {/* Preset heights */}
                  <div className="flex items-center gap-1">
                    {PRESET_HEIGHTS.map((preset) => (
                      <button
                        key={preset.label}
                        onClick={() => handlePresetHeight(preset.value)}
                        className={cn(
                          "px-2 py-0.5 text-xs font-medium rounded transition-colors",
                          height === preset.value
                            ? "bg-primary text-primary-foreground"
                            : "bg-secondary text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                        )}
                        title={`${preset.value}px`}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                  {/* Drag resize handle */}
                  <div
                    onMouseDown={handleResizeStart}
                    className={cn(
                      "flex items-center gap-1 px-2 py-0.5 cursor-ns-resize text-muted-foreground hover:text-foreground transition-colors select-none rounded bg-secondary hover:bg-accent",
                      isResizing && "text-foreground bg-accent"
                    )}
                    title={t('editor.blocks.magic_block_content.drag_resize')}
                  >
                    <GripHorizontal className="w-3 h-3" />
                    <span className="text-xs font-medium">{height}px</span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setIsPreviewModalOpen(true)}
                    className="flex space-x-1.5 items-center bg-secondary cursor-pointer px-4 py-1.5 rounded-xl border border-border text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-accent delay-75 ease-linear transition-all"
                  >
                    <Expand className="w-4 h-4" />
                    <span>{t('editor.blocks.common.expand')}</span>
                  </button>
                  {iterationCount < 6 && (
                    <button
                      onClick={() => setIsModalOpen(true)}
                      className="flex space-x-1.5 items-center bg-secondary cursor-pointer px-4 py-1.5 rounded-xl border border-border text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-accent delay-75 ease-linear transition-all"
                    >
                      <Edit3 className="w-4 h-4" />
                      <span>{t('editor.blocks.magic_block_content.edit_left', { count: 6 - iterationCount })}</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </NodeViewWrapper>

      {/* Generation Modal */}
      {accessToken && (
        <MagicBlockModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          onSave={handleSave}
          blockUuid={blockUuid}
          activityUuid={extension.options.activity.activity_uuid}
          context={buildContext()}
          accessToken={accessToken}
          initialSessionUuid={sessionUuid}
          initialHtmlContent={htmlContent}
          initialIterationCount={iterationCount}
          initialMessages={cachedMessages}
        />
      )}

      {/* Preview Modal */}
      <Modal
        isDialogOpen={isPreviewModalOpen}
        onOpenChange={setIsPreviewModalOpen}
        dialogTitle={t('editor.blocks.magic_block_content.interactive_element')}
        minWidth="xl"
        minHeight="lg"
        dialogContent={
          <div className="w-full h-[70vh]">
            <MagicBlockPreview htmlContent={htmlContent} />
          </div>
        }
      />
    </>
  )
}

export default MagicBlockComponent
