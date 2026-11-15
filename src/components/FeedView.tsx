import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useApp, AppView } from '../context/AppContext';
import { apiRequest, uploadMediaFile } from '../services/api';
import { ART_DISCIPLINES } from '../utils/disciplineConfig';
import {
  ArtDiscipline,
  FeedPost,
  FeedPostComment,
  FeedReactionType,
  LinkPreviewData,
} from '../types';
import {
  Sparkles,
  Image as ImageIcon,
  Link2,
  Send,
  Trash2,
  MessageCircle,
  Repeat2,
  Lock,
  Globe,
  Search,
  ExternalLink,
  X,
  Award,
  Flame,
  HandMetal,
  Calendar,
  MapPin,
  Loader2,
} from 'lucide-react';

interface FeedViewProps {
  highlightedPostId?: string;
}

const POST_TYPE_LABELS: Record<FeedPost['postType'], string> = {
  update: 'Sahne Günlüğü',
  showcase: 'Vitrin & Eser',
  stage_call: 'Sahne Çağrısı',
  repost: 'Yeniden Paylaşım',
  note: 'Kısa Not',
};

const REACTION_ITEMS: Array<{
  type: FeedReactionType;
  label: string;
  icon: typeof Sparkles;
}> = [
  { type: 'applause', label: 'Alkış', icon: HandMetal },
  { type: 'bravo', label: 'Bravo', icon: Flame },
  { type: 'inspire', label: 'İlham Verici', icon: Award },
];

