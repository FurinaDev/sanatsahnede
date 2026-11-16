import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import { apiRequest, uploadMediaFile } from '../services/api';
import { realtimeClient } from '../services/realtimeClient';
import {
  ArtDiscipline,
  Community,
  CommunityChannel,
  CommunityMember,
  CommunityMessage,
} from '../types';
import { VerifiedBadge } from './ui/VerifiedBadge';
import { ART_DISCIPLINES, CITY_LIST } from '../utils/disciplineConfig';
import {
  MessageSquare,
  Hash,
  Megaphone,
  Lock,
  Plus,
  Search,
  Users,
  Pin,
  PinOff,
  Reply,
  Trash2,
  Paperclip,
  Send,
  Smile,
  VolumeX,
  Volume2,
  Shield,
  ChevronLeft,
  X,
  FileText,
  Wifi,
  WifiOff,
  LogIn,
  LogOut,
  CheckCircle2,
} from 'lucide-react';

interface CommunitiesViewProps {
  initialCommunityId?: string;
}

const COMMUNITY_REACTION_EMOJIS = ['👏', '❤️', '🎶', '🔥', '👍', '✨'] as const;

function formatMsgTime(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const isToday =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (isToday) {
    return d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString('tr-TR', { day: '2-digit', month: 'short' });
}

export const CommunitiesView: React.FC<CommunitiesViewProps> = ({ initialCommunityId }) => {
  const {
    currentUser,
    isAuthenticated,
    setAuthModalMode,
    navigateTo,
    wsConnected,
  } = useApp();

  const [communities, setCommunities] = useState<Community[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [selectedCommunityId, setSelectedCommunityId] = useState<string>(initialCommunityId || '');
  const [selectedChannelId, setSelectedChannelId] = useState<string>('');
  const [members, setMembers] = useState<CommunityMember[]>([]);
  const [messages, setMessages] = useState<CommunityMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);

  const [filterMode, setFilterMode] = useState<'all' | 'joined'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [disciplineFilter, setDisciplineFilter] = useState<string>('Tümü');
  const [mobileShowChannel, setMobileShowChannel] = useState(false);

  // Create community form
  const [showCreateCommunity, setShowCreateCommunity] = useState(false);
  const [newCommName, setNewCommName] = useState('');
  const [newCommDiscipline, setNewCommDiscipline] = useState<ArtDiscipline>('Müzik');
  const [newCommCity, setNewCommCity] = useState('İstanbul');
  const [newCommDescription, setNewCommDescription] = useState('');
  const [newCommVisibility, setNewCommVisibility] = useState<'public' | 'private_invite'>('public');

  // Create sub-channel form
  const [showCreateChannel, setShowCreateChannel] = useState(false);
  const [newChannelName, setNewChannelName] = useState('');
  const [newChannelType, setNewChannelType] = useState<'discussion' | 'announcement'>('discussion');
  const [newChannelDesc, setNewChannelDesc] = useState('');

  // Members & moderation drawer
  const [showMembersDrawer, setShowMembersDrawer] = useState(false);

  // Composer state
  const [draftBody, setDraftBody] = useState('');
  const [replyTo, setReplyTo] = useState<CommunityMessage | null>(null);
  const [reactionPickerMsgId, setReactionPickerMsgId] = useState<string | null>(null);
  const [pendingAttachment, setPendingAttachment] = useState<{
    url: string;
    name: string;
    type: string;
  } | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const fetchCommunities = useCallback(async () => {
    try {
      const res = await apiRequest<{ communities: Community[] }>('/api/communities');
      const list = Array.isArray(res.communities) ? res.communities : [];
      setCommunities(list);
      setSelectedCommunityId((prev) => {
        if (prev && list.some((c) => c.id === prev || c.slug === prev)) {
          const matched = list.find((c) => c.id === prev || c.slug === prev);
          return matched ? matched.id : prev;
        }
        if (initialCommunityId) {
          const matched = list.find((c) => c.id === initialCommunityId || c.slug === initialCommunityId);
          if (matched) return matched.id;
        }
        return list[0]?.id || '';
      });
    } catch (err: any) {
      setErrorMsg(err?.message || 'Topluluklar yüklenemedi.');
    } finally {
      setLoadingList(false);
    }
  }, [initialCommunityId]);

  useEffect(() => {
    void fetchCommunities();
  }, [fetchCommunities, isAuthenticated, currentUser.id]);

  const selectedCommunity = useMemo(
    () => communities.find((c) => c.id === selectedCommunityId) || null,
    [communities, selectedCommunityId]
  );

  // Keep selectedChannelId synchronized when selectedCommunity changes
  useEffect(() => {
    if (!selectedCommunity) {
      setSelectedChannelId('');
      return;
    }
    const channels = selectedCommunity.channels || [];
    if (channels.length === 0) {
      setSelectedChannelId('');
      return;
    }
    setSelectedChannelId((prev) => {
      if (prev && channels.some((ch) => ch.id === prev)) return prev;
      // Default to #genel if present so users see interactive discussion immediately, else first channel
      const genel = channels.find((ch) => ch.slug === 'genel');
      return genel ? genel.id : channels[0].id;
    });
  }, [selectedCommunity]);

  const activeChannel = useMemo<CommunityChannel | null>(() => {
    if (!selectedCommunity) return null;
    return selectedCommunity.channels.find((ch) => ch.id === selectedChannelId) || selectedCommunity.channels[0] || null;
  }, [selectedCommunity, selectedChannelId]);

  const fetchCommunityDetail = useCallback(async (commId: string) => {
    if (!commId) return;
    try {
      const res = await apiRequest<{ community: Community; members: CommunityMember[] }>(
        `/api/communities/${commId}`
      );
      if (res.community) {
        setCommunities((prev) => prev.map((c) => (c.id === res.community.id ? res.community : c)));
      }
      setMembers(Array.isArray(res.members) ? res.members : []);
    } catch {
      setMembers([]);
    }
  }, []);

  const fetchChannelMessages = useCallback(async (commId: string, channelId: string) => {
    if (!commId || !channelId) {
      setMessages([]);
      return;
    }
    setLoadingMessages(true);
    try {
      const res = await apiRequest<{ messages: CommunityMessage[] }>(
        `/api/communities/${commId}/channels/${channelId}/messages`
      );
      setMessages(Array.isArray(res.messages) ? res.messages : []);
    } catch {
      setMessages([]);
    } finally {
      setLoadingMessages(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedCommunityId) return;
    void fetchCommunityDetail(selectedCommunityId);
    realtimeClient.subscribeCommunity(selectedCommunityId);
    return () => {
      realtimeClient.unsubscribeCommunity(selectedCommunityId);
    };
  }, [selectedCommunityId, fetchCommunityDetail]);

  useEffect(() => {
    if (!selectedCommunityId || !selectedChannelId) return;
    void fetchChannelMessages(selectedCommunityId, selectedChannelId);
    setReplyTo(null);
    setReactionPickerMsgId(null);
  }, [selectedCommunityId, selectedChannelId, fetchChannelMessages]);

  // Real-time community event handlers
  useEffect(() => {
    const unsub = realtimeClient.subscribe((event) => {
      if (event.type === 'community:channel_created') {
        const { communityId, channel } = event.payload || {};
        if (!communityId || !channel) return;
        setCommunities((prev) =>
          prev.map((c) => {
            if (c.id !== communityId) return c;
            if (c.channels.some((existing) => existing.id === channel.id)) return c;
            return { ...c, channels: [...c.channels, channel] };
          })
        );
      } else if (event.type === 'community:message_created') {
        const { communityId, channelId, message } = event.payload || {};
        if (!message) return;
        if (communityId === selectedCommunityId && channelId === selectedChannelId) {
          setMessages((prev) => {
            if (prev.some((m) => m.id === message.id)) return prev;
            return [...prev, message];
          });
        }
        setCommunities((prev) =>
          prev.map((c) =>
            c.id === communityId
              ? {
                  ...c,
                  lastMessagePreview: {
                    senderName: message.senderName,
                    body: message.body,
                    createdAt: message.createdAt,
                  },
                }
              : c
          )
        );
      } else if (
        event.type === 'community:message_updated' ||
        event.type === 'community:message_deleted' ||
        event.type === 'community:message_reaction'
      ) {
        const { communityId, channelId, message } = event.payload || {};
        if (!message) return;
        if (communityId === selectedCommunityId && channelId === selectedChannelId) {
          setMessages((prev) => prev.map((m) => (m.id === message.id ? message : m)));
        }
      } else if (event.type === 'community:member_updated') {
        const { communityId, userId, role, isMuted } = event.payload || {};
        if (communityId === selectedCommunityId) {
          setMembers((prev) =>
            prev.map((m) =>
              m.userId === userId ? { ...m, communityRole: role, isMuted } : m
            )
          );
          if (userId === currentUser.id) {
            setCommunities((prev) =>
              prev.map((c) => (c.id === communityId ? { ...c, myRole: role, isMuted } : c))
            );
          }
        }
      }
    });
    return unsub;
  }, [selectedCommunityId, selectedChannelId, currentUser.id]);

  useEffect(() => {
    if (messages.length > 0) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [messages.length, selectedChannelId]);

  const filteredCommunities = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return communities.filter((c) => {
      if (filterMode === 'joined' && !c.myRole) return false;
      if (disciplineFilter !== 'Tümü' && c.discipline !== disciplineFilter) return false;
      if (q) {
        return (
          c.name.toLowerCase().includes(q) ||
          c.description.toLowerCase().includes(q) ||
          c.city.toLowerCase().includes(q) ||
          c.discipline.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [communities, filterMode, disciplineFilter, searchQuery]);

  const pinnedMessages = useMemo(
    () => messages.filter((m) => m.isPinned && !m.deletedAt),
    [messages]
  );

  const isPlatformStaff = isAuthenticated && ['admin', 'moderator'].includes(currentUser.activeRole);
  const myCommunityRole = selectedCommunity?.myRole || null;
  const isCommunityOwner = myCommunityRole === 'owner' || (isAuthenticated && currentUser.activeRole === 'admin');
  const isCommunityModOrOwner =
    myCommunityRole === 'owner' || myCommunityRole === 'moderator' || isPlatformStaff;

  const canPostInActiveChannel = useMemo(() => {
    if (!isAuthenticated || !selectedCommunity || !activeChannel) return false;
    if (selectedCommunity.isMuted && currentUser.activeRole !== 'admin') return false;
    if (!myCommunityRole && currentUser.activeRole !== 'admin') return false;
    if (activeChannel.isReadonly || activeChannel.channelType === 'announcement') {
      return isCommunityModOrOwner;
    }
    return true;
  }, [isAuthenticated, selectedCommunity, activeChannel, myCommunityRole, isCommunityModOrOwner, currentUser.activeRole]);

  const handleJoinCommunity = async () => {
    if (!selectedCommunity) return;
    if (!isAuthenticated) {
      setAuthModalMode('login');
      return;
    }
    setErrorMsg(null);
    try {
      const res = await apiRequest<{ community: Community }>(
        `/api/communities/${selectedCommunity.id}/join`,
        { method: 'POST' }
      );
      if (res.community) {
        setCommunities((prev) => prev.map((c) => (c.id === res.community.id ? res.community : c)));
      }
      await fetchCommunityDetail(selectedCommunity.id);
      setStatusNotice(`"${selectedCommunity.name}" topluluğuna katıldınız.`);
      setTimeout(() => setStatusNotice(null), 2600);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Topluluğa katılınamadı.');
    }
  };

  const handleLeaveCommunity = async () => {
    if (!selectedCommunity) return;
    setErrorMsg(null);
    try {
      const res = await apiRequest<{ community: Community }>(
        `/api/communities/${selectedCommunity.id}/leave`,
        { method: 'DELETE' }
      );
      if (res.community) {
        setCommunities((prev) => prev.map((c) => (c.id === res.community.id ? res.community : c)));
      }
      await fetchCommunityDetail(selectedCommunity.id);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Topluluktan ayrılınamadı.');
    }
  };

  const handleCreateCommunity = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAuthenticated) {
      setAuthModalMode('login');
      return;
    }
    setErrorMsg(null);
    try {
      const res = await apiRequest<{ community: Community }>('/api/communities', {
        method: 'POST',
        body: {
          name: newCommName.trim(),
          discipline: newCommDiscipline,
          city: newCommCity,
          description: newCommDescription.trim(),
          visibility: newCommVisibility,
        },
      });
      if (res.community) {
        setCommunities((prev) => [res.community, ...prev]);
        setSelectedCommunityId(res.community.id);
        setShowCreateCommunity(false);
        setNewCommName('');
        setNewCommDescription('');
        setMobileShowChannel(true);
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Topluluk oluşturulamadı.');
    }
  };

  const handleCreateChannel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCommunity) return;
    setErrorMsg(null);
    try {
      const res = await apiRequest<{ channel: CommunityChannel }>(
        `/api/communities/${selectedCommunity.id}/channels`,
        {
          method: 'POST',
          body: {
            name: newChannelName.trim(),
            channelType: newChannelType,
            description: newChannelDesc.trim(),
          },
        }
      );
      if (res.channel) {
        setCommunities((prev) =>
          prev.map((c) =>
            c.id === selectedCommunity.id
              ? {
                  ...c,
                  channels: c.channels.some((ch) => ch.id === res.channel.id)
                    ? c.channels
                    : [...c.channels, res.channel],
                }
              : c
          )
        );
        setSelectedChannelId(res.channel.id);
        setShowCreateChannel(false);
        setNewChannelName('');
        setNewChannelDesc('');
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Alt kanal oluşturulamadı.');
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setErrorMsg(null);
    setIsUploading(true);
    try {
      const asset = await uploadMediaFile(file, 'communities');
      setPendingAttachment({
        url: asset.url,
        name: asset.originalName || file.name,
        type: asset.mimeType || file.type,
      });
    } catch (err: any) {
      setErrorMsg(err?.message || 'Dosya yüklenemedi.');
    } finally {
      setIsUploading(false);
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCommunity || !activeChannel || isSending) return;
    const text = draftBody.trim();
    if (!text && !pendingAttachment) return;
    setErrorMsg(null);
    setIsSending(true);
    try {
      const res = await apiRequest<{ message: CommunityMessage }>(
        `/api/communities/${selectedCommunity.id}/channels/${activeChannel.id}/messages`,
        {
          method: 'POST',
          body: {
            body: text,
            attachmentUrl: pendingAttachment?.url,
            attachmentName: pendingAttachment?.name,
            attachmentType: pendingAttachment?.type,
            replyToMessageId: replyTo?.id,
          },
        }
      );
      if (res.message) {
        setMessages((prev) => (prev.some((m) => m.id === res.message.id) ? prev : [...prev, res.message]));
      }
      setDraftBody('');
      setPendingAttachment(null);
      setReplyTo(null);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Mesaj gönderilemedi.');
    } finally {
      setIsSending(false);
    }
  };

  const handleToggleReaction = async (msgId: string, emoji: string) => {
    if (!selectedCommunity || !activeChannel || !isAuthenticated) return;
    setReactionPickerMsgId(null);
    try {
      const res = await apiRequest<{ message: CommunityMessage }>(
        `/api/communities/${selectedCommunity.id}/channels/${activeChannel.id}/messages/${msgId}/reactions`,
        { method: 'POST', body: { emoji } }
      );
      if (res.message) {
        setMessages((prev) => prev.map((m) => (m.id === msgId ? res.message : m)));
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Tepki güncellenemedi.');
    }
  };

  const handleTogglePin = async (msgId: string) => {
    if (!selectedCommunity || !activeChannel) return;
    try {
      const res = await apiRequest<{ message: CommunityMessage }>(
        `/api/communities/${selectedCommunity.id}/channels/${activeChannel.id}/messages/${msgId}/pin`,
        { method: 'POST' }
      );
      if (res.message) {
        setMessages((prev) => prev.map((m) => (m.id === msgId ? res.message : m)));
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Sabitleme değiştirilemedi.');
    }
  };

  const handleDeleteMessage = async (msgId: string) => {
    if (!selectedCommunity || !activeChannel) return;
    try {
      const res = await apiRequest<{ message: CommunityMessage }>(
        `/api/communities/${selectedCommunity.id}/channels/${activeChannel.id}/messages/${msgId}`,
        { method: 'DELETE' }
      );
      if (res.message) {
        setMessages((prev) => prev.map((m) => (m.id === msgId ? res.message : m)));
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Mesaj silinemedi.');
    }
  };

  const handleMemberModeration = async (
    targetUserId: string,
    patch: { isMuted?: boolean; role?: 'moderator' | 'member' }
  ) => {
    if (!selectedCommunity) return;
    setErrorMsg(null);
    try {
      const res = await apiRequest<{ member: { userId: string; communityRole: 'owner' | 'moderator' | 'member'; isMuted: boolean } }>(
        `/api/communities/${selectedCommunity.id}/members/${targetUserId}`,
        { method: 'PATCH', body: patch }
      );
      if (res.member) {
        setMembers((prev) =>
          prev.map((m) =>
            m.userId === targetUserId
              ? { ...m, communityRole: res.member.communityRole, isMuted: res.member.isMuted }
              : m
          )
        );
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Üye yetkisi güncellenemedi.');
    }
  };

  return (
    <div className="max-w-[1180px] mx-auto px-3 sm:px-5 py-4 overflow-x-hidden space-y-3 text-left">
      {/* Compact Header & Segmented Switcher */}
      <div className="bg-white dark:bg-[#13213e] rounded-2xl border border-slate-200 dark:border-[#1e335a] p-3.5 sm:p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-0.5 min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="font-display text-lg sm:text-xl font-bold text-[#16274e] dark:text-white">
              Topluluk Kanalları
            </h1>
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                wsConnected
                  ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-500 border border-slate-200 dark:border-slate-700'
              }`}
            >
              {wsConnected ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
              <span>{wsConnected ? 'Canlı' : 'Bağlanıyor'}</span>
            </span>
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            Disipline özel topluluklar, duyuru kanalları, prova sohbetleri ve moderasyonlu üye odaları.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex p-0.5 rounded-xl bg-slate-100 dark:bg-[#0B1120] border border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={() => navigateTo('messages')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-slate-600 dark:text-slate-300 hover:text-[#16274e] dark:hover:text-white text-[11px] font-bold cursor-pointer transition-colors"
            >
              <MessageSquare className="w-3.5 h-3.5 text-[#E45424]" />
              <span>Sohbetler</span>
            </button>
            <button
              type="button"
              onClick={() => navigateTo('communities')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white dark:bg-[#13213e] text-[#16274e] dark:text-white text-[11px] font-bold shadow-xs cursor-pointer"
            >
              <Hash className="w-3.5 h-3.5 text-[#E45424]" />
              <span>Topluluk Kanalları</span>
            </button>
          </div>

          <button
            type="button"
            onClick={() => {
              if (!isAuthenticated) {
                setAuthModalMode('login');
                return;
              }
              setShowCreateCommunity((p) => !p);
              setErrorMsg(null);
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-[#E45424] hover:bg-[#c84317] text-white text-[11px] font-bold cursor-pointer shadow-xs"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Yeni Topluluk Kur</span>
          </button>
        </div>
      </div>

      {errorMsg && (
        <div
          role="alert"
          className="p-2.5 px-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs flex items-center justify-between gap-2"
        >
          <span className="break-words min-w-0">{errorMsg}</span>
          <button type="button" onClick={() => setErrorMsg(null)} className="p-1 cursor-pointer shrink-0">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {statusNotice && (
        <div
          role="status"
          className="p-2.5 px-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 text-xs flex items-center gap-2"
        >
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{statusNotice}</span>
        </div>
      )}

      {/* Create Community Panel */}
      {showCreateCommunity && (
        <form
          onSubmit={handleCreateCommunity}
          className="bg-white dark:bg-[#13213e] rounded-2xl border border-slate-200 dark:border-[#1e335a] p-4 space-y-3 shadow-sm"
        >
          <div className="flex items-center justify-between">
            <h2 className="font-display text-sm font-bold text-[#16274e] dark:text-white">
              Yeni Sanat Topluluğu Oluştur
            </h2>
            <button
              type="button"
              onClick={() => setShowCreateCommunity(false)}
              className="text-xs text-slate-500 hover:text-slate-800 dark:hover:text-white cursor-pointer"
            >
              Kapat
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
            <div>
              <label htmlFor="comm-name-input" className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
                Topluluk Adı
              </label>
              <input
                id="comm-name-input"
                required
                minLength={3}
                value={newCommName}
                onChange={(e) => setNewCommName(e.target.value)}
                placeholder="Örn: Ankara Yaylı Çalgılar Ağı"
                className="w-full px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120] text-xs"
              />
            </div>
            <div>
              <label htmlFor="comm-disc-select" className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
                Disiplin
              </label>
              <select
                id="comm-disc-select"
                value={newCommDiscipline}
                onChange={(e) => setNewCommDiscipline(e.target.value as ArtDiscipline)}
                className="w-full px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120] text-xs"
              >
                {ART_DISCIPLINES.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="comm-city-select" className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
                Şehir
              </label>
              <select
                id="comm-city-select"
                value={newCommCity}
                onChange={(e) => setNewCommCity(e.target.value)}
                className="w-full px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120] text-xs"
              >
                {CITY_LIST.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="comm-vis-select" className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
                Katılım Tipi
              </label>
              <select
                id="comm-vis-select"
                value={newCommVisibility}
                onChange={(e) => setNewCommVisibility(e.target.value as 'public' | 'private_invite')}
                className="w-full px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120] text-xs"
              >
                <option value="public">Herkese Açık Topluluk</option>
                <option value="private_invite">Yalnızca Davetli</option>
              </select>
            </div>
          </div>
          <div className="flex flex-col sm:flex-row gap-2.5 items-stretch sm:items-center">
            <input
              value={newCommDescription}
              onChange={(e) => setNewCommDescription(e.target.value)}
              placeholder="Kısa açıklama: kimler katılmalı, ne paylaşılır..."
              className="flex-1 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120] text-xs"
            />
            <button
              type="submit"
              className="px-4 py-1.5 rounded-xl bg-[#16274e] hover:bg-[#1e356a] dark:bg-[#E45424] text-white text-xs font-bold cursor-pointer shrink-0"
            >
              Topluluğu Kur (Duyurular + #genel Açılır)
            </button>
          </div>
        </form>
      )}

      {/* Main Split Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5 min-h-[520px] lg:h-[580px] min-w-0">
        {/* Left Rail: Communities + Active Community Sub-Channels */}
        <div
          className={`lg:col-span-4 min-w-0 bg-white dark:bg-[#13213e] rounded-2xl border border-slate-200 dark:border-[#1e335a] flex flex-col overflow-hidden ${
            mobileShowChannel ? 'hidden lg:flex' : 'flex'
          }`}
        >
          {/* Filter + Search */}
          <div className="p-2.5 border-b border-slate-100 dark:border-slate-800 space-y-2">
            <div className="grid grid-cols-2 gap-1 p-0.5 rounded-xl bg-slate-100 dark:bg-[#0B1120]">
              <button
                type="button"
                onClick={() => setFilterMode('all')}
                className={`py-1 rounded-lg text-[11px] font-bold cursor-pointer ${
                  filterMode === 'all'
                    ? 'bg-white dark:bg-[#13213e] text-[#16274e] dark:text-white shadow-xs'
                    : 'text-slate-500'
                }`}
              >
                Tüm Topluluklar ({communities.length})
              </button>
              <button
                type="button"
                onClick={() => setFilterMode('joined')}
                className={`py-1 rounded-lg text-[11px] font-bold cursor-pointer ${
                  filterMode === 'joined'
                    ? 'bg-white dark:bg-[#13213e] text-[#16274e] dark:text-white shadow-xs'
                    : 'text-slate-500'
                }`}
              >
                Üye Olduklarım ({communities.filter((c) => c.myRole !== null).length})
              </button>
            </div>

            <div className="flex gap-1.5">
              <div className="relative flex-1 min-w-0">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Topluluk veya şehir ara..."
                  className="w-full pl-8 pr-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120] text-xs"
                />
              </div>
              <select
                value={disciplineFilter}
                onChange={(e) => setDisciplineFilter(e.target.value)}
                aria-label="Disiplin filtresi"
                className="px-2 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120] text-[11px] max-w-[110px]"
              >
                <option value="Tümü">Tüm Alanlar</option>
                {ART_DISCIPLINES.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Community Cards + Inline Sub-channels */}
          <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/80">
            {loadingList ? (
              <div className="p-6 text-center text-xs text-slate-400">Topluluklar yükleniyor...</div>
            ) : filteredCommunities.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-400">Eşleşen topluluk bulunamadı.</div>
            ) : (
              filteredCommunities.map((comm) => {
                const isSelected = selectedCommunity?.id === comm.id;
                return (
                  <div
                    key={comm.id}
                    className={`transition-colors ${
                      isSelected ? 'bg-orange-50/60 dark:bg-[#E45424]/10' : 'hover:bg-slate-50 dark:hover:bg-[#0B1120]/50'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedCommunityId(comm.id);
                        setShowMembersDrawer(false);
                        setMobileShowChannel(true);
                      }}
                      className="w-full text-left p-2.5 flex items-start gap-2.5 cursor-pointer"
                    >
                      <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#16274e] to-[#284385] text-white font-display font-bold text-xs flex items-center justify-center shrink-0 overflow-hidden">
                        {comm.avatarUrl ? (
                          <img src={comm.avatarUrl} alt={comm.name} className="w-full h-full object-cover" />
                        ) : (
                          comm.name.slice(0, 2).toUpperCase()
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-1.5">
                          <div className="flex items-center gap-1 min-w-0">
                            <span className="text-xs font-bold text-[#16274e] dark:text-white truncate">
                              {comm.name}
                            </span>
                            {comm.isVerified && (
                              <VerifiedBadge
                                size="sm"
                                label={comm.verifiedLabel || 'Doğrulanmış Topluluk'}
                              />
                            )}
                          </div>
                          {comm.myRole && (
                            <span className="px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 text-[9px] font-bold shrink-0">
                              {comm.myRole === 'owner'
                                ? 'Kurucu'
                                : comm.myRole === 'moderator'
                                ? 'Mod'
                                : 'Üye'}
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                          {comm.discipline} · {comm.city} · {comm.memberCount} üye
                        </div>
                        {comm.lastMessagePreview && (
                          <div className="text-[10px] text-slate-400 truncate mt-0.5">
                            <span className="font-semibold text-slate-600 dark:text-slate-300">
                              {comm.lastMessagePreview.senderName}:
                            </span>{' '}
                            {comm.lastMessagePreview.body}
                          </div>
                        )}
                      </div>
                    </button>

                    {/* Sub-channels list when community is active */}
                    {isSelected && (
                      <div className="px-2.5 pb-2.5 pl-12 space-y-1">
                        {comm.channels.map((ch) => {
                          const isChActive = activeChannel?.id === ch.id;
                          const isAnnouncement = ch.channelType === 'announcement' || ch.isReadonly;
                          return (
                            <button
                              key={ch.id}
                              type="button"
                              onClick={() => {
                                setSelectedChannelId(ch.id);
                                setMobileShowChannel(true);
                              }}
                              className={`w-full text-left px-2.5 py-1.5 rounded-lg text-[11px] font-semibold flex items-center justify-between gap-2 cursor-pointer transition-colors ${
                                isChActive
                                  ? 'bg-[#16274e] dark:bg-[#E45424] text-white font-bold shadow-xs'
                                  : 'text-slate-700 dark:text-slate-300 hover:bg-white dark:hover:bg-[#13213e]'
                              }`}
                            >
                              <span className="inline-flex items-center gap-1.5 min-w-0 truncate">
                                {isAnnouncement ? (
                                  <Megaphone className="w-3 h-3 shrink-0" />
                                ) : (
                                  <Hash className="w-3 h-3 shrink-0" />
                                )}
                                <span className="truncate">{ch.name}</span>
                              </span>
                              {ch.isReadonly && (
                                <span title="Yalnızca kurucu ve moderatörler mesaj yazabilir" className="shrink-0 inline-flex">
                                  <Lock
                                    className={`w-3 h-3 ${
                                      isChActive ? 'text-white/80' : 'text-amber-600 dark:text-amber-400'
                                    }`}
                                  />
                                </span>
                              )}
                            </button>
                          );
                        })}

                        {isCommunityModOrOwner && (
                          <div className="pt-1">
                            {!showCreateChannel ? (
                              <button
                                type="button"
                                onClick={() => setShowCreateChannel(true)}
                                className="inline-flex items-center gap-1 text-[10px] font-bold text-[#E45424] hover:underline cursor-pointer px-1"
                              >
                                <Plus className="w-3 h-3" />
                                <span>Alt Kanal Ekle</span>
                              </button>
                            ) : (
                              <form
                                onSubmit={handleCreateChannel}
                                className="p-2 rounded-xl bg-white dark:bg-[#0B1120] border border-slate-200 dark:border-slate-700 space-y-1.5"
                              >
                                <input
                                  required
                                  minLength={2}
                                  value={newChannelName}
                                  onChange={(e) => setNewChannelName(e.target.value)}
                                  placeholder="Örn: doğaçlama-kayıtları"
                                  className="w-full px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#13213e] text-[11px]"
                                />
                                <input
                                  value={newChannelDesc}
                                  onChange={(e) => setNewChannelDesc(e.target.value)}
                                  placeholder="Kanal açıklaması (opsiyonel)"
                                  className="w-full px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#13213e] text-[11px]"
                                />
                                <div className="flex items-center justify-between gap-1.5">
                                  <select
                                    value={newChannelType}
                                    onChange={(e) => setNewChannelType(e.target.value as 'discussion' | 'announcement')}
                                    className="px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#13213e] text-[10px]"
                                  >
                                    <option value="discussion">Sohbet Kanalı</option>
                                    <option value="announcement">Duyuru (Salt Okunur)</option>
                                  </select>
                                  <div className="flex gap-1">
                                    <button
                                      type="button"
                                      onClick={() => setShowCreateChannel(false)}
                                      className="px-2 py-1 text-[10px] text-slate-500 cursor-pointer"
                                    >
                                      İptal
                                    </button>
                                    <button
                                      type="submit"
                                      className="px-2.5 py-1 rounded-lg bg-[#E45424] text-white text-[10px] font-bold cursor-pointer"
                                    >
                                      Ekle
                                    </button>
                                  </div>
                                </div>
                              </form>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right Pane: Active Channel Room */}
        <div
          className={`lg:col-span-8 min-w-0 bg-white dark:bg-[#13213e] rounded-2xl border border-slate-200 dark:border-[#1e335a] flex flex-col overflow-hidden ${
            mobileShowChannel ? 'flex' : 'hidden lg:flex'
          }`}
        >
          {!selectedCommunity || !activeChannel ? (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-slate-400 space-y-2">
              <Hash className="w-10 h-10 opacity-30" />
              <p className="text-xs font-semibold">Soldaki listeden bir topluluk ve alt kanal seçin.</p>
            </div>
          ) : (
            <>
              {/* Channel Header */}
              <div className="px-3.5 py-2.5 border-b border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 bg-slate-50/70 dark:bg-[#0B1120]/50">
                <div className="flex items-center gap-2 min-w-0">
                  <button
                    type="button"
                    onClick={() => setMobileShowChannel(false)}
                    className="lg:hidden p-1 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 cursor-pointer"
                    aria-label="Topluluk listesine dön"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <div className="w-8 h-8 rounded-xl bg-[#16274e]/10 dark:bg-white/10 text-[#16274e] dark:text-[#ffb59e] flex items-center justify-center shrink-0">
                    {activeChannel.channelType === 'announcement' || activeChannel.isReadonly ? (
                      <Megaphone className="w-4 h-4 text-[#E45424]" />
                    ) : (
                      <Hash className="w-4 h-4 text-[#E45424]" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-xs font-extrabold text-[#16274e] dark:text-white truncate">
                        {selectedCommunity.name}
                      </span>
                      {selectedCommunity.isVerified && (
                        <VerifiedBadge
                          size="sm"
                          label={selectedCommunity.verifiedLabel || 'Doğrulanmış Topluluk'}
                        />
                      )}
                      <span className="text-slate-300 dark:text-slate-600">/</span>
                      <span className="text-xs font-bold text-[#E45424]">{activeChannel.name}</span>
                      {activeChannel.isReadonly && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800 text-[9px] font-bold text-amber-800 dark:text-amber-300">
                          <Lock className="w-2.5 h-2.5" />
                          Yalnızca Kurucu &amp; Mod
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                      {activeChannel.description || selectedCommunity.description}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => setShowMembersDrawer((p) => !p)}
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-xl border text-[11px] font-bold cursor-pointer transition-colors ${
                      showMembersDrawer
                        ? 'bg-[#16274e] text-white border-[#16274e]'
                        : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-[#13213e] text-slate-700 dark:text-slate-200'
                    }`}
                  >
                    <Users className="w-3.5 h-3.5" />
                    <span>Üyeler ({members.length || selectedCommunity.memberCount})</span>
                  </button>

                  {!isAuthenticated ? (
                    <button
                      type="button"
                      onClick={() => setAuthModalMode('login')}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-[#E45424] text-white text-[11px] font-bold cursor-pointer"
                    >
                      <LogIn className="w-3.5 h-3.5" />
                      <span>Katıl</span>
                    </button>
                  ) : myCommunityRole ? (
                    myCommunityRole !== 'owner' && (
                      <button
                        type="button"
                        onClick={handleLeaveCommunity}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:text-rose-600 text-[11px] font-bold cursor-pointer"
                      >
                        <LogOut className="w-3 h-3" />
                        <span>Ayrıl</span>
                      </button>
                    )
                  ) : (
                    <button
                      type="button"
                      onClick={handleJoinCommunity}
                      className="inline-flex items-center gap-1 px-3 py-1 rounded-xl bg-[#E45424] hover:bg-[#c84317] text-white text-[11px] font-bold cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Katıl</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Members & Moderation Drawer */}
              {showMembersDrawer && (
                <div className="px-3.5 py-2.5 bg-slate-50 dark:bg-[#0B1120] border-b border-slate-200 dark:border-slate-800 max-h-52 overflow-y-auto space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-[#16274e] dark:text-white">
                      Topluluk Üyeleri &amp; Yetkiler ({members.length})
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowMembersDrawer(false)}
                      className="text-[11px] text-slate-500 hover:text-slate-800 dark:hover:text-white cursor-pointer"
                    >
                      Kapat
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {members.map((m) => {
                      const canModerateTarget = isCommunityModOrOwner && m.communityRole !== 'owner' && m.userId !== currentUser.id;
                      const canChangeRole = isCommunityOwner && m.communityRole !== 'owner' && m.userId !== currentUser.id;
                      return (
                        <div
                          key={m.userId}
                          className="p-2 rounded-xl bg-white dark:bg-[#13213e] border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2 min-w-0"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <div className="relative shrink-0">
                              <img
                                src={m.avatarUrl}
                                alt={m.name}
                                className="w-7 h-7 rounded-full object-cover"
                              />
                              <span
                                className={`w-2 h-2 rounded-full absolute bottom-0 right-0 ring-1 ring-white dark:ring-[#13213e] ${
                                  m.isOnline ? 'bg-emerald-500' : 'bg-slate-400'
                                }`}
                              />
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-1 min-w-0">
                                <span className="text-[11px] font-bold text-[#16274e] dark:text-white truncate">
                                  {m.name}
                                </span>
                                {m.isVerified && <VerifiedBadge size="sm" />}
                              </div>
                              <div className="flex items-center gap-1 text-[10px] text-slate-500">
                                <span>
                                  {m.communityRole === 'owner'
                                    ? 'Kurucu'
                                    : m.communityRole === 'moderator'
                                    ? 'Moderatör'
                                    : 'Üye'}
                                </span>
                                {m.isMuted && (
                                  <span className="text-rose-600 font-bold">· Susturuldu</span>
                                )}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
                            {canChangeRole && (
                              <button
                                type="button"
                                onClick={() =>
                                  handleMemberModeration(m.userId, {
                                    role: m.communityRole === 'moderator' ? 'member' : 'moderator',
                                  })
                                }
                                title={
                                  m.communityRole === 'moderator'
                                    ? 'Moderatörlüğü Kaldır'
                                    : 'Moderatör Yap'
                                }
                                className={`px-2 py-1 rounded-lg text-[10px] font-bold inline-flex items-center gap-1 cursor-pointer ${
                                  m.communityRole === 'moderator'
                                    ? 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-200'
                                    : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-indigo-50'
                                }`}
                              >
                                <Shield className="w-3 h-3" />
                                <span>{m.communityRole === 'moderator' ? 'Mod' : 'Mod Yap'}</span>
                              </button>
                            )}
                            {canModerateTarget && (
                              <button
                                type="button"
                                onClick={() =>
                                  handleMemberModeration(m.userId, { isMuted: !m.isMuted })
                                }
                                title={m.isMuted ? 'Susturmayı Kaldır' : 'Kanalda Sustur'}
                                className={`p-1.5 rounded-lg text-[10px] font-bold cursor-pointer ${
                                  m.isMuted
                                    ? 'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300'
                                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:text-rose-600'
                                }`}
                              >
                                {m.isMuted ? (
                                  <Volume2 className="w-3.5 h-3.5" />
                                ) : (
                                  <VolumeX className="w-3.5 h-3.5" />
                                )}
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Pinned Announcements Strip */}
              {pinnedMessages.length > 0 && (
                <div className="px-3.5 py-2 bg-amber-50/80 dark:bg-amber-950/30 border-b border-amber-200/70 dark:border-amber-800/50 space-y-1">
                  {pinnedMessages.slice(0, 2).map((pm) => (
                    <div key={pm.id} className="flex items-start justify-between gap-2 text-[11px] min-w-0">
                      <div className="flex items-start gap-1.5 min-w-0">
                        <Pin className="w-3.5 h-3.5 text-[#E45424] shrink-0 mt-0.5" />
                        <div className="min-w-0">
                          <span className="font-bold text-[#16274e] dark:text-amber-200">
                            Sabitlenen ({pm.senderName}):{' '}
                          </span>
                          <span className="text-slate-700 dark:text-slate-200 break-words [overflow-wrap:anywhere]">
                            {pm.body}
                          </span>
                        </div>
                      </div>
                      {isCommunityModOrOwner && (
                        <button
                          type="button"
                          onClick={() => handleTogglePin(pm.id)}
                          title="Sabitlemeyi Kaldır"
                          className="text-slate-400 hover:text-rose-600 shrink-0 cursor-pointer"
                        >
                          <PinOff className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Channel Messages Feed */}
              <div className="flex-1 overflow-y-auto overflow-x-hidden px-3.5 py-3 space-y-2.5 min-w-0">
                {loadingMessages ? (
                  <div className="py-10 text-center text-xs text-slate-400">Mesajlar yükleniyor...</div>
                ) : messages.length === 0 ? (
                  <div className="py-10 text-center text-xs text-slate-400">
                    {activeChannel.name} kanalında henüz mesaj yok. İlk paylaşımı siz yapın.
                  </div>
                ) : (
                  messages.map((msg) => {
                    const isMine = msg.senderUserId === currentUser.id;
                    const isDeleted = Boolean(msg.deletedAt);
                    const reactionEntries = Object.entries(msg.reactions || {}).filter(
                      ([, uids]) => Array.isArray(uids) && uids.length > 0
                    );
                    const canDelete = isMine || isCommunityModOrOwner;

                    return (
                      <div
                        key={msg.id}
                        className={`group flex items-start gap-2.5 min-w-0 ${
                          isMine ? 'flex-row-reverse' : 'flex-row'
                        }`}
                      >
                        {!isMine && (
                          <img
                            src={msg.senderAvatar || '/src/assets/images/artist_jazz_pianist_1794440057025.jpg'}
                            alt={msg.senderName}
                            className="w-7 h-7 rounded-full object-cover shrink-0 mt-0.5"
                          />
                        )}

                        <div
                          className={`flex flex-col min-w-0 max-w-[85%] sm:max-w-[78%] ${
                            isMine ? 'items-end' : 'items-start'
                          }`}
                        >
                          <div
                            className={`flex items-center gap-1.5 mb-0.5 text-[10px] ${
                              isMine ? 'flex-row-reverse' : 'flex-row'
                            }`}
                          >
                            <span className="font-bold text-[#16274e] dark:text-slate-200">
                              {msg.senderName}
                            </span>
                            {msg.senderRole !== 'member' && (
                              <span className="px-1.5 py-0.2 rounded bg-orange-50 dark:bg-orange-950/60 text-[#E45424] font-bold text-[9px]">
                                {msg.senderRole === 'owner' ? 'Kurucu' : 'Mod'}
                              </span>
                            )}
                            <span className="text-slate-400 tabular-nums">{formatMsgTime(msg.createdAt)}</span>
                          </div>

                          <div
                            className={`relative rounded-2xl px-3 py-2 text-[12px] leading-snug max-w-full overflow-hidden border ${
                              isDeleted
                                ? 'bg-slate-100 dark:bg-slate-800/50 text-slate-400 italic border-slate-200 dark:border-slate-700'
                                : isMine
                                ? 'bg-[#16274e] dark:bg-[#E45424] text-white border-transparent'
                                : 'bg-slate-50 dark:bg-[#0B1120] text-slate-800 dark:text-slate-100 border-slate-200 dark:border-slate-800'
                            }`}
                          >
                            {msg.replyToSnippet && !isDeleted && (
                              <div
                                className={`mb-1.5 pl-2 border-l-2 text-[10px] min-w-0 ${
                                  isMine
                                    ? 'border-white/50 text-white/80'
                                    : 'border-[#E45424] text-slate-500 dark:text-slate-400'
                                }`}
                              >
                                <div className="font-bold truncate">{msg.replyToSnippet.senderName}</div>
                                <div className="truncate">{msg.replyToSnippet.body}</div>
                              </div>
                            )}

                            <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                              {msg.body}
                            </p>

                            {msg.attachmentUrl && !isDeleted && (
                              <div className="mt-1.5">
                                {msg.attachmentType?.startsWith('image/') ? (
                                  <img
                                    src={msg.attachmentUrl}
                                    alt={msg.attachmentName || 'Ek görsel'}
                                    className="max-h-44 rounded-xl object-cover border border-black/10"
                                  />
                                ) : (
                                  <a
                                    href={msg.attachmentUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className={`inline-flex items-center gap-1.5 text-[11px] font-semibold underline ${
                                      isMine ? 'text-white' : 'text-[#E45424]'
                                    }`}
                                  >
                                    <FileText className="w-3.5 h-3.5 shrink-0" />
                                    <span className="truncate max-w-[200px]">
                                      {msg.attachmentName || 'Ek Dosya'}
                                    </span>
                                  </a>
                                )}
                              </div>
                            )}
                          </div>

                          {/* Reactions + Action Toolbar */}
                          {!isDeleted && (
                            <div className="flex flex-wrap items-center gap-1 mt-1">
                              {reactionEntries.map(([emoji, uids]) => {
                                const reacted = uids.includes(currentUser.id);
                                return (
                                  <button
                                    key={emoji}
                                    type="button"
                                    onClick={() => handleToggleReaction(msg.id, emoji)}
                                    className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold border cursor-pointer ${
                                      reacted
                                        ? 'bg-orange-50 dark:bg-orange-950/60 border-[#E45424]/50 text-[#E45424]'
                                        : 'bg-white dark:bg-[#0B1120] border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                                    }`}
                                  >
                                    <span>{emoji}</span>
                                    <span className="tabular-nums">{uids.length}</span>
                                  </button>
                                );
                              })}

                              {isAuthenticated && (
                                <div className="flex items-center gap-0.5 opacity-85 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setReactionPickerMsgId((p) => (p === msg.id ? null : msg.id))
                                    }
                                    title="Tepki ekle"
                                    className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-[#E45424] cursor-pointer"
                                  >
                                    <Smile className="w-3 h-3" />
                                  </button>
                                  {canPostInActiveChannel && (
                                    <button
                                      type="button"
                                      onClick={() => setReplyTo(msg)}
                                      title="Yanıtla"
                                      className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-[#16274e] dark:hover:text-white cursor-pointer"
                                    >
                                      <Reply className="w-3 h-3" />
                                    </button>
                                  )}
                                  {isCommunityModOrOwner && (
                                    <button
                                      type="button"
                                      onClick={() => handleTogglePin(msg.id)}
                                      title={msg.isPinned ? 'Sabitlemeyi Kaldır' : 'Kanala Sabitle'}
                                      className={`p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer ${
                                        msg.isPinned ? 'text-[#E45424]' : 'text-slate-400 hover:text-[#E45424]'
                                      }`}
                                    >
                                      <Pin className="w-3 h-3" />
                                    </button>
                                  )}
                                  {canDelete && (
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteMessage(msg.id)}
                                      title="Mesajı Sil"
                                      className="p-1 rounded hover:bg-rose-50 dark:hover:bg-rose-950/30 text-slate-400 hover:text-rose-600 cursor-pointer"
                                    >
                                      <Trash2 className="w-3 h-3" />
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          )}

                          {reactionPickerMsgId === msg.id && (
                            <div className="flex items-center gap-1 mt-1 p-1 rounded-xl bg-white dark:bg-[#0B1120] border border-slate-200 dark:border-slate-700 shadow-md">
                              {COMMUNITY_REACTION_EMOJIS.map((emoji) => (
                                <button
                                  key={emoji}
                                  type="button"
                                  onClick={() => handleToggleReaction(msg.id, emoji)}
                                  className="px-1.5 py-0.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-sm cursor-pointer"
                                >
                                  {emoji}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Channel Footer / Permission State / Composer */}
              <div className="p-2.5 border-t border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-[#0B1120]/50">
                {!isAuthenticated ? (
                  <div className="flex items-center justify-between gap-3 px-2 py-1 text-xs">
                    <span className="text-slate-600 dark:text-slate-300">
                      Kanal tartışmalarına katılmak için giriş yapın.
                    </span>
                    <button
                      type="button"
                      onClick={() => setAuthModalMode('login')}
                      className="px-3 py-1.5 rounded-xl bg-[#E45424] text-white font-bold text-[11px] cursor-pointer shrink-0"
                    >
                      Giriş Yap
                    </button>
                  </div>
                ) : !myCommunityRole && currentUser.activeRole !== 'admin' ? (
                  <div className="flex flex-wrap items-center justify-between gap-2 px-2 py-1 text-xs">
                    <span className="text-slate-600 dark:text-slate-300">
                      Bu kanala mesaj göndermek için topluluğa katılmalısınız.
                    </span>
                    <button
                      type="button"
                      onClick={handleJoinCommunity}
                      className="px-3.5 py-1.5 rounded-xl bg-[#E45424] text-white font-bold text-[11px] cursor-pointer shrink-0"
                    >
                      Topluluğa Katıl
                    </button>
                  </div>
                ) : selectedCommunity.isMuted && currentUser.activeRole !== 'admin' ? (
                  <div className="px-3 py-2 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs flex items-center gap-2">
                    <VolumeX className="w-4 h-4 shrink-0" />
                    <span>Bu toplulukta susturulduğunuz için şu anda mesaj gönderemezsiniz.</span>
                  </div>
                ) : (activeChannel.isReadonly || activeChannel.channelType === 'announcement') &&
                  !isCommunityModOrOwner ? (
                  <div className="px-3 py-2 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 text-xs flex items-center gap-2">
                    <Lock className="w-4 h-4 shrink-0" />
                    <span>
                      Duyurular kanalına yalnızca topluluk kurucuları ve moderatörler mesaj gönderebilir.
                    </span>
                  </div>
                ) : (
                  <form onSubmit={handleSendMessage} className="space-y-1.5">
                    {replyTo && (
                      <div className="flex items-center justify-between gap-2 px-2.5 py-1 rounded-lg bg-white dark:bg-[#13213e] border border-slate-200 dark:border-slate-700 text-[11px]">
                        <span className="truncate text-slate-600 dark:text-slate-300">
                          <strong className="text-[#E45424]">{replyTo.senderName}</strong> yanıtlanıyor:{' '}
                          {replyTo.body}
                        </span>
                        <button
                          type="button"
                          onClick={() => setReplyTo(null)}
                          className="text-slate-400 hover:text-rose-600 cursor-pointer shrink-0"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}

                    {pendingAttachment && (
                      <div className="flex items-center justify-between gap-2 px-2.5 py-1 rounded-lg bg-white dark:bg-[#13213e] border border-slate-200 dark:border-slate-700 text-[11px]">
                        <span className="inline-flex items-center gap-1.5 truncate text-[#16274e] dark:text-white font-semibold">
                          <FileText className="w-3.5 h-3.5 text-[#E45424]" />
                          <span className="truncate">{pendingAttachment.name}</span>
                        </span>
                        <button
                          type="button"
                          onClick={() => setPendingAttachment(null)}
                          className="text-slate-400 hover:text-rose-600 cursor-pointer shrink-0"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}

                    <div className="flex items-center gap-1.5">
                      <input
                        ref={fileInputRef}
                        type="file"
                        onChange={handleFileChange}
                        className="hidden"
                      />
                      <button
                        type="button"
                        disabled={isUploading}
                        onClick={() => fileInputRef.current?.click()}
                        title="Dosya ekle"
                        className="p-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#13213e] text-slate-600 dark:text-slate-300 hover:border-[#E45424] cursor-pointer shrink-0"
                      >
                        <Paperclip className="w-4 h-4" />
                      </button>

                      <input
                        value={draftBody}
                        onChange={(e) => setDraftBody(e.target.value)}
                        placeholder={`${activeChannel.name} kanalına mesaj yazın...`}
                        className="flex-1 min-w-0 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#13213e] text-xs"
                      />

                      <button
                        type="submit"
                        disabled={isSending || (!draftBody.trim() && !pendingAttachment)}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#E45424] hover:bg-[#c84317] disabled:opacity-50 text-white text-xs font-bold cursor-pointer shrink-0"
                      >
                        <Send className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">Gönder</span>
                      </button>
                    </div>
                  </form>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
