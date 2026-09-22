'use client'

import React from 'react'
import { Podcast } from '@services/podcasts/podcasts'
import { useOrg } from '@components/Contexts/OrgContext'
import { getPodcastThumbnailMediaDirectory, getUserAvatarMediaDirectory } from '@services/media/media'
import { getUriWithOrg } from '@services/config/config'
import { removePodcastPrefix } from '@services/podcasts/podcasts'
import UserAvatar from '@components/Objects/UserAvatar'
import AuthenticatedClientElement from '@components/Security/AuthenticatedClientElement'
import { Globe, Lock, Headphones, Settings } from 'lucide-react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'

interface PodcastSidebarProps {
  podcast: Podcast
  episodeCount: number
  orgslug: string
}

export function PodcastSidebar({ podcast, episodeCount, orgslug }: PodcastSidebarProps) {
  const { t } = useTranslation()
  const org = useOrg() as any

  const thumbnailUrl = podcast.thumbnail_image && org
    ? getPodcastThumbnailMediaDirectory(org.org_uuid, podcast.podcast_uuid, podcast.thumbnail_image)
    : '/empty_thumbnail.png'

  const activeAuthors = podcast.authors?.filter(author => author.authorship_status === 'ACTIVE') || []

  return (
    <div className="bg-white border border-slate-200/80 rounded-2xl shadow-xs overflow-hidden">
      {/* Thumbnail */}
      <div className="aspect-square w-full overflow-hidden bg-slate-100 relative">
        <img
          src={thumbnailUrl}
          alt={podcast.name}
          className="w-full h-full object-cover"
        />
      </div>

      {/* Content */}
      <div className="p-4 space-y-4">
        {/* Name and badges */}
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">{podcast.name}</h1>
          <div className="flex flex-wrap items-center gap-2 mt-2">
            {podcast.public ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200/60 rounded-full text-xs font-semibold">
                <Globe size={11} className="text-emerald-500" />
                {t('podcasts.public')}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 bg-slate-100 text-slate-700 border border-slate-200/60 rounded-full text-xs font-semibold">
                <Lock size={11} className="text-slate-400" />
                {t('podcasts.private')}
              </span>
            )}
            {!podcast.published && (
              <span className="px-2.5 py-0.5 bg-amber-50 text-amber-700 border border-amber-200/60 rounded-full text-xs font-semibold">
                {t('podcasts.unpublished')}
              </span>
            )}
          </div>
        </div>

        {/* Description */}
        {podcast.description && (
          <p className="text-xs sm:text-sm text-slate-600 leading-relaxed font-normal">
            {podcast.description}
          </p>
        )}

        {/* Stats */}
        <div className="flex items-center gap-4 py-3 border-y border-slate-100">
          <div className="flex items-center gap-2 text-xs sm:text-sm text-slate-600 font-medium">
            <Headphones size={16} className="text-slate-400" />
            <span>
              {episodeCount} {episodeCount === 1 ? 'episode' : 'episodes'}
            </span>
          </div>
        </div>

        {/* Authors */}
        {activeAuthors.length > 0 && (
          <div>
            <h3 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2.5">
              {t('podcasts.hosted_by')}
            </h3>
            <div className="space-y-2.5">
              {activeAuthors.map((author) => (
                <div key={author.user.user_uuid} className="flex items-center gap-2.5">
                  <UserAvatar
                    border="border-2"
                    rounded="rounded-full"
                    avatar_url={
                      author.user.avatar_image
                        ? getUserAvatarMediaDirectory(author.user.user_uuid, author.user.avatar_image)
                        : ''
                    }
                    predefined_avatar={author.user.avatar_image ? undefined : 'empty'}
                    width={34}
                    showProfilePopup={true}
                    userId={author.user.id}
                  />
                  <div className="min-w-0 flex-1">
                    <span className="text-sm font-semibold text-slate-900 block truncate">
                      {author.user.first_name} {author.user.last_name}
                    </span>
                    <span className="text-xs text-slate-500 font-medium block truncate">
                      @{author.user.username}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tags */}
        {podcast.tags && (
          <div>
            <h3 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">
              {t('podcasts.tags')}
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {podcast.tags.split(',').map((tag, index) => (
                <span
                  key={index}
                  className="px-2.5 py-0.5 bg-slate-100/80 text-slate-700 border border-slate-200/60 rounded-lg text-xs font-medium"
                >
                  {tag.trim()}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Admin actions */}
        <AuthenticatedClientElement
          action="update"
          ressourceType="podcasts"
          checkMethod="roles"
          orgId={podcast.org_id}
        >
          <div className="pt-2">
            <Link
              href={getUriWithOrg(orgslug, `/dash/podcasts/podcast/${removePodcastPrefix(podcast.podcast_uuid)}/general`)}
              className="flex items-center justify-center gap-2 w-full px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-sm font-semibold transition-all duration-150 shadow-xs active:scale-[0.99]"
            >
              <Settings size={16} />
              {t('podcasts.manage_podcast')}
            </Link>
          </div>
        </AuthenticatedClientElement>
      </div>
    </div>
  )
}

export default PodcastSidebar