function formatRelativeDate(iso: string): string {
  try {
    const dt = new Date(iso);
    const diffMs = Date.now() - dt.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'Az önce';
    if (diffMins < 60) return `${diffMins} dk önce`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours} sa önce`;
    return dt.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return iso;
  }
}

export const FeedView: React.FC<FeedViewProps> = ({ highlightedPostId }) => {
  const {
    currentUser,
    isAuthenticated,
    setAuthModalMode,
    navigateTo,
    repostDraft,
    setRepostDraft,
  } = useApp();

  const [scope, setScope] = useState<'all' | 'following'>('all');
  const [disciplineFilter, setDisciplineFilter] = useState<string>('Tümü');
  const [searchQuery, setSearchQuery] = useState('');
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [feedError, setFeedError] = useState<string | null>(null);

  // Composer state
  const [composerBody, setComposerBody] = useState('');
  const [composerPostType, setComposerPostType] = useState<FeedPost['postType']>('update');
  const [composerDiscipline, setComposerDiscipline] = useState<ArtDiscipline>('Müzik');
  const [composerVisibility, setComposerVisibility] = useState<'public' | 'followers'>('public');
  const [composerTagsInput, setComposerTagsInput] = useState('');
  const [composerMedia, setComposerMedia] = useState<Array<{ mediaType: 'image'; url: string; caption?: string }>>([]);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [linkInput, setLinkInput] = useState('');
  const [linkPreview, setLinkPreview] = useState<LinkPreviewData | null>(null);
  const [fetchingPreview, setFetchingPreview] = useState(false);
  const [submittingPost, setSubmittingPost] = useState(false);
  const [composerError, setComposerError] = useState<string | null>(null);
  const [showLinkBox, setShowLinkBox] = useState(false);

  // Expanded comments & per-post state
  const [expandedComments, setExpandedComments] = useState<Record<string, boolean>>({});
  const [fullCommentsMap, setFullCommentsMap] = useState<Record<string, FeedPostComment[]>>({});
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [commentBusyId, setCommentBusyId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const cardRefs = useRef<Record<string, HTMLElement | null>>({});

  const fetchFeed = useCallback(
    async (opts?: { append?: boolean; cursor?: string | null }) => {
      const isAppend = Boolean(opts?.append);
      if (isAppend) {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }
      setFeedError(null);

      try {
        const params = new URLSearchParams();
        params.set('scope', scope);
        params.set('limit', '10');
        if (disciplineFilter && disciplineFilter !== 'Tümü') {
          params.set('discipline', disciplineFilter);
        }
        if (searchQuery.trim()) {
          params.set('q', searchQuery.trim());
        }
        if (opts?.cursor) {
          params.set('cursor', opts.cursor);
        }

        const data = await apiRequest<{
          items: FeedPost[];
          nextCursor: string | null;
          hasMore: boolean;
        }>(`/api/feed?${params.toString()}`);

        const incoming = Array.isArray(data.items) ? data.items : [];
        if (isAppend) {
          setPosts((prev) => {
            const seen = new Set(prev.map((p) => p.id));
            return [...prev, ...incoming.filter((p) => !seen.has(p.id))];
          });
        } else {
          setPosts(incoming);
        }
        setNextCursor(data.nextCursor || null);
        setHasMore(Boolean(data.hasMore));
      } catch (err: any) {
        setFeedError(err?.message || 'Akış yüklenemedi.');
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [scope, disciplineFilter, searchQuery]
  );

  useEffect(() => {
    fetchFeed();
  }, [fetchFeed]);

  useEffect(() => {
    if (!highlightedPostId) return;
    const found = posts.find((p) => p.id === highlightedPostId);
    if (found) {
      setExpandedComments((prev) => ({ ...prev, [found.id]: true }));
      const el = cardRefs.current[found.id];
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    } else if (!loading) {
      apiRequest<{ post: FeedPost }>(`/api/feed/posts/${highlightedPostId}`)
        .then((res) => {
          if (res?.post) {
            setPosts((prev) => (prev.some((x) => x.id === res.post.id) ? prev : [res.post, ...prev]));
            setExpandedComments((prev) => ({ ...prev, [res.post.id]: true }));
          }
        })
        .catch(() => {
          // ignore if deleted or blocked
        });
    }
  }, [highlightedPostId, posts.length, loading]);

  const handleImageUpload = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setComposerError('Yalnızca görsel dosyaları (PNG, JPG, WEBP, GIF) ekleyebilirsiniz.');
      return;
    }
    setComposerError(null);
    setUploadingMedia(true);
    try {
      const asset = await uploadMediaFile(file, 'feed');
      setComposerMedia((prev) => [...prev.slice(0, 3), { mediaType: 'image', url: asset.url }]);
    } catch (err: any) {
      setComposerError(err?.message || 'Görsel yüklenemedi.');
    } finally {
      setUploadingMedia(false);
    }
  };

  const handleFetchLinkPreview = async () => {
    if (!linkInput.trim()) return;
    setComposerError(null);
    setFetchingPreview(true);
    try {
      const res = await apiRequest<{ preview: LinkPreviewData }>('/api/feed/link-preview', {
        method: 'POST',
        body: { url: linkInput.trim() },
      });
      setLinkPreview(res.preview);
      setShowLinkBox(false);
    } catch (err: any) {
      setComposerError(err?.message || 'Bağlantı önizlemesi alınamadı.');
    } finally {
      setFetchingPreview(false);
    }
  };

  const handlePublishPost = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAuthenticated) {
      setAuthModalMode('login');
      return;
    }
    if (!composerBody.trim() && !repostDraft && composerMedia.length === 0) {
      setComposerError('Paylaşım metni yazın, görsel ekleyin veya bir içeriği yeniden paylaşın.');
      return;
    }

    setComposerError(null);
    setSubmittingPost(true);
    try {
      const hashTags = Array.from(composerBody.matchAll(/#([a-zA-Z0-9çğıöşüÇĞİÖŞÜ_-]+)/g)).map((m) => m[1]);
      const manualTags = composerTagsInput
        .split(',')
        .map((t) => t.trim().replace(/^#/, ''))
        .filter(Boolean);
      const mergedTags = Array.from(new Set([...hashTags, ...manualTags])).slice(0, 8);

      const res = await apiRequest<{ post: FeedPost }>('/api/feed/posts', {
        method: 'POST',
        body: {
          body: composerBody.trim(),
          postType: repostDraft ? 'repost' : composerPostType,
          discipline: composerDiscipline,
          visibility: composerVisibility,
          tags: mergedTags,
          media: composerMedia,
          linkUrl: linkPreview?.url || undefined,
          repostEntityType: repostDraft?.entityType,
          repostEntityId: repostDraft?.entityId,
        },
      });

      if (res?.post) {
        setPosts((prev) => [res.post, ...prev]);
        setComposerBody('');
        setComposerTagsInput('');
        setComposerMedia([]);
        setLinkPreview(null);
        setLinkInput('');
        setRepostDraft(null);
      }
    } catch (err: any) {
      setComposerError(err?.message || 'Paylaşım gönderilemedi.');
    } finally {
      setSubmittingPost(false);
    }
  };

  const handleReaction = async (postId: string, reactionType: FeedReactionType) => {
    if (!isAuthenticated) {
      setAuthModalMode('login');
      return;
    }
    try {
      const res = await apiRequest<{
        viewerReaction: FeedReactionType | null;
        reactionCounts: Record<FeedReactionType, number>;
      }>(`/api/feed/posts/${postId}/reactions`, {
        method: 'POST',
        body: { reactionType },
      });
      setPosts((prev) =>
        prev.map((p) =>
          p.id === postId
            ? {
                ...p,
                viewerReaction: res.viewerReaction,
                reactionCounts: res.reactionCounts,
              }
            : p
        )
      );
    } catch (err: any) {
      setFeedError(err?.message || 'Tepki kaydedilemedi.');
    }
  };

  const toggleComments = async (postId: string) => {
    const nextOpen = !expandedComments[postId];
    setExpandedComments((prev) => ({ ...prev, [postId]: nextOpen }));
    if (nextOpen) {
      try {
        const res = await apiRequest<{ comments: FeedPostComment[] }>(`/api/feed/posts/${postId}/comments`);
        setFullCommentsMap((prev) => ({ ...prev, [postId]: res.comments || [] }));
      } catch {
        // keep preview comments
      }
    }
  };

  const handleAddComment = async (postId: string, e: React.FormEvent) => {
    e.preventDefault();
    if (!isAuthenticated) {
      setAuthModalMode('login');
      return;
    }
    const text = (commentDrafts[postId] || '').trim();
    if (!text) return;

    setCommentBusyId(postId);
    try {
      const res = await apiRequest<{ comment: FeedPostComment; commentsCount: number }>(
        `/api/feed/posts/${postId}/comments`,
        {
          method: 'POST',
          body: { body: text },
        }
      );
      setCommentDrafts((prev) => ({ ...prev, [postId]: '' }));
      setExpandedComments((prev) => ({ ...prev, [postId]: true }));
      setFullCommentsMap((prev) => {
        const currentList = prev[postId] || posts.find((p) => p.id === postId)?.comments || [];
        return { ...prev, [postId]: [...currentList, res.comment] };
      });
      setPosts((prev) =>
        prev.map((p) =>
          p.id === postId
            ? {
                ...p,
                commentsCount: res.commentsCount,
                comments: [...p.comments, res.comment].slice(-5),
              }
            : p
        )
      );
    } catch (err: any) {
      setFeedError(err?.message || 'Yorum gönderilemedi.');
    } finally {
      setCommentBusyId(null);
    }
  };

  const handleDeleteComment = async (postId: string, commentId: string) => {
    try {
      await apiRequest(`/api/feed/comments/${commentId}`, { method: 'DELETE' });
      setFullCommentsMap((prev) => ({
        ...prev,
        [postId]: (prev[postId] || []).filter((c) => c.id !== commentId),
      }));
      setPosts((prev) =>
        prev.map((p) =>
          p.id === postId
            ? {
                ...p,
                commentsCount: Math.max(0, p.commentsCount - 1),
                comments: p.comments.filter((c) => c.id !== commentId),
              }
            : p
        )
      );
    } catch (err: any) {
      setFeedError(err?.message || 'Yorum silinemedi.');
    }
  };

  const handleDeletePost = async (postId: string) => {
    try {
      await apiRequest(`/api/feed/posts/${postId}`, { method: 'DELETE' });
      setPosts((prev) => prev.filter((p) => p.id !== postId));
      setDeleteConfirmId(null);
    } catch (err: any) {
      setFeedError(err?.message || 'Paylaşım silinemedi.');
    }
  };

  const handleRepostSummaryNavigate = (post: FeedPost) => {
    if (!post.repostSummary) return;
    const { entityType, entityId } = post.repostSummary;
    if (entityType === 'event') navigateTo('event_detail', entityId);
    else if (entityType === 'listing') navigateTo('listing_detail', entityId);
    else if (entityType === 'project') navigateTo('project_workspace', entityId);
    else if (entityType === 'post') {
      const targetEl = cardRefs.current[entityId];
      if (targetEl) targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  const isStaff = isAuthenticated && ['admin', 'moderator'].includes(currentUser.activeRole);

  return (
    <div className="max-w-[920px] mx-auto px-4 sm:px-6 py-8 space-y-6 text-left">
      {/* Header */}
      <div className="bg-white dark:bg-[#13213e] rounded-3xl border border-[#e2e8f0] dark:border-[#1e335a] p-6 sm:p-8 shadow-xs space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <span className="label-caps text-[#E45424]">Kültür &amp; Sahne Topluluğu</span>
            <h1 className="font-display text-2xl sm:text-3xl font-extrabold text-[#162956] dark:text-white tracking-tight mt-0.5">
              Sanat Sahnede Akışı
            </h1>
            <p className="text-xs sm:text-sm text-[#475569] dark:text-slate-300 mt-1">
              Sanatçılardan, topluluklardan ve mekânlardan sahne arkası, yeni projeler, etkinlikler ve paylaşımlar.
            </p>
          </div>

          <div className="inline-flex p-1 rounded-xl bg-[#F2F4F8] dark:bg-[#0f1c38] border border-[#e2e8f0] dark:border-[#1e335a] self-start shrink-0">
            <button
              type="button"
              onClick={() => setScope('all')}
              className={`px-3.5 py-2 rounded-lg text-xs font-bold whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                scope === 'all'
                  ? 'bg-[#162956] dark:bg-[#E45424] text-white'
                  : 'text-[#475569] dark:text-slate-300'
              }`}
            >
              Tüm Akış
            </button>
            <button
              type="button"
              onClick={() => {
                if (!isAuthenticated) {
                  setAuthModalMode('login');
                  return;
                }
                setScope('following');
              }}
              className={`px-3.5 py-2 rounded-lg text-xs font-bold whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                scope === 'following'
                  ? 'bg-[#162956] dark:bg-[#E45424] text-white'
                  : 'text-[#475569] dark:text-slate-300'
              }`}
            >
              Takip Ettiklerim
            </button>
          </div>
        </div>

        {/* Search & Discipline Filter */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pt-2 border-t border-[#e2e8f0] dark:border-[#1e335a]">
          <div className="flex flex-wrap items-center gap-1.5">
            {ART_DISCIPLINES.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDisciplineFilter(d)}
                className={`px-3 py-1.5 rounded-xl text-[11px] font-bold border transition-colors cursor-pointer ${
                  disciplineFilter === d
                    ? 'bg-[#E45424] text-white border-[#E45424]'
                    : 'bg-[#f8fafc] dark:bg-[#0f1c38] text-[#475569] dark:text-slate-300 border-[#e2e8f0] dark:border-[#1e335a] hover:border-[#E45424]/50'
                }`}
              >
                {d}
              </button>
            ))}
          </div>

          <div className="relative w-full md:w-64 shrink-0">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              aria-label="Akışta ara"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Akışta veya #etikette ara..."
              className="w-full pl-8 pr-3 py-2 rounded-xl border border-[#e2e8f0] dark:border-[#1e335a] bg-[#f8fafc] dark:bg-[#0f1c38] text-xs text-[#0f172a] dark:text-white focus:outline-hidden focus:border-[#E45424]"
            />
          </div>
        </div>
      </div>

      {/* Composer */}
      {isAuthenticated ? (
        <form
          onSubmit={handlePublishPost}
          className="bg-white dark:bg-[#13213e] rounded-3xl border border-[#e2e8f0] dark:border-[#1e335a] p-5 sm:p-6 shadow-xs space-y-4"
        >
          <div className="flex items-start gap-3">
            <img
              src={currentUser.avatarUrl}
              alt={currentUser.firstName}
              className="w-10 h-10 rounded-xl object-cover border border-[#e2e8f0] dark:border-[#1e335a] shrink-0"
            />
            <div className="flex-1 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <select
                  aria-label="Paylaşım Türü"
                  value={composerPostType}
                  onChange={(e) => setComposerPostType(e.target.value as FeedPost['postType'])}
                  className="px-2.5 py-1.5 rounded-lg border border-[#e2e8f0] dark:border-[#1e335a] bg-[#f8fafc] dark:bg-[#0f1c38] text-[11px] font-bold text-[#162956] dark:text-white"
                >
                  <option value="update">Sahne Günlüğü</option>
                  <option value="showcase">Vitrin &amp; Eser</option>
                  <option value="stage_call">Sahne Çağrısı</option>
                  <option value="note">Kısa Not</option>
                </select>

                <select
                  aria-label="Sanat Disiplini"
                  value={composerDiscipline}
                  onChange={(e) => setComposerDiscipline(e.target.value as ArtDiscipline)}
                  className="px-2.5 py-1.5 rounded-lg border border-[#e2e8f0] dark:border-[#1e335a] bg-[#f8fafc] dark:bg-[#0f1c38] text-[11px] font-bold text-[#162956] dark:text-white"
                >
                  {ART_DISCIPLINES.filter((d): d is ArtDiscipline => d !== 'Tümü').map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>

                <button
                  type="button"
                  onClick={() => setComposerVisibility((v) => (v === 'public' ? 'followers' : 'public'))}
                  className="px-2.5 py-1.5 rounded-lg border border-[#e2e8f0] dark:border-[#1e335a] bg-[#f8fafc] dark:bg-[#0f1c38] text-[11px] font-semibold text-[#475569] dark:text-slate-300 inline-flex items-center gap-1 cursor-pointer"
                >
                  {composerVisibility === 'followers' ? (
                    <>
                      <Lock className="w-3 h-3 text-[#E45424]" />
                      <span>Yalnızca Takipçiler</span>
                    </>
                  ) : (
                    <>
                      <Globe className="w-3 h-3 text-emerald-600" />
                      <span>Herkese Açık</span>
                    </>
                  )}
                </button>
              </div>

              <textarea
                id="feed-composer-body"
                rows={3}
                value={composerBody}
                onChange={(e) => setComposerBody(e.target.value)}
                placeholder="Sahne hazırlığından, yeni eserinizden veya bir iş birliği çağrısından bahsedin... (#caz #sahne)"
                className="w-full p-3 rounded-2xl border border-[#e2e8f0] dark:border-[#1e335a] bg-[#f8fafc] dark:bg-[#0f1c38] text-xs sm:text-sm text-[#0f172a] dark:text-white focus:outline-hidden focus:border-[#E45424]"
              />

              {/* Repost Draft Banner */}
              {repostDraft && (
                <div className="p-3 rounded-2xl bg-orange-50/70 dark:bg-[#E45424]/10 border border-orange-200 dark:border-[#E45424]/30 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-[#E45424]">
                      Akışta Yeniden Paylaşılıyor ({repostDraft.entityType})
                    </div>
                    <div className="text-xs font-bold text-[#162956] dark:text-white truncate">
                      {repostDraft.title}
                    </div>
                    {repostDraft.subtitle && (
                      <div className="text-[11px] text-slate-600 dark:text-slate-300 truncate">
                        {repostDraft.subtitle}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setRepostDraft(null)}
                    className="p-1 rounded-lg hover:bg-white/80 dark:hover:bg-slate-800 text-slate-500 cursor-pointer"
                    aria-label="Yeniden paylaşımı kaldır"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}

              {/* Media Previews */}
              {composerMedia.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {composerMedia.map((m, idx) => (
                    <div key={idx} className="relative rounded-xl overflow-hidden border border-[#e2e8f0] dark:border-[#1e335a] aspect-video">
                      <img src={m.url} alt="Yüklenen görsel" className="w-full h-full object-cover" />
                      <button
                        type="button"
                        onClick={() => setComposerMedia((prev) => prev.filter((_, i) => i !== idx))}
                        className="absolute top-1 right-1 p-1 rounded-full bg-black/65 text-white cursor-pointer"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Link Preview Box */}
              {showLinkBox && (
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="url"
                    value={linkInput}
                    onChange={(e) => setLinkInput(e.target.value)}
                    placeholder="https://ornek.com/konser-veya-kayit"
                    className="flex-1 px-3 py-2 rounded-xl border border-[#e2e8f0] dark:border-[#1e335a] bg-[#f8fafc] dark:bg-[#0f1c38] text-xs"
                  />
                  <button
                    type="button"
                    disabled={fetchingPreview}
                    onClick={handleFetchLinkPreview}
                    className="px-3.5 py-2 rounded-xl bg-[#162956] text-white text-xs font-bold cursor-pointer disabled:opacity-50"
                  >
                    {fetchingPreview ? 'Getiriliyor...' : 'Önizleme Ekle'}
                  </button>
                </div>
              )}

              {linkPreview && (
                <div className="p-3 rounded-2xl bg-[#f8fafc] dark:bg-[#0f1c38] border border-[#e2e8f0] dark:border-[#1e335a] flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[10px] font-bold uppercase text-[#E45424]">{linkPreview.domain}</div>
                    <div className="text-xs font-bold text-[#0f172a] dark:text-white truncate">{linkPreview.title}</div>
                    {linkPreview.description && (
                      <div className="text-[11px] text-slate-500 truncate">{linkPreview.description}</div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setLinkPreview(null)}
                    className="p-1 text-slate-400 hover:text-rose-600 cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}

              {composerError && (
                <div role="alert" className="text-xs font-semibold text-rose-600 dark:text-rose-400">
                  {composerError}
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <div className="flex flex-wrap items-center gap-2">
                  <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#f8fafc] dark:bg-[#0f1c38] border border-[#e2e8f0] dark:border-[#1e335a] text-xs font-semibold text-[#475569] dark:text-slate-300 hover:border-[#E45424] cursor-pointer">
                    <ImageIcon className="w-3.5 h-3.5 text-[#E45424]" />
                    <span>{uploadingMedia ? 'Yükleniyor...' : 'Fotoğraf Ekle'}</span>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleImageUpload(file);
                      }}
                    />
                  </label>

                  <button
                    type="button"
                    onClick={() => setShowLinkBox((p) => !p)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#f8fafc] dark:bg-[#0f1c38] border border-[#e2e8f0] dark:border-[#1e335a] text-xs font-semibold text-[#475569] dark:text-slate-300 hover:border-[#E45424] cursor-pointer"
                  >
                    <Link2 className="w-3.5 h-3.5 text-[#162956] dark:text-[#ffb59e]" />
                    <span>Bağlantı Ekle</span>
                  </button>

                  <input
                    type="text"
                    aria-label="Etiketler"
                    value={composerTagsInput}
                    onChange={(e) => setComposerTagsInput(e.target.value)}
                    placeholder="Etiketler (virgülle)"
                    className="px-3 py-1.5 rounded-xl border border-[#e2e8f0] dark:border-[#1e335a] bg-[#f8fafc] dark:bg-[#0f1c38] text-xs w-40"
                  />
                </div>

                <button
                  type="submit"
                  disabled={submittingPost || uploadingMedia}
                  className="inline-flex items-center gap-1.5 px-5 py-2 rounded-xl bg-[#E45424] hover:bg-[#c94317] text-white text-xs font-bold shadow-xs transition-colors cursor-pointer disabled:opacity-60"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>{submittingPost ? 'Paylaşılıyor...' : 'Akışta Paylaş'}</span>
                </button>
              </div>
            </div>
          </div>
        </form>
      ) : (
        <div className="bg-white dark:bg-[#13213e] rounded-3xl border border-[#e2e8f0] dark:border-[#1e335a] p-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 text-xs sm:text-sm text-[#475569] dark:text-slate-300">
            <Sparkles className="w-4 h-4 text-[#E45424] shrink-0" />
            <span>Kendi sahne güncellemelerinizi paylaşmak, tepki vermek ve yorum yazmak için giriş yapın.</span>
          </div>
          <button
            type="button"
            onClick={() => setAuthModalMode('login')}
            className="px-4 py-2 rounded-xl bg-[#E45424] text-white text-xs font-bold cursor-pointer"
          >
            Giriş Yap
          </button>
        </div>
      )}

      {feedError && (
        <div role="alert" className="p-3 rounded-2xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 text-xs font-semibold text-rose-700 dark:text-rose-300">
          {feedError}
        </div>
      )}

      {/* Feed Stream */}
      {loading ? (
        <div className="bg-white dark:bg-[#13213e] rounded-3xl border border-[#e2e8f0] dark:border-[#1e335a] p-12 text-center text-xs text-[#64748b] flex flex-col items-center gap-2">
          <Loader2 className="w-6 h-6 animate-spin text-[#E45424]" />
          <span>Sanat akışı yükleniyor...</span>
        </div>
      ) : posts.length === 0 ? (
        <div className="bg-white dark:bg-[#13213e] rounded-3xl border border-[#e2e8f0] dark:border-[#1e335a] p-10 text-center space-y-2">
          <p className="text-sm font-bold text-[#162956] dark:text-white">
            {scope === 'following'
              ? 'Takip ettiğiniz hesaplardan henüz paylaşım bulunmuyor.'
              : 'Bu filtre için henüz paylaşım bulunmuyor.'}
          </p>
          <p className="text-xs text-[#64748b] dark:text-slate-400">
            İlk paylaşımı yukarıdan oluşturabilir veya filtreleri temizleyebilirsiniz.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {posts.map((post) => {
            const canDelete = isAuthenticated && (post.authorUserId === currentUser.id || isStaff);
            const isCommentsOpen = Boolean(expandedComments[post.id]);
            const displayedComments = fullCommentsMap[post.id] || post.comments;
            const isHighlighted = highlightedPostId === post.id;

            return (
              <article
                key={post.id}
                ref={(el) => {
                  cardRefs.current[post.id] = el;
                }}
                className={`bg-white dark:bg-[#13213e] rounded-3xl border p-5 sm:p-6 shadow-xs space-y-4 transition-colors ${
                  isHighlighted
                    ? 'border-[#E45424] ring-2 ring-[#E45424]/25'
                    : 'border-[#e2e8f0] dark:border-[#1e335a]'
                }`}
              >
                {/* Author Header */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <button
                      type="button"
                      onClick={() =>
                        post.authorProfileView &&
                        post.authorEntityId &&
                        navigateTo(post.authorProfileView as AppView, post.authorEntityId)
                      }
                      className="shrink-0 cursor-pointer"
                    >
                      <img
                        src={post.authorAvatar || '/src/assets/images/artist_jazz_pianist_1794440057025.jpg'}
                        alt={post.authorName}
                        className="w-11 h-11 rounded-2xl object-cover border border-[#e2e8f0] dark:border-[#1e335a]"
                      />
                    </button>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            post.authorProfileView &&
                            post.authorEntityId &&
                            navigateTo(post.authorProfileView as AppView, post.authorEntityId)
                          }
                          className="font-display font-bold text-sm text-[#0f172a] dark:text-white hover:text-[#E45424] transition-colors cursor-pointer truncate"
                        >
                          {post.authorName}
                        </button>
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-[#f1f3ff] dark:bg-[#0f1c38] text-[#162956] dark:text-[#ffb59e] border border-[#e2e8f0] dark:border-[#1e335a]">
                          {post.discipline}
                        </span>
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-[#f8fafc] dark:bg-[#0f1c38] text-[#64748b] dark:text-slate-300">
                          {POST_TYPE_LABELS[post.postType]}
                        </span>
                        {post.visibility === 'followers' && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700 dark:text-amber-300">
                            <Lock className="w-3 h-3" />
                            <span>Takipçiler</span>
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-[#64748b] dark:text-slate-400 truncate mt-0.5">
                        {post.authorSubtitle ? `${post.authorSubtitle} · ` : ''}
                        <span>{formatRelativeDate(post.createdAt)}</span>
                      </div>
                    </div>
                  </div>

                  {canDelete && (
                    <div className="shrink-0">
                      {deleteConfirmId === post.id ? (
                        <div className="flex items-center gap-1.5 text-[11px]">
                          <button
                            type="button"
                            onClick={() => handleDeletePost(post.id)}
                            className="px-2.5 py-1 rounded-lg bg-rose-600 text-white font-bold cursor-pointer"
                          >
                            Sil
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeleteConfirmId(null)}
                            className="px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 cursor-pointer"
                          >
                            Vazgeç
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setDeleteConfirmId(post.id)}
                          aria-label="Paylaşımı sil"
                          className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 transition-colors cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* Body */}
                {post.body && (
                  <p className="text-xs sm:text-sm text-[#1e293b] dark:text-slate-200 leading-relaxed whitespace-pre-line">
                    {post.body}
                  </p>
                )}

                {/* Tags */}
                {post.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {post.tags.map((tag) => (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => setSearchQuery(tag)}
                        className="text-[11px] font-semibold text-[#E45424] hover:underline bg-orange-50/70 dark:bg-[#E45424]/10 px-2 py-0.5 rounded-md cursor-pointer"
                      >
                        #{tag}
                      </button>
                    ))}
                  </div>
                )}

                {/* Media Gallery */}
                {post.media.length > 0 && (
                  <div className={`grid gap-2 ${post.media.length === 1 ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2'}`}>
                    {post.media.map((m) => (
                      <div key={m.id} className="rounded-2xl overflow-hidden border border-[#e2e8f0] dark:border-[#1e335a] bg-[#0f172a] max-h-96">
                        <img src={m.url} alt={m.caption || post.authorName} className="w-full h-full object-cover" />
                      </div>
                    ))}
                  </div>
                )}

                {/* Link Preview */}
                {post.linkPreview && (
                  <a
                    href={post.linkPreview.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block p-3.5 rounded-2xl bg-[#f8fafc] dark:bg-[#0f1c38] border border-[#e2e8f0] dark:border-[#1e335a] hover:border-[#E45424]/60 transition-colors space-y-1"
                  >
                    <div className="flex items-center justify-between gap-2 text-[10px] font-bold uppercase text-[#E45424]">
                      <span>{post.linkPreview.domain}</span>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </div>
                    <div className="text-xs font-bold text-[#0f172a] dark:text-white">{post.linkPreview.title}</div>
                    {post.linkPreview.description && (
                      <p className="text-[11px] text-[#64748b] dark:text-slate-400 line-clamp-2">
                        {post.linkPreview.description}
                      </p>
                    )}
                  </a>
                )}

                {/* Embedded Repost Summary */}
                {post.repostSummary && (
                  <button
                    type="button"
                    onClick={() => handleRepostSummaryNavigate(post)}
                    className="w-full text-left p-4 rounded-2xl bg-[#F2F4F8] dark:bg-[#0f1c38] border border-[#e2e8f0] dark:border-[#1e335a] hover:border-[#E45424] transition-colors space-y-1.5 cursor-pointer"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-[#E45424]">
                        {post.repostSummary.entityType === 'event'
                          ? 'Etkinlik Paylaşımı'
                          : post.repostSummary.entityType === 'listing'
                          ? 'Sahne İlanı'
                          : post.repostSummary.entityType === 'project'
                          ? 'Proje Lab'
                          : 'Paylaşım'}
                      </span>
                      {post.repostSummary.badge && (
                        <span className="text-[11px] font-bold text-[#162956] dark:text-white bg-white dark:bg-[#13213e] px-2 py-0.5 rounded-md border border-[#e2e8f0] dark:border-[#1e335a]">
                          {post.repostSummary.badge}
                        </span>
                      )}
                    </div>
                    <div className="text-xs sm:text-sm font-bold text-[#162956] dark:text-white">
                      {post.repostSummary.title}
                    </div>
                    {post.repostSummary.subtitle && (
                      <div className="text-xs text-[#475569] dark:text-slate-300 line-clamp-2">
                        {post.repostSummary.subtitle}
                      </div>
                    )}
                    {(post.repostSummary.city || post.repostSummary.date) && (
                      <div className="flex flex-wrap items-center gap-3 text-[11px] text-[#64748b] dark:text-slate-400 pt-0.5">
                        {post.repostSummary.city && (
                          <span className="inline-flex items-center gap-1">
                            <MapPin className="w-3 h-3 text-[#E45424]" />
                            <span>{post.repostSummary.city}</span>
                          </span>
                        )}
                        {post.repostSummary.date && (
                          <span className="inline-flex items-center gap-1 tabular-nums">
                            <Calendar className="w-3 h-3 text-[#E45424]" />
                            <span>{post.repostSummary.date}</span>
                          </span>
                        )}
                      </div>
                    )}
                  </button>
                )}

                {/* Actions Row */}
                <div className="pt-3 border-t border-[#e2e8f0] dark:border-[#1e335a] flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {REACTION_ITEMS.map(({ type, label, icon: RIcon }) => {
                      const active = post.viewerReaction === type;
                      const count = post.reactionCounts[type] || 0;
                      return (
                        <button
                          key={type}
                          type="button"
                          onClick={() => handleReaction(post.id, type)}
                          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors cursor-pointer ${
                            active
                              ? 'bg-[#E45424] text-white border-[#E45424]'
                              : 'bg-[#f8fafc] dark:bg-[#0f1c38] text-[#475569] dark:text-slate-300 border-[#e2e8f0] dark:border-[#1e335a] hover:border-[#E45424]/50'
                          }`}
                        >
                          <RIcon className="w-3.5 h-3.5" />
                          <span>{label}</span>
                          {count > 0 && <span className="tabular-nums font-bold">({count})</span>}
                        </button>
                      );
                    })}
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => toggleComments(post.id)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#f8fafc] dark:bg-[#0f1c38] border border-[#e2e8f0] dark:border-[#1e335a] text-xs font-semibold text-[#475569] dark:text-slate-300 hover:border-[#162956] cursor-pointer"
                    >
                      <MessageCircle className="w-3.5 h-3.5" />
                      <span className="tabular-nums">Yorumlar ({post.commentsCount})</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        if (!isAuthenticated) {
                          setAuthModalMode('login');
                          return;
                        }
                        setRepostDraft({
                          entityType: 'post',
                          entityId: post.id,
                          title: post.authorName,
                          subtitle: post.body.slice(0, 100),
                        });
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#f8fafc] dark:bg-[#0f1c38] border border-[#e2e8f0] dark:border-[#1e335a] text-xs font-semibold text-[#475569] dark:text-slate-300 hover:border-[#E45424] cursor-pointer"
                    >
                      <Repeat2 className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">Yeniden Paylaş</span>
                    </button>
                  </div>
                </div>

                {/* Expandable Comments Section */}
                {isCommentsOpen && (
                  <div className="pt-3 border-t border-[#e2e8f0] dark:border-[#1e335a] space-y-3">
                    {displayedComments.length === 0 ? (
                      <div className="text-xs text-[#64748b] dark:text-slate-400">
                        Henüz yorum yapılmamış. İlk yorumu siz yazın.
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {displayedComments.map((c) => {
                          const canDeleteComment =
                            isAuthenticated &&
                            (c.authorUserId === currentUser.id ||
                              post.authorUserId === currentUser.id ||
                              isStaff);
                          return (
                            <div
                              key={c.id}
                              className="p-3 rounded-2xl bg-[#f8fafc] dark:bg-[#0f1c38] border border-[#e2e8f0] dark:border-[#1e335a] flex items-start justify-between gap-2 text-xs"
                            >
                              <div className="flex items-start gap-2.5 min-w-0">
                                <img
                                  src={c.authorAvatar || '/src/assets/images/artist_jazz_pianist_1794440057025.jpg'}
                                  alt={c.authorName}
                                  className="w-7 h-7 rounded-lg object-cover shrink-0 mt-0.5"
                                />
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        c.authorProfileView &&
                                        c.authorProfileEntityId &&
                                        navigateTo(c.authorProfileView as AppView, c.authorProfileEntityId)
                                      }
                                      className="font-bold text-[#0f172a] dark:text-white hover:text-[#E45424] cursor-pointer"
                                    >
                                      {c.authorName}
                                    </button>
                                    <span className="text-[10px] text-[#64748b] dark:text-slate-400">
                                      {formatRelativeDate(c.createdAt)}
                                    </span>
                                  </div>
                                  <p className="text-[#334155] dark:text-slate-300 mt-0.5 leading-relaxed">{c.body}</p>
                                </div>
                              </div>

                              {canDeleteComment && (
                                <button
                                  type="button"
                                  onClick={() => handleDeleteComment(post.id, c.id)}
                                  className="p-1 text-slate-400 hover:text-rose-600 shrink-0 cursor-pointer"
                                  aria-label="Yorumu sil"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    <form onSubmit={(e) => handleAddComment(post.id, e)} className="flex gap-2">
                      <input
                        type="text"
                        aria-label="Yorumunuz"
                        value={commentDrafts[post.id] || ''}
                        onChange={(e) => setCommentDrafts((prev) => ({ ...prev, [post.id]: e.target.value }))}
                        placeholder="Yorumunuzu yazın..."
                        className="flex-1 px-3 py-2 rounded-xl border border-[#e2e8f0] dark:border-[#1e335a] bg-[#f8fafc] dark:bg-[#0f1c38] text-xs text-[#0f172a] dark:text-white"
                      />
                      <button
                        type="submit"
                        disabled={commentBusyId === post.id}
                        className="px-4 py-2 rounded-xl bg-[#162956] dark:bg-[#E45424] text-white text-xs font-bold cursor-pointer disabled:opacity-50"
                      >
                        Gönder
                      </button>
                    </form>
                  </div>
                )}
              </article>
            );
          })}

          {hasMore && nextCursor && (
            <div className="flex justify-center pt-2">
              <button
                type="button"
                disabled={loadingMore}
                onClick={() => fetchFeed({ append: true, cursor: nextCursor })}
                className="px-6 py-2.5 rounded-xl bg-white dark:bg-[#13213e] border border-[#e2e8f0] dark:border-[#1e335a] hover:border-[#E45424] text-xs font-bold text-[#162956] dark:text-white shadow-xs cursor-pointer disabled:opacity-50"
              >
                {loadingMore ? 'Yükleniyor...' : 'Daha Fazla Göster'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
