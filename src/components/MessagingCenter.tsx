import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useApp, AppView } from '../context/AppContext';
import { uploadMediaFile } from '../services/api';
import { ConversationMessage, MessagingContact } from '../types';
import {
  MessageSquare,
  Send,
  Plus,
  Ban,
  Search,
  Users,
  Paperclip,
  Reply,
  Pencil,
  Trash2,
  Check,
  CheckCheck,
  X,
  FileText,
  Smile,
  UserPlus,
  LogOut,
  ShieldAlert,
  ChevronLeft,
  Wifi,
  WifiOff,
  ExternalLink,
} from 'lucide-react';

type FilterTab = 'all' | 'unread' | 'groups' | 'requests';

const REACTION_EMOJIS = ['👏', '❤️', '🔥', '🎵', '👍', '✨'] as const;

function formatShortTime(iso?: string): string {
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

export const MessagingCenter: React.FC = () => {
  const {
    conversations,
    currentUser,
    isAuthenticated,
    setAuthModalMode,
    startConversation,
    sendMessage,
    editMessage,
    deleteMessage,
    toggleMessageReaction,
    markConversationRead,
    respondConversationRequest,
    addConversationMember,
    removeConversationMember,
    sendTypingIndicator,
    fetchMessagingContacts,
    wsConnected,
    onlineUserIds,
    typingByConversation,
    unreadMessagesCount,
    artists,
    ensembles,
    businesses,
    socialGraph,
    navigateTo,
  } = useApp();

  const [selectedId, setSelectedId] = useState<string>('');
  const [mobileShowThread, setMobileShowThread] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<FilterTab>('all');

  const [messageDraft, setMessageDraft] = useState('');
  const [replyTo, setReplyTo] = useState<ConversationMessage | null>(null);
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState('');
  const [reactionPickerMsgId, setReactionPickerMsgId] = useState<string | null>(null);

  const [pendingAttachment, setPendingAttachment] = useState<{
    url: string;
    name: string;
    type: string;
  } | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // New conversation / group composer modal
  const [showNewThread, setShowNewThread] = useState(false);
  const [newMode, setNewMode] = useState<'direct' | 'group'>('direct');
  const [contactSearch, setContactSearch] = useState('');
  const [contacts, setContacts] = useState<MessagingContact[]>([]);
  const [selectedContactIds, setSelectedContactIds] = useState<string[]>([]);
  const [newTitle, setNewTitle] = useState('');
  const [newBody, setNewBody] = useState('');

  // Group member management drawer
  const [showMembersDrawer, setShowMembersDrawer] = useState(false);
  const [memberToAdd, setMemberToAdd] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const threadEndRef = useRef<HTMLDivElement>(null);
  const typingStopTimerRef = useRef<number | null>(null);
  const lastTypingSentConvRef = useRef<string | null>(null);

  // Build quick fallback contact list from bootstrap directory data merged with API contacts
  const fallbackContacts = useMemo<MessagingContact[]>(() => {
    const map = new Map<string, MessagingContact>();
    for (const a of artists) {
      if (a.userId === currentUser.id || socialGraph.blockedUserIds.includes(a.userId)) continue;
      map.set(a.userId, {
        userId: a.userId,
        name: a.fullName,
        avatarUrl: a.avatarUrl,
        role: 'artist',
        subtitle: a.title || 'Sanatçı',
        profileView: 'artist_profile',
        profileEntityId: a.id,
        isOnline: onlineUserIds.includes(a.userId),
      });
    }
    for (const e of ensembles) {
      if (e.leaderUserId === currentUser.id || socialGraph.blockedUserIds.includes(e.leaderUserId)) continue;
      if (!map.has(e.leaderUserId)) {
        map.set(e.leaderUserId, {
          userId: e.leaderUserId,
          name: e.name,
          avatarUrl: e.avatarUrl,
          role: 'ensemble_leader',
          subtitle: e.ensembleType,
          profileView: 'ensemble_profile',
          profileEntityId: e.id,
          isOnline: onlineUserIds.includes(e.leaderUserId),
        });
      }
    }
    for (const b of businesses) {
      if (b.userId === currentUser.id || socialGraph.blockedUserIds.includes(b.userId)) continue;
      if (!map.has(b.userId)) {
        map.set(b.userId, {
          userId: b.userId,
          name: b.businessName,
          avatarUrl: b.logoUrl,
          role: 'business_owner',
          subtitle: b.businessType,
          profileView: 'business_profile',
          profileEntityId: b.id,
          isOnline: onlineUserIds.includes(b.userId),
        });
      }
    }
    return Array.from(map.values());
  }, [artists, ensembles, businesses, currentUser.id, socialGraph.blockedUserIds, onlineUserIds]);

  useEffect(() => {
    if (!isAuthenticated || (!showNewThread && !showMembersDrawer)) return;
    let active = true;
    const timer = window.setTimeout(async () => {
      const apiContacts = await fetchMessagingContacts(contactSearch);
      if (!active) return;
      if (apiContacts.length > 0) {
        setContacts(apiContacts);
      } else {
        const q = contactSearch.trim().toLowerCase();
        setContacts(
          q
            ? fallbackContacts.filter(
                (c) =>
                  c.name.toLowerCase().includes(q) ||
                  (c.subtitle || '').toLowerCase().includes(q)
              )
            : fallbackContacts
        );
      }
    }, 150);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [isAuthenticated, showNewThread, showMembersDrawer, contactSearch, fetchMessagingContacts, fallbackContacts]);

  const activeContacts = contacts.length > 0 ? contacts : fallbackContacts;

  const pendingRequestsCount = useMemo(
    () =>
      conversations.filter(
        (c) => c.status === 'pending_request' && c.createdByUserId !== currentUser.id
      ).length,
    [conversations, currentUser.id]
  );

  const groupChatsCount = useMemo(
    () =>
      conversations.filter(
        (c) => c.conversationType === 'group' || c.participantUserIds.length > 2
      ).length,
    [conversations]
  );

  const filteredConversations = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return conversations.filter((c) => {
      if (c.status === 'declined') return false;
      if (activeTab === 'unread' && (c.unreadCount || 0) === 0) return false;
      if (activeTab === 'groups' && c.conversationType !== 'group' && c.participantUserIds.length <= 2) {
        return false;
      }
      if (activeTab === 'requests' && c.status !== 'pending_request') return false;

      if (!q) return true;
      const matchTitle = c.title.toLowerCase().includes(q);
      const matchParticipant = (c.participants || []).some((p) =>
        p.name.toLowerCase().includes(q)
      );
      const matchMsg = c.messages.some((m) => m.body.toLowerCase().includes(q));
      return matchTitle || matchParticipant || matchMsg;
    });
  }, [conversations, activeTab, searchQuery]);

  // Keep selectedId synchronized
  useEffect(() => {
    if (!selectedId && filteredConversations.length > 0) {
      setSelectedId(filteredConversations[0].id);
      return;
    }
    if (selectedId && !conversations.some((c) => c.id === selectedId)) {
      setSelectedId(filteredConversations[0]?.id || conversations[0]?.id || '');
    }
  }, [selectedId, filteredConversations, conversations]);

  const activeConv =
    conversations.find((c) => c.id === selectedId) || filteredConversations[0] || null;

  // Mark active conversation read automatically when opened or new messages arrive
  useEffect(() => {
    if (!isAuthenticated || !activeConv) return;
    if ((activeConv.unreadCount || 0) > 0) {
      const latestMsg = activeConv.messages[activeConv.messages.length - 1];
      markConversationRead(activeConv.id, latestMsg?.id);
    }
  }, [isAuthenticated, activeConv?.id, activeConv?.messages.length, activeConv?.unreadCount, markConversationRead]);

  // Scroll to bottom when switching conversations or receiving messages
  useEffect(() => {
    if (activeConv) {
      threadEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [activeConv?.id, activeConv?.messages.length]);

  // Clear typing timer on unmount or thread switch
  useEffect(() => {
    return () => {
      if (typingStopTimerRef.current !== null) {
        window.clearTimeout(typingStopTimerRef.current);
      }
      if (lastTypingSentConvRef.current) {
        sendTypingIndicator(lastTypingSentConvRef.current, false);
        lastTypingSentConvRef.current = null;
      }
    };
  }, [activeConv?.id, sendTypingIndicator]);

  const myLatestSentMessageId = useMemo(() => {
    if (!activeConv) return null;
    for (let i = activeConv.messages.length - 1; i >= 0; i--) {
      const m = activeConv.messages[i];
      if (m.senderUserId === currentUser.id && !m.deletedAt) return m.id;
    }
    return null;
  }, [activeConv, currentUser.id]);

  if (!isAuthenticated) {
    return (
      <div className="bg-white dark:bg-[#13213e] rounded-2xl border border-slate-200 dark:border-[#1e335a] p-10 text-center space-y-4">
        <MessageSquare className="w-10 h-10 text-[#E45424] mx-auto" />
        <h1 className="font-display text-2xl font-bold text-[#16274e] dark:text-white">
          Gerçek Zamanlı Mesaj Merkezi
        </h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Sanatçılar, topluluklar, mekânlar ve proje ekiplerinizle anlık mesajlaşmak için giriş yapın.
        </p>
        <button
          type="button"
          onClick={() => setAuthModalMode('login')}
          className="px-6 py-2.5 rounded-xl bg-[#E45424] text-white text-xs font-bold cursor-pointer"
        >
          Giriş Yap
        </button>
      </div>
    );
  }

  const isStaff = ['admin', 'moderator'].includes(currentUser.activeRole);
  const isGroupConv =
    Boolean(activeConv) &&
    (activeConv!.conversationType === 'group' || activeConv!.participantUserIds.length > 2);

  const otherParticipants = (activeConv?.participants || []).filter(
    (p) => p.userId !== currentUser.id
  );
  const primaryPeer = !isGroupConv ? otherParticipants[0] : undefined;

  const isBlockedThread = Boolean(
    activeConv?.participantUserIds.some(
      (id) => id !== currentUser.id && socialGraph.blockedUserIds.includes(id)
    )
  );

  const isPendingRequest = activeConv?.status === 'pending_request';
  const isPendingRecipient =
    isPendingRequest && activeConv?.createdByUserId !== currentUser.id;

  const activeTypingUsers = activeConv ? typingByConversation[activeConv.id] || [] : [];

  const handleDraftChange = (val: string) => {
    setMessageDraft(val);
    if (!activeConv) return;
    if (val.trim().length > 0) {
      sendTypingIndicator(activeConv.id, true);
      lastTypingSentConvRef.current = activeConv.id;
      if (typingStopTimerRef.current !== null) {
        window.clearTimeout(typingStopTimerRef.current);
      }
      typingStopTimerRef.current = window.setTimeout(() => {
        if (activeConv) sendTypingIndicator(activeConv.id, false);
        lastTypingSentConvRef.current = null;
      }, 2200);
    } else if (lastTypingSentConvRef.current) {
      sendTypingIndicator(activeConv.id, false);
      lastTypingSentConvRef.current = null;
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setErrorMsg(null);
    setIsUploading(true);
    try {
      const asset = await uploadMediaFile(file, 'messages');
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

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeConv || isSending) return;
    const text = messageDraft.trim();
    if (!text && !pendingAttachment) return;
    if (isBlockedThread) {
      setErrorMsg('Engelleme durumu nedeniyle bu görüşmeye mesaj gönderilemez.');
      return;
    }
    setErrorMsg(null);
    setIsSending(true);
    if (lastTypingSentConvRef.current) {
      sendTypingIndicator(activeConv.id, false);
      lastTypingSentConvRef.current = null;
    }
    const res = await sendMessage(activeConv.id, text, {
      attachmentUrl: pendingAttachment?.url,
      attachmentName: pendingAttachment?.name,
      attachmentType: pendingAttachment?.type,
      replyToMessageId: replyTo?.id,
    });
    setIsSending(false);
    if (res.success) {
      setMessageDraft('');
      setPendingAttachment(null);
      setReplyTo(null);
    } else {
      setErrorMsg(res.error || 'Mesaj gönderilemedi.');
    }
  };

  const handleSaveEdit = async (messageId: string) => {
    if (!activeConv || !editingDraft.trim()) return;
    setErrorMsg(null);
    const res = await editMessage(activeConv.id, messageId, editingDraft.trim());
    if (res.success) {
      setEditingMsgId(null);
      setEditingDraft('');
    } else {
      setErrorMsg(res.error || 'Mesaj güncellenemedi.');
    }
  };

  const handleCreateThread = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (selectedContactIds.length === 0) {
      setErrorMsg('Lütfen en az bir kişi seçin.');
      return;
    }
    if (newMode === 'group' && selectedContactIds.length < 2) {
      setErrorMsg('Grup sohbeti oluşturmak için en az 2 kişi seçmelisiniz.');
      return;
    }

    const firstContact = activeContacts.find((c) => c.userId === selectedContactIds[0]);
    const resolvedTitle =
      newTitle.trim() ||
      (newMode === 'direct' && firstContact
        ? firstContact.name
        : `Grup Sohbeti (${selectedContactIds.length + 1} Kişi)`);

    const res = await startConversation({
      contextType: newMode === 'group' ? 'group' : 'direct',
      contextId: newMode === 'group' ? `grp_${Date.now()}` : selectedContactIds[0],
      conversationType: newMode,
      title: resolvedTitle,
      participantUserIds: selectedContactIds,
      initialMessage: newBody.trim() || undefined,
    });

    if (res.success) {
      if (res.conversation?.id) {
        setSelectedId(res.conversation.id);
        setMobileShowThread(true);
      }
      setShowNewThread(false);
      setSelectedContactIds([]);
      setNewTitle('');
      setNewBody('');
      setContactSearch('');
    } else {
      setErrorMsg(res.error || 'Görüşme başlatılamadı.');
    }
  };

  const toggleContactSelection = (userId: string) => {
    if (newMode === 'direct') {
      setSelectedContactIds([userId]);
      return;
    }
    setSelectedContactIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  };

  const handleAddGroupMember = async () => {
    if (!activeConv || !memberToAdd) return;
    setErrorMsg(null);
    const res = await addConversationMember(activeConv.id, memberToAdd);
    if (res.success) {
      setMemberToAdd('');
    } else {
      setErrorMsg(res.error || 'Üye eklenemedi.');
    }
  };

  const getReadersForMessage = (msg: ConversationMessage) => {
    if (!activeConv?.readBy) return [];
    const readers: string[] = [];
    for (const [uid, info] of Object.entries(activeConv.readBy)) {
      if (uid === currentUser.id) continue;
      if (info.lastReadAt && info.lastReadAt >= msg.createdAt) {
        const p = activeConv.participants?.find((x) => x.userId === uid);
        readers.push(p?.name || 'Katılımcı');
      }
    }
    return readers;
  };

  return (
    <div className="max-w-[1140px] mx-auto px-3 sm:px-5 py-2 space-y-3 text-left overflow-x-hidden">
      {/* Top Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-2.5">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[10.5px] font-bold uppercase tracking-widest text-[#E45424]">
              Canlı İletişim Merkezi
            </span>
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold ${
                wsConnected
                  ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                  : 'bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800'
              }`}
            >
              {wsConnected ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
              <span>{wsConnected ? 'Canlı Bağlı' : 'Bağlanıyor'}</span>
            </span>
          </div>
          <h1 className="font-display text-lg sm:text-xl font-extrabold text-[#16274e] dark:text-white mt-0.5">
            Mesaj Merkezi
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => navigateTo('profile_edit')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0B1120] text-slate-700 dark:text-slate-200 hover:border-[#E45424] text-[11px] font-bold cursor-pointer"
          >
            <Ban className="w-3.5 h-3.5 text-rose-500" />
            <span>Engellenenleri Yönet</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setShowNewThread((p) => !p);
              setErrorMsg(null);
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#E45424] hover:bg-[#c84317] text-white text-[11px] font-bold cursor-pointer shadow-xs"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Yeni Sohbet / Grup</span>
          </button>
        </div>
      </div>

      {errorMsg && (
        <div
          role="alert"
          className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs flex items-center justify-between"
        >
          <span>{errorMsg}</span>
          <button type="button" onClick={() => setErrorMsg(null)} className="p-1 cursor-pointer">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* New Thread / Group Composer */}
      {showNewThread && (
        <form
          onSubmit={handleCreateThread}
          className="bg-white dark:bg-[#13213e] rounded-2xl border border-slate-200 dark:border-[#1e335a] p-5 space-y-4 shadow-sm"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setNewMode('direct');
                  setSelectedContactIds((prev) => prev.slice(0, 1));
                }}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-colors ${
                  newMode === 'direct'
                    ? 'bg-[#16274e] text-white'
                    : 'bg-slate-100 dark:bg-[#0B1120] text-slate-600 dark:text-slate-300'
                }`}
              >
                Birebir Mesaj
              </button>
              <button
                type="button"
                onClick={() => setNewMode('group')}
                className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-colors ${
                  newMode === 'group'
                    ? 'bg-[#16274e] text-white'
                    : 'bg-slate-100 dark:bg-[#0B1120] text-slate-600 dark:text-slate-300'
                }`}
              >
                <Users className="w-3.5 h-3.5" />
                <span>Grup Sohbeti</span>
              </button>
            </div>
            <button
              type="button"
              onClick={() => setShowNewThread(false)}
              className="text-xs text-slate-500 hover:text-slate-800 dark:hover:text-white cursor-pointer"
            >
              Kapat
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label htmlFor="contact-picker-search" className="block text-[11px] font-bold text-slate-700 dark:text-slate-200">
                {newMode === 'direct' ? 'Kişi Seçin' : 'Grup Üyeleri Seçin (En az 2 kişi)'}
              </label>
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  id="contact-picker-search"
                  value={contactSearch}
                  onChange={(e) => setContactSearch(e.target.value)}
                  placeholder="Sanatçı, topluluk veya kurum ara..."
                  className="w-full pl-8 pr-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120] text-xs"
                />
              </div>

              {selectedContactIds.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {selectedContactIds.map((uid) => {
                    const c = activeContacts.find((x) => x.userId === uid);
                    return (
                      <span
                        key={uid}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-orange-50 dark:bg-orange-500/15 border border-orange-200 dark:border-orange-500/30 text-[11px] font-bold text-[#c2451a] dark:text-orange-200"
                      >
                        <span>{c?.name || uid}</span>
                        <button
                          type="button"
                          onClick={() => toggleContactSelection(uid)}
                          className="cursor-pointer hover:text-rose-600"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    );
                  })}
                </div>
              )}

              <div className="max-h-44 overflow-y-auto border border-slate-200 dark:border-slate-700 rounded-xl divide-y divide-slate-100 dark:divide-slate-800">
                {activeContacts.length === 0 ? (
                  <div className="p-3 text-xs text-slate-500 text-center">Eşleşen kişi bulunamadı.</div>
                ) : (
                  activeContacts.map((c) => {
                    const isSelected = selectedContactIds.includes(c.userId);
                    const online = c.isOnline || onlineUserIds.includes(c.userId);
                    return (
                      <button
                        type="button"
                        key={c.userId}
                        onClick={() => toggleContactSelection(c.userId)}
                        className={`w-full flex items-center justify-between gap-2.5 p-2.5 text-left transition-colors cursor-pointer ${
                          isSelected
                            ? 'bg-orange-50/80 dark:bg-orange-500/15'
                            : 'hover:bg-slate-50 dark:hover:bg-[#0B1120]'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="relative shrink-0">
                            <img
                              src={c.avatarUrl}
                              alt={c.name}
                              className="w-8 h-8 rounded-lg object-cover border border-slate-200 dark:border-slate-700"
                            />
                            {online && (
                              <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-white dark:border-[#13213e]" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="text-xs font-bold text-slate-900 dark:text-white truncate">
                              {c.name}
                            </div>
                            <div className="text-[10px] text-slate-500 truncate">
                              {c.subtitle || c.role}
                            </div>
                          </div>
                        </div>
                        <span
                          className={`w-5 h-5 rounded-md flex items-center justify-center border text-[10px] font-bold shrink-0 ${
                            isSelected
                              ? 'bg-[#E45424] border-[#E45424] text-white'
                              : 'border-slate-300 dark:border-slate-600'
                          }`}
                        >
                          {isSelected && <Check className="w-3 h-3" />}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <label htmlFor="msg-subject" className="block text-[11px] font-bold mb-1">
                  {newMode === 'group' ? 'Grup Adı / Konu' : 'Görüşme Başlığı (İsteğe Bağlı)'}
                </label>
                <input
                  id="msg-subject"
                  required={newMode === 'group'}
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder={
                    newMode === 'group'
                      ? 'Örn: Boğaziçi Gala Provası Grubu'
                      : 'Örn: Sahne & Repertuvar Görüşmesi'
                  }
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120] text-xs"
                />
              </div>
              <div>
                <label htmlFor="msg-initial" className="block text-[11px] font-bold mb-1">
                  İlk Mesaj
                </label>
                <textarea
                  id="msg-initial"
                  rows={4}
                  value={newBody}
                  onChange={(e) => setNewBody(e.target.value)}
                  placeholder="Merhaba, sahne programınız hakkında görüşmek istiyorum..."
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120] text-xs"
                />
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setShowNewThread(false)}
                  className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold cursor-pointer"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-[#16274e] hover:bg-[#1e3568] text-white text-xs font-bold cursor-pointer"
                >
                  {newMode === 'group' ? 'Grubu Oluştur' : 'Görüşmeyi Başlat'}
                </button>
              </div>
            </div>
          </div>
        </form>
      )}

      {/* Main Two-Pane Messaging Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5 lg:h-[560px] min-w-0">
        {/* Left Inbox Sidebar */}
        <div
          className={`lg:col-span-4 min-w-0 bg-white dark:bg-[#13213e] rounded-2xl border border-slate-200 dark:border-[#1e335a] p-2.5 flex flex-col gap-2 min-h-[380px] lg:h-full overflow-hidden ${
            mobileShowThread ? 'hidden lg:flex' : 'flex'
          }`}
        >
          {/* Search Input */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              aria-label="Görüşmelerde ara"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Görüşme veya mesajlarda ara..."
              className="w-full pl-8 pr-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1120] text-xs"
            />
          </div>

          {/* Filter Tabs */}
          <div className="flex flex-wrap items-center gap-1 bg-slate-100 dark:bg-[#0B1120] p-1 rounded-xl">
            {(
              [
                { id: 'all', label: 'Tümü', count: conversations.length },
                { id: 'unread', label: 'Okunmamış', count: unreadMessagesCount },
                { id: 'groups', label: 'Gruplar', count: groupChatsCount },
                { id: 'requests', label: 'İstekler', count: pendingRequestsCount },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`flex-1 py-1 px-1.5 rounded-lg text-[10px] font-bold transition-colors flex items-center justify-center gap-1 whitespace-nowrap cursor-pointer ${
                  activeTab === tab.id
                    ? 'bg-white dark:bg-[#13213e] text-[#16274e] dark:text-white shadow-xs'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white'
                }`}
              >
                <span>{tab.label}</span>
                {tab.count > 0 && tab.id !== 'all' && (
                  <span
                    className={`min-w-[14px] h-[14px] px-1 rounded-full text-[9px] flex items-center justify-center tabular-nums ${
                      tab.id === 'unread' || tab.id === 'requests'
                        ? 'bg-[#E45424] text-white'
                        : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200'
                    }`}
                  >
                    {tab.count}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Conversation List */}
          <div className="flex-1 overflow-y-auto overflow-x-hidden space-y-1.5 pr-0.5 min-w-0">
            {filteredConversations.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500">
                Bu görünümde henüz konuşma yok.
              </div>
            ) : (
              filteredConversations.map((conv) => {
                const isGroup =
                  conv.conversationType === 'group' || conv.participantUserIds.length > 2;
                const peer = (conv.participants || []).find((p) => p.userId !== currentUser.id);
                const peerOnline = peer
                  ? Boolean(peer.isOnline || onlineUserIds.includes(peer.userId))
                  : false;
                const lastMsg = conv.messages[conv.messages.length - 1];
                const isSelected = activeConv?.id === conv.id;
                const typingHere = typingByConversation[conv.id] || [];

                return (
                  <button
                    key={conv.id}
                    type="button"
                    onClick={() => {
                      setSelectedId(conv.id);
                      setMobileShowThread(true);
                      setShowMembersDrawer(false);
                    }}
                    className={`w-full min-w-0 text-left p-2 rounded-xl border transition-colors cursor-pointer flex items-start gap-2 ${
                      isSelected
                        ? 'bg-orange-50/90 dark:bg-orange-500/10 border-[#E45424]'
                        : 'bg-slate-50/70 dark:bg-[#0B1120] border-slate-200/80 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                    }`}
                  >
                    {/* Avatar / Group badge */}
                    <div className="relative shrink-0 mt-0.5">
                      {isGroup ? (
                        <div className="w-9 h-9 rounded-xl bg-[#16274e] text-white flex items-center justify-center">
                          <Users className="w-4 h-4" />
                        </div>
                      ) : (
                        <img
                          src={
                            peer?.avatarUrl ||
                            '/src/assets/images/artist_jazz_pianist_1794440057025.jpg'
                          }
                          alt={peer?.name || conv.title}
                          className="w-9 h-9 rounded-xl object-cover border border-slate-200 dark:border-slate-700"
                        />
                      )}
                      {!isGroup && peerOnline && (
                        <span
                          title="Çevrimiçi"
                          className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-white dark:border-[#13213e]"
                        />
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-xs font-bold text-slate-900 dark:text-white truncate">
                          {conv.title}
                        </span>
                        <span className="text-[10px] text-slate-400 shrink-0 tabular-nums">
                          {formatShortTime(conv.lastMessageAt)}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="text-[10px] font-bold uppercase text-[#E45424]">
                          {conv.status === 'pending_request'
                            ? 'İstek'
                            : isGroup
                            ? `Grup (${conv.participantUserIds.length})`
                            : conv.contextType === 'direct'
                            ? 'Birebir'
                            : conv.contextType}
                        </span>
                      </div>

                      <div className="flex items-center justify-between gap-2 mt-1">
                        <span className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                          {typingHere.length > 0 ? (
                            <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                              {typingHere[0].userName} yazıyor...
                            </span>
                          ) : lastMsg ? (
                            lastMsg.deletedAt ? (
                              <span className="italic">Bu mesaj silindi.</span>
                            ) : (
                              `${lastMsg.senderUserId === currentUser.id ? 'Sen: ' : ''}${
                                lastMsg.body ||
                                (lastMsg.attachmentName ? `📎 ${lastMsg.attachmentName}` : '')
                              }`
                            )
                          ) : (
                            'Mesaj yok'
                          )}
                        </span>
                        {(conv.unreadCount || 0) > 0 && (
                          <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-[#E45424] text-white text-[10px] font-bold flex items-center justify-center shrink-0 tabular-nums">
                            {conv.unreadCount}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Right Active Thread Panel */}
        <div
          className={`lg:col-span-8 min-w-0 bg-white dark:bg-[#13213e] rounded-2xl border border-slate-200 dark:border-[#1e335a] flex flex-col justify-between overflow-hidden min-h-[440px] lg:h-full ${
            mobileShowThread ? 'flex' : 'hidden lg:flex'
          }`}
        >
          {!activeConv ? (
            <div className="m-auto p-6 text-center space-y-2">
              <MessageSquare className="w-8 h-8 text-slate-300 dark:text-slate-600 mx-auto" />
              <div className="text-xs font-semibold text-slate-500">
                Görüntülemek için soldan bir görüşme seçin veya yeni görüşme başlatın.
              </div>
            </div>
          ) : (
            <>
              {/* Thread Header */}
              <div className="px-4 py-2.5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2.5 bg-slate-50/50 dark:bg-[#0f1c38]/60 min-w-0">
                <div className="flex items-center gap-2.5 min-w-0">
                  <button
                    type="button"
                    onClick={() => setMobileShowThread(false)}
                    className="lg:hidden p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 cursor-pointer"
                    aria-label="Görüşme listesine dön"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>

                  {isGroupConv ? (
                    <div className="w-8 h-8 rounded-xl bg-[#16274e] text-white flex items-center justify-center shrink-0">
                      <Users className="w-4 h-4" />
                    </div>
                  ) : (
                    <div className="relative shrink-0">
                      <img
                        src={
                          primaryPeer?.avatarUrl ||
                          '/src/assets/images/artist_jazz_pianist_1794440057025.jpg'
                        }
                        alt={primaryPeer?.name || activeConv.title}
                        className="w-8 h-8 rounded-xl object-cover border border-slate-200 dark:border-slate-700"
                      />
                      {primaryPeer &&
                        (primaryPeer.isOnline || onlineUserIds.includes(primaryPeer.userId)) && (
                          <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-white dark:border-[#13213e]" />
                        )}
                    </div>
                  )}

                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <h2 className="font-bold text-sm text-slate-900 dark:text-white truncate">
                        {activeConv.title}
                      </h2>
                      <span className="text-[9.5px] font-bold uppercase px-1.5 py-0.5 rounded bg-orange-50 dark:bg-orange-500/15 text-[#E45424] shrink-0">
                        {isGroupConv ? 'Grup' : activeConv.contextType}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                      {isGroupConv ? (
                        <span>
                          {activeConv.participantUserIds.length} katılımcı ·{' '}
                          {
                            (activeConv.participants || []).filter(
                              (p) => p.isOnline || onlineUserIds.includes(p.userId)
                            ).length
                          }{' '}
                          çevrimiçi
                        </span>
                      ) : primaryPeer ? (
                        <span className="inline-flex items-center gap-1.5">
                          <span>{primaryPeer.name}</span>
                          <span>·</span>
                          <span
                            className={
                              primaryPeer.isOnline || onlineUserIds.includes(primaryPeer.userId)
                                ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                                : ''
                            }
                          >
                            {primaryPeer.isOnline || onlineUserIds.includes(primaryPeer.userId)
                              ? 'Çevrimiçi'
                              : 'Çevrimdışı'}
                          </span>
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {!isGroupConv && primaryPeer?.profileView && primaryPeer?.profileEntityId && (
                    <button
                      type="button"
                      onClick={() =>
                        navigateTo(primaryPeer.profileView as AppView, primaryPeer.profileEntityId)
                      }
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-[11px] font-bold text-slate-700 dark:text-slate-200 hover:border-[#E45424] cursor-pointer"
                    >
                      <span>Profile Git</span>
                      <ExternalLink className="w-3 h-3" />
                    </button>
                  )}

                  {isGroupConv && (
                    <button
                      type="button"
                      onClick={() => setShowMembersDrawer((p) => !p)}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[11px] font-bold cursor-pointer ${
                        showMembersDrawer
                          ? 'bg-[#16274e] text-white border-[#16274e]'
                          : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200'
                      }`}
                    >
                      <Users className="w-3.5 h-3.5" />
                      <span>Üyeler ({activeConv.participantUserIds.length})</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Group Members Drawer */}
              {isGroupConv && showMembersDrawer && (
                <div className="px-5 py-3 bg-slate-50 dark:bg-[#0B1120] border-b border-slate-200 dark:border-slate-800 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-bold text-slate-800 dark:text-white">
                      Grup Katılımcıları
                    </span>
                    <button
                      type="button"
                      onClick={() => removeConversationMember(activeConv.id, currentUser.id)}
                      className="inline-flex items-center gap-1 text-[11px] font-bold text-rose-600 hover:underline cursor-pointer"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      <span>Gruptan Ayrıl</span>
                    </button>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {(activeConv.participants || []).map((p) => {
                      const canRemove =
                        p.userId !== currentUser.id &&
                        (activeConv.createdByUserId === currentUser.id || isStaff);
                      return (
                        <div
                          key={p.userId}
                          className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-white dark:bg-[#13213e] border border-slate-200 dark:border-slate-700 text-xs"
                        >
                          <img
                            src={p.avatarUrl}
                            alt={p.name}
                            className="w-5 h-5 rounded-md object-cover"
                          />
                          <span className="font-semibold text-slate-800 dark:text-slate-100">
                            {p.name}
                          </span>
                          {canRemove && (
                            <button
                              type="button"
                              onClick={() => removeConversationMember(activeConv.id, p.userId)}
                              className="text-slate-400 hover:text-rose-600 cursor-pointer"
                              title="Üyeyi çıkar"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex items-center gap-2">
                    <select
                      aria-label="Gruba üye ekle"
                      value={memberToAdd}
                      onChange={(e) => setMemberToAdd(e.target.value)}
                      className="flex-1 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#13213e] text-xs"
                    >
                      <option value="">Gruba eklenecek kişi seçin...</option>
                      {activeContacts
                        .filter((c) => !activeConv.participantUserIds.includes(c.userId))
                        .map((c) => (
                          <option key={c.userId} value={c.userId}>
                            {c.name} ({c.subtitle || c.role})
                          </option>
                        ))}
                    </select>
                    <button
                      type="button"
                      disabled={!memberToAdd}
                      onClick={handleAddGroupMember}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#E45424] disabled:opacity-50 text-white text-xs font-bold cursor-pointer"
                    >
                      <UserPlus className="w-3.5 h-3.5" />
                      <span>Ekle</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Pending Message Request Banner */}
              {isPendingRequest && (
                <div className="px-5 py-3 bg-amber-50/90 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-800 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-xs text-amber-900 dark:text-amber-200">
                    <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0" />
                    <span>
                      {isPendingRecipient
                        ? 'Bu kişiyle daha önce bağlantınız bulunmuyor. Mesaj isteğini kabul etmek istiyor musunuz?'
                        : 'Mesaj isteğiniz karşı tarafın onayını bekliyor.'}
                    </span>
                  </div>
                  {isPendingRecipient && (
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => respondConversationRequest(activeConv.id, 'accept')}
                        className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer"
                      >
                        Kabul Et
                      </button>
                      <button
                        type="button"
                        onClick={() => respondConversationRequest(activeConv.id, 'decline')}
                        className="px-3 py-1.5 rounded-lg bg-white dark:bg-[#0B1120] border border-slate-300 dark:border-slate-700 text-xs font-bold cursor-pointer"
                      >
                        Reddet
                      </button>
                      <button
                        type="button"
                        onClick={() => respondConversationRequest(activeConv.id, 'block')}
                        className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold cursor-pointer"
                      >
                        Engelle
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Message Feed */}
              <div className="flex-1 overflow-y-auto overflow-x-hidden p-3.5 space-y-2 min-w-0">
                {activeConv.messages.length === 0 ? (
                  <div className="py-10 text-center text-xs text-slate-500">
                    İlk mesajı göndererek sohbeti başlatın.
                  </div>
                ) : (
                  activeConv.messages.map((m) => {
                    const isMine = m.senderUserId === currentUser.id;
                    const isDeleted = Boolean(m.deletedAt);
                    const reactionEntries = Object.entries(m.reactions || {}).filter(
                      ([, uids]) => Array.isArray(uids) && uids.length > 0
                    );
                    const isMyLatest = m.id === myLatestSentMessageId;
                    const readers = isMyLatest ? getReadersForMessage(m) : [];
                    const isImageAtt =
                      Boolean(m.attachmentUrl) &&
                      (m.attachmentType?.startsWith('image/') ||
                        /\.(png|jpe?g|webp|gif)(\?|$)/i.test(m.attachmentUrl || ''));
                    const isAudioAtt =
                      Boolean(m.attachmentUrl) &&
                      (m.attachmentType?.startsWith('audio/') ||
                        /\.(mp3|wav|ogg|m4a)(\?|$)/i.test(m.attachmentUrl || ''));

                    return (
                      <div
                        key={m.id}
                        className={`group flex flex-col min-w-0 w-full ${isMine ? 'items-end' : 'items-start'}`}
                      >
                        <div className="flex items-end gap-1.5 max-w-[82%] sm:max-w-[70%] min-w-0">
                          {!isMine && (
                            <img
                              src={
                                m.senderAvatar ||
                                '/src/assets/images/artist_jazz_pianist_1794440057025.jpg'
                              }
                              alt={m.senderName}
                              className="w-6 h-6 rounded-lg object-cover border border-slate-200 dark:border-slate-700 shrink-0 mb-0.5"
                            />
                          )}

                          <div
                            className={`min-w-0 max-w-full overflow-hidden rounded-2xl px-3 py-2 text-[12px] space-y-1 ${
                              isDeleted
                                ? 'bg-slate-100 dark:bg-slate-900/60 text-slate-400 italic border border-slate-200/70 dark:border-slate-800'
                                : isMine
                                ? 'bg-[#16274e] text-white'
                                : 'bg-slate-100 dark:bg-[#0B1120] text-slate-800 dark:text-slate-100 border border-slate-200/60 dark:border-slate-800'
                            }`}
                          >
                            {!isMine && (
                              <div className="text-[10px] font-bold opacity-75 truncate">{m.senderName}</div>
                            )}

                            {m.replyToSnippet && !isDeleted && (
                              <div
                                className={`min-w-0 max-w-full px-2 py-1 rounded-lg border-l-2 text-[10.5px] ${
                                  isMine
                                    ? 'bg-white/10 border-[#f25922] text-slate-100'
                                    : 'bg-white dark:bg-[#13213e] border-[#E45424] text-slate-600 dark:text-slate-300'
                                }`}
                              >
                                <div className="font-bold text-[9.5px] truncate">
                                  {m.replyToSnippet.senderName}
                                </div>
                                <div className="truncate opacity-90">{m.replyToSnippet.body}</div>
                              </div>
                            )}

                            {/* Inline Edit Input or Message Body */}
                            {editingMsgId === m.id ? (
                              <div className="space-y-1.5 min-w-[200px] max-w-full">
                                <input
                                  aria-label="Mesajı düzenle"
                                  value={editingDraft}
                                  onChange={(e) => setEditingDraft(e.target.value)}
                                  className="w-full px-2.5 py-1 rounded-lg bg-white text-slate-900 text-xs"
                                />
                                <div className="flex justify-end gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => setEditingMsgId(null)}
                                    className="px-2 py-0.5 rounded bg-white/15 text-[10px] font-bold cursor-pointer"
                                  >
                                    İptal
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleSaveEdit(m.id)}
                                    className="px-2 py-0.5 rounded bg-[#E45424] text-white text-[10px] font-bold cursor-pointer"
                                  >
                                    Kaydet
                                  </button>
                                </div>
                              </div>
                            ) : (
                              m.body && (
                                <p className="leading-snug whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                                  {m.body}
                                </p>
                              )
                            )}

                            {/* Attachment Preview */}
                            {m.attachmentUrl && !isDeleted && (
                              <div className="pt-0.5">
                                {isImageAtt ? (
                                  <a
                                    href={m.attachmentUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="block rounded-xl overflow-hidden border border-white/15"
                                  >
                                    <img
                                      src={m.attachmentUrl}
                                      alt={m.attachmentName || 'Ek görsel'}
                                      className="max-h-44 w-auto object-cover"
                                    />
                                  </a>
                                ) : isAudioAtt ? (
                                  <audio controls src={m.attachmentUrl} className="max-w-full h-8" />
                                ) : (
                                  <a
                                    href={m.attachmentUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[11px] font-semibold max-w-full ${
                                      isMine
                                        ? 'bg-white/10 hover:bg-white/15 text-white'
                                        : 'bg-white dark:bg-[#13213e] border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100'
                                    }`}
                                  >
                                    <FileText className="w-3.5 h-3.5 text-[#f25922] shrink-0" />
                                    <span className="truncate max-w-[160px]">
                                      {m.attachmentName || 'Ek Dosya'}
                                    </span>
                                  </a>
                                )}
                              </div>
                            )}

                            {/* Timestamp & Edited tag */}
                            <div
                              className={`flex items-center justify-end gap-1.5 text-[9.5px] opacity-70 ${
                                isMine ? 'text-slate-200' : 'text-slate-400'
                              }`}
                            >
                              {m.editedAt && !isDeleted && <span>(düzenlendi)</span>}
                              <span className="tabular-nums">{formatShortTime(m.createdAt)}</span>
                            </div>
                          </div>
                        </div>

                        {/* Emoji Reactions Display */}
                        {reactionEntries.length > 0 && !isDeleted && (
                          <div className={`flex flex-wrap gap-1 mt-1 ${isMine ? 'justify-end' : 'pl-7.5'}`}>
                            {reactionEntries.map(([emoji, uids]) => {
                              const iReacted = uids.includes(currentUser.id);
                              return (
                                <button
                                  key={emoji}
                                  type="button"
                                  onClick={() => toggleMessageReaction(activeConv.id, m.id, emoji)}
                                  className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10.5px] border cursor-pointer transition-colors ${
                                    iReacted
                                      ? 'bg-orange-50 dark:bg-orange-500/20 border-[#E45424] text-[#c2451a] dark:text-orange-200 font-bold'
                                      : 'bg-white dark:bg-[#0B1120] border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                                  }`}
                                >
                                  <span>{emoji}</span>
                                  <span className="tabular-nums text-[9.5px]">{uids.length}</span>
                                </button>
                              );
                            })}
                          </div>
                        )}

                        {/* Hover Message Actions */}
                        {!isDeleted && editingMsgId !== m.id && (
                          <div
                            className={`flex items-center gap-0.5 mt-0.5 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity ${
                              isMine ? 'justify-end' : 'pl-7.5'
                            }`}
                          >
                            <button
                              type="button"
                              onClick={() => setReplyTo(m)}
                              className="p-1 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                              title="Yanıtla"
                              aria-label="Yanıtla"
                            >
                              <Reply className="w-3.5 h-3.5" />
                            </button>

                            <div className="relative">
                              <button
                                type="button"
                                onClick={() =>
                                  setReactionPickerMsgId((prev) => (prev === m.id ? null : m.id))
                                }
                                className="p-1 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                                title="Tepki Ver"
                                aria-label="Tepki Ver"
                              >
                                <Smile className="w-3.5 h-3.5" />
                              </button>
                              {reactionPickerMsgId === m.id && (
                                <div className="absolute bottom-full mb-1 right-0 flex items-center gap-1 bg-white dark:bg-[#0B1120] border border-slate-200 dark:border-slate-700 rounded-xl px-2 py-1 shadow-lg z-20">
                                  {REACTION_EMOJIS.map((emoji) => (
                                    <button
                                      key={emoji}
                                      type="button"
                                      onClick={() => {
                                        toggleMessageReaction(activeConv.id, m.id, emoji);
                                        setReactionPickerMsgId(null);
                                      }}
                                      className="p-1 hover:scale-125 transition-transform cursor-pointer text-sm"
                                    >
                                      {emoji}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>

                            {isMine && (
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingMsgId(m.id);
                                  setEditingDraft(m.body);
                                }}
                                className="p-1 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                                title="Düzenle"
                                aria-label="Düzenle"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                            )}

                            {(isMine || isStaff) && (
                              <button
                                type="button"
                                onClick={() => deleteMessage(activeConv.id, m.id)}
                                className="p-1 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 cursor-pointer"
                                title="Sil"
                                aria-label="Sil"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        )}

                        {/* Read Receipt for my latest message */}
                        {isMyLatest && !isDeleted && (
                          <div className="flex items-center gap-1 text-[10px] text-slate-400 mt-0.5">
                            {readers.length > 0 ? (
                              <>
                                <CheckCheck className="w-3.5 h-3.5 text-emerald-500" />
                                <span>Okundu ({readers.join(', ')})</span>
                              </>
                            ) : (
                              <>
                                <Check className="w-3 h-3" />
                                <span>İletildi</span>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
                <div ref={threadEndRef} />
              </div>

              {/* Typing Indicator */}
              {activeTypingUsers.length > 0 && (
                <div className="px-5 py-1.5 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 bg-slate-50/50 dark:bg-[#0B1120]/40 border-t border-slate-100 dark:border-slate-800">
                  {activeTypingUsers.map((u) => u.userName).join(', ')} yazıyor...
                </div>
              )}

              {/* Bottom Composer Area */}
              {isBlockedThread ? (
                <div className="p-3 border-t border-slate-100 dark:border-slate-800">
                  <div className="p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 text-xs text-rose-700 dark:text-rose-300">
                    Karşılıklı engelleme nedeniyle bu görüşmeye yeni mesaj gönderilemez.
                  </div>
                </div>
              ) : (
                <div className="p-3 border-t border-slate-100 dark:border-slate-800 space-y-2 bg-slate-50/40 dark:bg-[#0f1c38]/40 min-w-0">
                  {/* Reply Preview */}
                  {replyTo && (
                    <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-xl bg-white dark:bg-[#0B1120] border-l-4 border-[#E45424] text-xs min-w-0">
                      <div className="min-w-0">
                        <div className="text-[10px] font-bold text-[#E45424]">
                          Yanıtlanıyor: {replyTo.senderName}
                        </div>
                        <div className="text-[11px] text-slate-600 dark:text-slate-300 truncate">
                          {replyTo.body || replyTo.attachmentName || 'Ek dosya'}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setReplyTo(null)}
                        className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer shrink-0"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}

                  {/* Pending Attachment Preview */}
                  {pendingAttachment && (
                    <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-xl bg-white dark:bg-[#0B1120] border border-slate-200 dark:border-slate-700 text-xs min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <Paperclip className="w-3.5 h-3.5 text-[#E45424] shrink-0" />
                        <span className="truncate font-semibold">{pendingAttachment.name}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setPendingAttachment(null)}
                        className="p-1 text-slate-400 hover:text-rose-600 cursor-pointer shrink-0"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}

                  <form onSubmit={handleSend} className="flex items-center gap-1.5 min-w-0">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*,audio/*,.pdf"
                      onChange={handleFileChange}
                      className="hidden"
                    />
                    <button
                      type="button"
                      disabled={isUploading}
                      onClick={() => fileInputRef.current?.click()}
                      className="p-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0B1120] text-slate-600 dark:text-slate-300 hover:border-[#E45424] cursor-pointer disabled:opacity-50 shrink-0"
                      title="Görsel, ses veya PDF ekle"
                      aria-label="Dosya ekle"
                    >
                      <Paperclip className="w-4 h-4" />
                    </button>

                    <input
                      aria-label="Mesajınız"
                      value={messageDraft}
                      onChange={(e) => handleDraftChange(e.target.value)}
                      placeholder={
                        isUploading ? 'Dosya yükleniyor...' : 'Mesajınızı yazın...'
                      }
                      className="flex-1 min-w-0 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0B1120] text-xs"
                    />

                    <button
                      type="submit"
                      disabled={isSending || isUploading || (!messageDraft.trim() && !pendingAttachment)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#E45424] hover:bg-[#c94317] disabled:opacity-50 text-white text-xs font-bold cursor-pointer shrink-0"
                    >
                      <Send className="w-3.5 h-3.5" />
                      <span>Gönder</span>
                    </button>
                  </form>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
