import React, { useState, useEffect, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import { AuditLogEntry, Community, RoleType, User } from '../types';
import { formatCurrencyTRY } from '../utils/businessLogic';
import { apiRequest } from '../services/api';
import { VerifiedBadge } from './ui/VerifiedBadge';
import {
  BadgeCheck,
  CheckCircle2,
  FileText,
  RotateCcw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Users as UsersIcon,
  Mail,
} from 'lucide-react';

const STAFF_ROLES = ['admin', 'moderator', 'finance_admin', 'verification_officer', 'support'];

const ALL_ASSIGNABLE_ROLES: { role: RoleType; label: string }[] = [
  { role: 'artist', label: 'Sanatçı' },
  { role: 'ensemble_leader', label: 'Topluluk Lideri' },
  { role: 'business_owner', label: 'İşletme / Kurum' },
  { role: 'venue_manager', label: 'Mekân Yöneticisi' },
  { role: 'technical_provider', label: 'Teknik Sağlayıcı' },
  { role: 'organizer', label: 'Kültür Organizatörü' },
  { role: 'audience', label: 'İzleyici' },
  { role: 'moderator', label: 'Moderatör' },
  { role: 'verification_officer', label: 'Doğrulama Uzmanı' },
  { role: 'finance_admin', label: 'Finans Yöneticisi' },
  { role: 'support', label: 'Destek' },
  { role: 'admin', label: 'Yönetici (Admin)' },
];

interface ContactMessageRow {
  id: string;
  name: string;
  email: string;
  phone?: string;
  subject: string;
  message: string;
  created_at: string;
}

export const AdminPanel: React.FC = () => {
  const {
    currentUser,
    isAuthenticated,
    activeRole,
    settings,
    adminUpdateCommission,
    adminUpdateUserRoles,
    adminUpdateUserStatus,
    adminVerifyVenue,
    adminVerifyTechnicalProvider,
    adminVerifyEntity,
    verifications,
    adminApproveVerification,
    adminRejectVerification,
    moderateEntity,
    resolveDispute,
    toggleFeatureFlag,
    artists,
    ensembles,
    businesses,
    listings,
    events,
    opportunities,
    projects,
    venues,
    technicalProviders,
    bookings,
    disputes,
    ledger,
    featureFlags,
    resetAllData,
    setAuthModalMode,
  } = useApp();

  const [activeTab, setActiveTab] = useState<
    'kpis' | 'verifications' | 'moderation' | 'disputes' | 'ledger' | 'commission' | 'flags' | 'users' | 'messages' | 'audit'
  >('kpis');
  const [rejectReason, setRejectReason] = useState('');
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [commissionRate, setCommissionRate] = useState(settings.commissionRate);
  const [commissionModel, setCommissionModel] = useState(settings.commissionModel);
  const [savedSettingsNotice, setSavedSettingsNotice] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [contactMessages, setContactMessages] = useState<ContactMessageRow[]>([]);
  const [userRoleDrafts, setUserRoleDrafts] = useState<Record<string, RoleType[]>>({});
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [resolutionNote, setResolutionNote] = useState('');
  const [communities, setCommunities] = useState<Community[]>([]);
  const [badgeFilterType, setBadgeFilterType] = useState<'artist' | 'ensemble' | 'business' | 'community'>('artist');
  const [badgeQuery, setBadgeQuery] = useState('');
  const [badgeNote, setBadgeNote] = useState('');

  const isStaff = isAuthenticated && STAFF_ROLES.includes(activeRole);

  const refreshOverview = useCallback(async () => {
    if (!isStaff) return;
    try {
      const [res, commRes] = await Promise.all([
        apiRequest<{
          auditLogs?: AuditLogEntry[];
          users?: User[];
          contactMessages?: ContactMessageRow[];
        }>('/api/admin/overview'),
        apiRequest<{ communities?: Community[] }>('/api/communities').catch(() => ({ communities: [] })),
      ]);
      setAuditLogs(res.auditLogs || []);
      const loadedUsers = res.users || [];
      setUsers(loadedUsers);
      setContactMessages(res.contactMessages || []);
      setCommunities(commRes.communities || []);
      setUserRoleDrafts((prev) => {
        const next: Record<string, RoleType[]> = { ...prev };
        for (const u of loadedUsers) {
          if (!next[u.id]) next[u.id] = u.roles || [];
        }
        return next;
      });
    } catch {
      setAuditLogs([]);
    }
  }, [isStaff]);

  useEffect(() => {
    void refreshOverview();
  }, [refreshOverview, activeTab]);

  if (!isAuthenticated) {
    return (
      <div className="max-w-xl mx-auto my-12 p-8 bg-white dark:bg-[#13213e] rounded-3xl border border-[#e2e8f0] dark:border-[#1e335a] text-center space-y-4">
        <h2 className="font-display text-xl font-bold text-[#0f172a] dark:text-white">Yönetim Paneli İçin Giriş Yapın</h2>
        <button type="button" onClick={() => setAuthModalMode('login')} className="px-5 py-2.5 rounded-xl bg-[#f25922] text-white text-xs font-bold cursor-pointer">
          Giriş Yap
        </button>
      </div>
    );
  }

  if (!isStaff) {
    return (
      <div className="max-w-xl mx-auto my-12 p-8 bg-white dark:bg-[#13213e] rounded-3xl border border-[#e2e8f0] dark:border-[#1e335a] text-center space-y-3">
        <ShieldAlert className="w-8 h-8 text-rose-600 mx-auto" />
        <h2 className="font-display text-lg font-bold text-[#0f172a] dark:text-white">Yetkisiz Erişim</h2>
        <p className="text-xs text-[#64748b] dark:text-slate-400">
          Bu panel yalnızca platform yöneticileri, moderatörler, finans veya doğrulama uzmanları içindir ({currentUser.email}).
        </p>
      </div>
    );
  }

  const totalVolume = bookings.reduce((sum, b) => sum + b.grossAmount, 0);
  const totalCommissionEarned = bookings.reduce((sum, b) => sum + b.commissionAmount, 0);
  const activeListingsCount = listings.filter((l) => l.status === 'active').length;
  const pendingVerificationsCount = verifications.filter((v) => v.status === 'pending').length;

  const pendingListings = listings.filter((l) => l.status === 'pending_moderation');
  const pendingEvents = events.filter((e) => e.status === 'pending_moderation');
  const pendingOpportunities = opportunities.filter((o) => o.status === 'pending_moderation');
  const pendingProjects = projects.filter((p) => p.status === 'pending_moderation');
  const totalModerationCount =
    pendingListings.length + pendingEvents.length + pendingOpportunities.length + pendingProjects.length;

  const handleSaveCommission = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await adminUpdateCommission(commissionRate, commissionModel);
    if (res.success) {
      setSavedSettingsNotice(true);
      setFeedback({ type: 'success', text: 'Komisyon ayarları güncellendi.' });
      setTimeout(() => setSavedSettingsNotice(false), 3000);
      await refreshOverview();
    } else {
      setFeedback({ type: 'error', text: res.error || 'Komisyon ayarları güncellenemedi.' });
    }
  };

  const handleApproveVerification = async (id: string) => {
    const res = await adminApproveVerification(id);
    if (res.success) {
      setFeedback({ type: 'success', text: 'Doğrulama başvurusu onaylandı.' });
      await refreshOverview();
    } else {
      setFeedback({ type: 'error', text: res.error || 'Doğrulama onaylanamadı.' });
    }
  };

  const handleConfirmReject = async () => {
    if (!rejectingId) return;
    const res = await adminRejectVerification(rejectingId, rejectReason || 'Belgeler sicil şartlarına uygun görülmedi.');
    setRejectingId(null);
    setRejectReason('');
    if (res.success) {
      setFeedback({ type: 'success', text: 'Doğrulama başvurusu reddedildi ve profil güncellendi.' });
      await refreshOverview();
    } else {
      setFeedback({ type: 'error', text: res.error || 'Doğrulama reddedilemedi.' });
    }
  };

  const handleModerate = async (entityType: 'listing' | 'event' | 'opportunity' | 'project', id: string, decision: 'approve' | 'reject') => {
    const res = await moderateEntity(entityType, id, decision);
    if (res.success) {
      setFeedback({ type: 'success', text: decision === 'approve' ? 'İçerik onaylanarak yayınlandı.' : 'İçerik reddedildi.' });
      await refreshOverview();
    } else {
      setFeedback({ type: 'error', text: res.error || 'Moderasyon işlemi gerçekleştirilemedi.' });
    }
  };

  const handleToggleUserRole = (userId: string, role: RoleType) => {
    setUserRoleDrafts((prev) => {
      const current = prev[userId] || [];
      const exists = current.includes(role);
      const next = exists ? current.filter((r) => r !== role) : [...current, role];
      return { ...prev, [userId]: next };
    });
  };

  const handleSaveUserRoles = async (userId: string, currentActiveRole: RoleType) => {
    const roles = userRoleDrafts[userId] || [];
    if (roles.length === 0) {
      setFeedback({ type: 'error', text: 'Kullanıcı için en az bir rol seçilmelidir.' });
      return;
    }
    const nextActive = roles.includes(currentActiveRole) ? currentActiveRole : roles[0];
    const res = await adminUpdateUserRoles(userId, roles, nextActive);
    if (res.success) {
      setFeedback({ type: 'success', text: 'Kullanıcı rolleri güncellendi.' });
      await refreshOverview();
    } else {
      setFeedback({ type: 'error', text: res.error || 'Kullanıcı rolleri güncellenemedi.' });
    }
  };

  const handleToggleUserStatus = async (user: User) => {
    const nextStatus = user.status === 'suspended' ? 'active' : 'suspended';
    const res = await adminUpdateUserStatus(user.id, nextStatus);
    if (res.success) {
      setFeedback({
        type: 'success',
        text: nextStatus === 'suspended' ? `${user.email} askıya alındı.` : `${user.email} yeniden aktifleştirildi.`,
      });
      await refreshOverview();
    } else {
      setFeedback({ type: 'error', text: res.error || 'Kullanıcı durumu değiştirilemedi.' });
    }
  };

  const handleVerifyVenue = async (venueId: string, nextVerified: boolean) => {
    const res = await adminVerifyVenue(venueId, nextVerified);
    if (res.success) {
      setFeedback({ type: 'success', text: nextVerified ? 'Mekân doğrulandı.' : 'Mekân doğrulaması kaldırıldı.' });
      await refreshOverview();
    } else {
      setFeedback({ type: 'error', text: res.error || 'Mekân doğrulama durumu güncellenemedi.' });
    }
  };

  const handleVerifyTechProvider = async (providerId: string, nextVerified: boolean) => {
    const res = await adminVerifyTechnicalProvider(providerId, nextVerified);
    if (res.success) {
      setFeedback({ type: 'success', text: nextVerified ? 'Teknik sağlayıcı doğrulandı.' : 'Teknik sağlayıcı doğrulaması kaldırıldı.' });
      await refreshOverview();
    } else {
      setFeedback({ type: 'error', text: res.error || 'Teknik sağlayıcı doğrulama durumu güncellenemedi.' });
    }
  };

  const handleToggleEntityBadge = async (
    entityType: 'artist' | 'ensemble' | 'business' | 'community',
    id: string,
    nextVerified: boolean
  ) => {
    const res = await adminVerifyEntity(
      entityType,
      id,
      nextVerified,
      nextVerified ? badgeNote.trim() || undefined : ''
    );
    if (res.success) {
      setFeedback({
        type: 'success',
        text: nextVerified ? 'Doğrulama rozeti aktif edildi.' : 'Doğrulama rozeti kaldırıldı.',
      });
      await refreshOverview();
    } else {
      setFeedback({ type: 'error', text: res.error || 'Rozet durumu güncellenemedi.' });
    }
  };

  return (
    <div className="max-w-[1100px] mx-auto px-4 sm:px-6 lg:px-8 py-8 text-left space-y-8">
      <div className="bg-gradient-to-br from-[#16274e] via-[#12161b] to-[#0c0e12] text-white rounded-3xl p-6 sm:p-8 shadow-xl border border-white/10">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="label-caps text-[#ff8a65]">
              Yönetici &amp; Operasyon Merkezi ({activeRole})
            </div>
            <h1 className="font-display text-2xl sm:text-3xl font-bold mt-1 tracking-tight">Platform Yönetim &amp; Denetim Paneli</h1>
            <p className="text-xs text-slate-300 mt-1">
              KYC akreditasyonu, ön moderasyon kuyruğu, uyuşmazlık çözümü, finansal defter ve özellik bayrakları.
            </p>
          </div>

          {activeRole === 'admin' && (
            confirmReset ? (
              <div className="flex items-center gap-2 bg-white/10 border border-white/15 rounded-xl px-3 py-2 self-start sm:self-auto">
                <span className="text-xs text-slate-200">Tüm veriler sıfırlansın mı?</span>
                <button
                  type="button"
                  onClick={async () => {
                    await resetAllData();
                    setConfirmReset(false);
                  }}
                  className="px-3 py-1.5 text-xs font-bold text-white bg-[#f25922] rounded-lg cursor-pointer"
                >
                  Evet, Sıfırla
                </button>
                <button type="button" onClick={() => setConfirmReset(false)} className="px-2.5 py-1.5 text-xs text-slate-300 cursor-pointer">
                  Vazgeç
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmReset(true)}
                className="px-4 py-2 text-xs font-semibold text-slate-200 bg-white/10 hover:bg-white/15 border border-white/10 rounded-xl flex items-center gap-2 self-start sm:self-auto cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Demo Verileri Sıfırla</span>
              </button>
            )
          )}
        </div>

        <div className="flex items-center gap-2 mt-6 pt-6 border-t border-white/10 overflow-x-auto text-xs">
          {[
            { id: 'kpis', label: 'Metrikler' },
            { id: 'verifications', label: `Doğrulama (${pendingVerificationsCount})` },
            { id: 'moderation', label: `Ön Moderasyon (${totalModerationCount})` },
            { id: 'disputes', label: `Uyuşmazlıklar (${disputes.filter((d) => d.status === 'open').length})` },
            { id: 'ledger', label: `Finansal Defter (${ledger.length})` },
            { id: 'commission', label: 'Komisyon' },
            { id: 'flags', label: 'Özellik Bayrakları' },
            ...(activeRole === 'admin' ? [{ id: 'users', label: `Kullanıcılar (${users.length})` }] : []),
            { id: 'messages', label: `İletişim Mesajları (${contactMessages.length})` },
            { id: 'audit', label: 'Denetim Logları' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id as any)}
              className={`px-3.5 py-2 font-semibold rounded-xl transition-colors whitespace-nowrap cursor-pointer ${
                activeTab === tab.id ? 'bg-[#f25922] text-white font-bold shadow-sm' : 'text-slate-300 hover:bg-white/10'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {feedback && (
        <div
          role={feedback.type === 'error' ? 'alert' : 'status'}
          className={`p-4 rounded-2xl border text-xs font-medium flex items-center justify-between gap-3 ${
            feedback.type === 'error'
              ? 'bg-rose-50 dark:bg-rose-950/50 border-rose-200 dark:border-rose-800 text-rose-900 dark:text-rose-200'
              : 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-300'
          }`}
        >
          <span>{feedback.text}</span>
          <button type="button" onClick={() => setFeedback(null)} className="hover:underline shrink-0 cursor-pointer">
            Kapat
          </button>
        </div>
      )}

      {activeTab === 'kpis' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white dark:bg-[#13213e] p-6 rounded-3xl border border-[#e2e8f0] dark:border-[#1e335a] shadow-xs space-y-1">
            <div className="text-[10px] font-bold uppercase tracking-wider text-[#64748b]">Toplam Rezervasyon Hacmi</div>
            <div className="font-display text-2xl font-bold text-[#0f172a] dark:text-white tabular-nums">{formatCurrencyTRY(totalVolume)}</div>
          </div>
          <div className="bg-white dark:bg-[#13213e] p-6 rounded-3xl border border-[#e2e8f0] dark:border-[#1e335a] shadow-xs space-y-1">
            <div className="text-[10px] font-bold uppercase tracking-wider text-[#64748b]">Platform Komisyon Geliri</div>
            <div className="font-display text-2xl font-bold text-[#f25922] tabular-nums">{formatCurrencyTRY(totalCommissionEarned)}</div>
          </div>
          <div className="bg-white dark:bg-[#13213e] p-6 rounded-3xl border border-[#e2e8f0] dark:border-[#1e335a] shadow-xs space-y-1">
            <div className="text-[10px] font-bold uppercase tracking-wider text-[#64748b]">Aktif Yayındaki İlanlar</div>
            <div className="font-display text-2xl font-bold text-[#0f172a] dark:text-white tabular-nums">{activeListingsCount}</div>
          </div>
          <div className="bg-white dark:bg-[#13213e] p-6 rounded-3xl border border-[#e2e8f0] dark:border-[#1e335a] shadow-xs space-y-1">
            <div className="text-[10px] font-bold uppercase tracking-wider text-[#64748b]">Moderasyon &amp; Onay Bekleyen</div>
            <div className="font-display text-2xl font-bold text-[#16274e] dark:text-white tabular-nums">{pendingVerificationsCount + totalModerationCount}</div>
          </div>
        </div>
      )}

      {activeTab === 'verifications' && (
        <div className="space-y-6">
          <div className="bg-white dark:bg-[#13213e] p-6 sm:p-8 rounded-3xl border border-[#e2e8f0] dark:border-[#1e335a] space-y-4">
            <h2 className="font-display text-lg font-bold text-[#0f172a] dark:text-white">Akreditasyon &amp; Belge İnceleme Havuzu</h2>
            {verifications.length === 0 ? (
              <p className="text-xs text-[#64748b]">Doğrulama başvurusu bulunmamaktadır.</p>
            ) : (
              verifications.map((v) => (
                <div key={v.id} className="p-5 rounded-2xl bg-[#f8fafc] dark:bg-[#0f1c38] border border-[#e2e8f0] dark:border-[#1e335a] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="space-y-1">
                    <div className="font-bold text-sm text-[#0f172a] dark:text-white">{v.entityName} ({v.accountType})</div>
                    <div className="text-xs text-[#475569] dark:text-slate-300 flex flex-wrap gap-2">
                      {v.documents.map((doc, i) => (
                        <a key={i} href={doc.url} target="_blank" rel="noreferrer" className="underline flex items-center gap-1">
                          <FileText className="w-3.5 h-3.5" /> {doc.title}
                        </a>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {v.status === 'pending' ? (
                      <>
                        <button type="button" onClick={() => handleApproveVerification(v.id)} className="px-4 py-2 text-xs font-bold text-white bg-emerald-800 rounded-xl flex items-center gap-1 cursor-pointer">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Onayla
                        </button>
                        <button type="button" onClick={() => setRejectingId(v.id)} className="px-4 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-100 rounded-xl cursor-pointer">
                          Reddet
                        </button>
                      </>
                    ) : (
                      <span className="text-xs font-bold px-3 py-1.5 rounded-xl bg-slate-200 dark:bg-slate-800">{v.status}</span>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Verified Badge Governance across Artists, Ensembles, Businesses & Communities */}
          <div className="bg-white dark:bg-[#13213e] p-6 sm:p-8 rounded-3xl border border-[#e2e8f0] dark:border-[#1e335a] space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <BadgeCheck className="w-5 h-5 text-emerald-600" />
                  <h3 className="font-display text-lg font-bold text-[#0f172a] dark:text-white">
                    Doğrulanmış Rozet Yönetimi (Badge Governance)
                  </h3>
                </div>
                <p className="text-xs text-[#64748b] dark:text-slate-400 mt-0.5">
                  Sanatçılar, topluluklar, işletmeler ve topluluk kanalları için doğrulama rozetini doğrudan verin veya kaldırın.
                </p>
              </div>

              <div className="inline-flex p-1 rounded-xl bg-[#f8fafc] dark:bg-[#0f1c38] border border-[#e2e8f0] dark:border-[#1e335a] text-xs">
                {[
                  { key: 'artist', label: `Sanatçılar (${artists.length})` },
                  { key: 'ensemble', label: `Topluluklar (${ensembles.length})` },
                  { key: 'business', label: `İşletmeler (${businesses.length})` },
                  { key: 'community', label: `Kanallar (${communities.length})` },
                ].map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setBadgeFilterType(item.key as any)}
                    className={`px-3 py-1.5 rounded-lg font-bold cursor-pointer transition-colors ${
                      badgeFilterType === item.key
                        ? 'bg-[#f25922] text-white shadow-xs'
                        : 'text-[#475569] dark:text-slate-300 hover:text-[#0f172a] dark:hover:text-white'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  value={badgeQuery}
                  onChange={(e) => setBadgeQuery(e.target.value)}
                  placeholder="İsim veya şehir ara..."
                  className="w-full pl-8 pr-3 py-2 rounded-xl border border-[#e2e8f0] dark:border-[#1e335a] bg-[#f8fafc] dark:bg-[#0f1c38] text-xs"
                />
              </div>
              <input
                value={badgeNote}
                onChange={(e) => setBadgeNote(e.target.value)}
                placeholder="Opsiyonel rozet etiketi (örn: Kurumsal Onaylı Profil)"
                className="w-full px-3 py-2 rounded-xl border border-[#e2e8f0] dark:border-[#1e335a] bg-[#f8fafc] dark:bg-[#0f1c38] text-xs"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-80 overflow-y-auto pr-1">
              {(() => {
                const q = badgeQuery.trim().toLowerCase();
                const items =
                  badgeFilterType === 'artist'
                    ? artists.map((a) => ({
                        id: a.id,
                        name: a.fullName,
                        subtitle: `${a.title || a.discipline} · ${a.city}`,
                        isVerified: a.isVerified,
                        label: a.verifiedLabel || 'Doğrulanmış Sanatçı',
                      }))
                    : badgeFilterType === 'ensemble'
                    ? ensembles.map((e) => ({
                        id: e.id,
                        name: e.name,
                        subtitle: `${e.ensembleType} · ${e.city}`,
                        isVerified: e.isVerified,
                        label: e.verifiedLabel || 'Doğrulanmış Topluluk',
                      }))
                    : badgeFilterType === 'business'
                    ? businesses.map((b) => ({
                        id: b.id,
                        name: b.businessName,
                        subtitle: `${b.businessType} · ${b.city}`,
                        isVerified: b.isVerified,
                        label: b.verifiedLabel || 'Doğrulanmış Kurum',
                      }))
                    : communities.map((c) => ({
                        id: c.id,
                        name: c.name,
                        subtitle: `${c.discipline} · ${c.city} · ${c.memberCount} üye`,
                        isVerified: c.isVerified,
                        label: c.verifiedLabel || 'Doğrulanmış Topluluk Kanalı',
                      }));

                const filtered = q
                  ? items.filter(
                      (i) =>
                        i.name.toLowerCase().includes(q) ||
                        i.subtitle.toLowerCase().includes(q)
                    )
                  : items;

                if (filtered.length === 0) {
                  return <p className="text-xs text-[#64748b] col-span-2">Eşleşen kayıt bulunamadı.</p>;
                }

                return filtered.map((item) => (
                  <div
                    key={item.id}
                    className="p-3.5 rounded-2xl bg-[#f8fafc] dark:bg-[#0f1c38] border border-[#e2e8f0] dark:border-[#1e335a] flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-[#0f172a] dark:text-white flex items-center gap-1.5">
                        <span className="truncate">{item.name}</span>
                        {item.isVerified && <VerifiedBadge size="sm" label={item.label} />}
                      </div>
                      <div className="text-[11px] text-[#64748b] truncate mt-0.5">{item.subtitle}</div>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleToggleEntityBadge(badgeFilterType, item.id, !item.isVerified)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold shrink-0 cursor-pointer transition-colors ${
                        item.isVerified
                          ? 'bg-slate-200 dark:bg-slate-800 text-[#0f172a] dark:text-white hover:bg-rose-100 hover:text-rose-800'
                          : 'bg-emerald-700 hover:bg-emerald-800 text-white'
                      }`}
                    >
                      {item.isVerified ? 'Rozeti Kaldır' : 'Rozet Ver'}
                    </button>
                  </div>
                ));
              })()}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white dark:bg-[#13213e] p-6 rounded-3xl border border-[#e2e8f0] dark:border-[#1e335a] space-y-4">
              <h3 className="font-display text-base font-bold text-[#0f172a] dark:text-white">Mekân Doğrulama</h3>
              {venues.length === 0 ? (
                <p className="text-xs text-[#64748b]">Kayıtlı mekân yok.</p>
              ) : (
                <div className="space-y-3">
                  {venues.map((v) => (
                    <div key={v.id} className="p-4 rounded-2xl bg-[#f8fafc] dark:bg-[#0f1c38] border border-[#e2e8f0] dark:border-[#1e335a] flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-bold text-[#0f172a] dark:text-white flex items-center gap-1.5">
                          <span>{v.name}</span>
                          {v.isVerified && <VerifiedBadge size="sm" label="Doğrulanmış Mekân" />}
                        </div>
                        <div className="text-xs text-[#64748b]">
                          {v.city}
                          {v.district ? `, ${v.district}` : ''} · {v.spaces?.length || 0} Salon
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleVerifyVenue(v.id, !v.isVerified)}
                        className={`px-3.5 py-2 rounded-xl text-xs font-bold cursor-pointer ${
                          v.isVerified ? 'bg-slate-200 dark:bg-slate-800 text-[#0f172a] dark:text-white' : 'bg-emerald-700 text-white'
                        }`}
                      >
                        {v.isVerified ? 'Doğrulamayı Kaldır' : 'Mekânı Doğrula'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-white dark:bg-[#13213e] p-6 rounded-3xl border border-[#e2e8f0] dark:border-[#1e335a] space-y-4">
              <h3 className="font-display text-base font-bold text-[#0f172a] dark:text-white">Teknik Sağlayıcı Doğrulama</h3>
              {technicalProviders.length === 0 ? (
                <p className="text-xs text-[#64748b]">Kayıtlı teknik sağlayıcı yok.</p>
              ) : (
                <div className="space-y-3">
                  {technicalProviders.map((tp) => (
                    <div key={tp.id} className="p-4 rounded-2xl bg-[#f8fafc] dark:bg-[#0f1c38] border border-[#e2e8f0] dark:border-[#1e335a] flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-bold text-[#0f172a] dark:text-white flex items-center gap-1.5">
                          <span>{tp.name}</span>
                          {tp.isVerified && <VerifiedBadge size="sm" label="Doğrulanmış Teknik Sağlayıcı" />}
                        </div>
                        <div className="text-xs text-[#64748b]">{tp.city} · {(tp.categories || []).join(', ')}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleVerifyTechProvider(tp.id, !tp.isVerified)}
                        className={`px-3.5 py-2 rounded-xl text-xs font-bold cursor-pointer ${
                          tp.isVerified ? 'bg-slate-200 dark:bg-slate-800 text-[#0f172a] dark:text-white' : 'bg-emerald-700 text-white'
                        }`}
                      >
                        {tp.isVerified ? 'Doğrulamayı Kaldır' : 'Sağlayıcıyı Doğrula'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'moderation' && (
        <div className="bg-white dark:bg-[#13213e] p-6 sm:p-8 rounded-3xl border border-[#e2e8f0] dark:border-[#1e335a] space-y-6">
          <h2 className="font-display text-lg font-bold text-[#0f172a] dark:text-white">İçerik Ön Moderasyon Kuyruğu</h2>
          {totalModerationCount === 0 ? (
            <p className="text-xs text-[#64748b]">Moderasyon bekleyen ilan, etkinlik, fırsat veya proje bulunmamaktadır.</p>
          ) : (
            <div className="space-y-4">
              {pendingListings.map((l) => (
                <div key={l.id} className="p-4 rounded-2xl bg-[#f8fafc] dark:bg-[#0f1c38] border border-[#e2e8f0] dark:border-[#1e335a] flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <span className="text-[10px] font-bold uppercase text-[#f25922]">İlan Onayı</span>
                    <div className="text-sm font-bold text-[#0f172a] dark:text-white">{l.title}</div>
                    <div className="text-xs text-[#64748b]">{l.businessName} · {l.city} · {formatCurrencyTRY(l.budgetAmount)}</div>
                  </div>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => handleModerate('listing', l.id, 'approve')} className="px-3.5 py-2 rounded-xl bg-emerald-700 text-white text-xs font-bold cursor-pointer">Yayınla</button>
                    <button type="button" onClick={() => handleModerate('listing', l.id, 'reject')} className="px-3.5 py-2 rounded-xl bg-rose-700 text-white text-xs font-bold cursor-pointer">Reddet</button>
                  </div>
                </div>
              ))}
              {pendingEvents.map((ev) => (
                <div key={ev.id} className="p-4 rounded-2xl bg-[#f8fafc] dark:bg-[#0f1c38] border border-[#e2e8f0] dark:border-[#1e335a] flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <span className="text-[10px] font-bold uppercase text-[#f25922]">Etkinlik Duyurusu</span>
                    <div className="text-sm font-bold text-[#0f172a] dark:text-white">{ev.title}</div>
                    <div className="text-xs text-[#64748b]">{ev.venueName}, {ev.city} · {ev.eventDate}</div>
                  </div>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => handleModerate('event', ev.id, 'approve')} className="px-3.5 py-2 rounded-xl bg-emerald-700 text-white text-xs font-bold cursor-pointer">Yayınla</button>
                    <button type="button" onClick={() => handleModerate('event', ev.id, 'reject')} className="px-3.5 py-2 rounded-xl bg-rose-700 text-white text-xs font-bold cursor-pointer">Reddet</button>
                  </div>
                </div>
              ))}
              {pendingOpportunities.map((op) => (
                <div key={op.id} className="p-4 rounded-2xl bg-[#f8fafc] dark:bg-[#0f1c38] border border-[#e2e8f0] dark:border-[#1e335a] flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <span className="text-[10px] font-bold uppercase text-[#f25922]">Fırsat Radarı</span>
                    <div className="text-sm font-bold text-[#0f172a] dark:text-white">{op.title}</div>
                    <div className="text-xs text-[#64748b]">{op.organizerName} · {op.rewardInfo}</div>
                  </div>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => handleModerate('opportunity', op.id, 'approve')} className="px-3.5 py-2 rounded-xl bg-emerald-700 text-white text-xs font-bold cursor-pointer">Yayınla</button>
                    <button type="button" onClick={() => handleModerate('opportunity', op.id, 'reject')} className="px-3.5 py-2 rounded-xl bg-rose-700 text-white text-xs font-bold cursor-pointer">Reddet</button>
                  </div>
                </div>
              ))}
              {pendingProjects.map((pr) => (
                <div key={pr.id} className="p-4 rounded-2xl bg-[#f8fafc] dark:bg-[#0f1c38] border border-[#e2e8f0] dark:border-[#1e335a] flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <span className="text-[10px] font-bold uppercase text-[#f25922]">Proje Laboratuvarı</span>
                    <div className="text-sm font-bold text-[#0f172a] dark:text-white">{pr.title}</div>
                    <div className="text-xs text-[#64748b]">{pr.city} · {(pr.disciplines || []).join(', ')}</div>
                  </div>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => handleModerate('project', pr.id, 'approve')} className="px-3.5 py-2 rounded-xl bg-emerald-700 text-white text-xs font-bold cursor-pointer">Yayınla</button>
                    <button type="button" onClick={() => handleModerate('project', pr.id, 'reject')} className="px-3.5 py-2 rounded-xl bg-rose-700 text-white text-xs font-bold cursor-pointer">Reddet</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'disputes' && (
        <div className="bg-white dark:bg-[#13213e] p-6 sm:p-8 rounded-3xl border border-[#e2e8f0] dark:border-[#1e335a] space-y-4">
          <h2 className="font-display text-lg font-bold text-[#0f172a] dark:text-white">Uyuşmazlık Çözüm Masası</h2>
          {disputes.length === 0 ? (
            <p className="text-xs text-[#64748b]">Açık veya çözümlenmiş uyuşmazlık kaydı yok.</p>
          ) : (
            disputes.map((d) => (
              <div key={d.id} className="p-5 rounded-2xl bg-[#f8fafc] dark:bg-[#0f1c38] border border-[#e2e8f0] dark:border-[#1e335a] space-y-3 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-[#0f172a] dark:text-white">Rezervasyon: {d.bookingId} — {d.reason}</span>
                  <span className="px-2.5 py-1 rounded-lg bg-amber-100 text-amber-900 font-bold">{d.status}</span>
                </div>
                <p className="text-[#475569] dark:text-slate-300">{d.evidenceNotes}</p>
                {d.status === 'open' && (
                  <div className="flex flex-wrap items-center gap-2 pt-2">
                    <input
                      type="text"
                      placeholder="Çözüm gerekçesi..."
                      value={resolutionNote}
                      onChange={(e) => setResolutionNote(e.target.value)}
                      className="flex-1 min-w-[200px] px-3 py-2 rounded-xl border border-[#e2e8f0] dark:border-[#1e335a] bg-white dark:bg-[#13213e]"
                    />
                    <button
                      type="button"
                      onClick={() => resolveDispute(d.id, 'resolved_refund', resolutionNote || 'İşverene tam iade')}
                      className="px-3.5 py-2 rounded-xl bg-rose-700 text-white font-bold cursor-pointer"
                    >
                      İşverene İade Et
                    </button>
                    <button
                      type="button"
                      onClick={() => resolveDispute(d.id, 'resolved_release', resolutionNote || 'İcracı hakedişi serbest bırakıldı')}
                      className="px-3.5 py-2 rounded-xl bg-emerald-700 text-white font-bold cursor-pointer"
                    >
                      Sanatçıya Aktar
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {activeTab === 'ledger' && (
        <div className="bg-white dark:bg-[#13213e] p-6 sm:p-8 rounded-3xl border border-[#e2e8f0] dark:border-[#1e335a] space-y-4">
          <h2 className="font-display text-lg font-bold text-[#0f172a] dark:text-white">Değişmez Finansal Defter (Ledger)</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="border-b border-[#e2e8f0] dark:border-[#1e335a] text-[#64748b]">
                  <th className="py-2 pr-3">Tarih</th>
                  <th className="py-2 pr-3">Rezervasyon</th>
                  <th className="py-2 pr-3">İşlem Türü</th>
                  <th className="py-2 pr-3">Tutar</th>
                  <th className="py-2 pr-3">Sağlayıcı / Mod</th>
                  <th className="py-2">Açıklama</th>
                </tr>
              </thead>
              <tbody>
                {ledger.map((entry) => (
                  <tr key={entry.id} className="border-b border-[#e2e8f0]/60 dark:border-[#1e335a]/60">
                    <td className="py-2.5 pr-3 tabular-nums">{entry.createdAt.slice(0, 10)}</td>
                    <td className="py-2.5 pr-3 font-mono">{entry.bookingId}</td>
                    <td className="py-2.5 pr-3 font-bold text-[#f25922]">{entry.entryType}</td>
                    <td className="py-2.5 pr-3 font-bold tabular-nums">{formatCurrencyTRY(entry.amount)}</td>
                    <td className="py-2.5 pr-3">{entry.provider} ({entry.mode})</td>
                    <td className="py-2.5 text-[#475569] dark:text-slate-300">{entry.notes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'commission' && (
        <div className="bg-white dark:bg-[#13213e] p-6 sm:p-8 rounded-3xl border border-[#e2e8f0] dark:border-[#1e335a] max-w-2xl space-y-6">
          <h2 className="font-display text-lg font-bold text-[#0f172a] dark:text-white">Komisyon Modeli ve Oran Yönetimi</h2>
          {savedSettingsNotice && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 text-xs font-medium text-emerald-900 rounded-xl">
              Komisyon ayarları güncellendi!
            </div>
          )}
          <form onSubmit={handleSaveCommission} className="space-y-4">
            <label className="flex items-start gap-3 p-4 rounded-2xl border border-[#e2e8f0] dark:border-[#1e335a] cursor-pointer">
              <input type="radio" name="commModel" checked={commissionModel === 'A_EMPLOYER_PAYS'} onChange={() => setCommissionModel('A_EMPLOYER_PAYS')} className="mt-1" />
              <div className="text-xs">
                <div className="font-bold">Model A — Komisyon İşverenin Ödemesine Eklenir</div>
                <p className="text-[#64748b] mt-0.5">Sanatçı net hakedişi tam alır.</p>
              </div>
            </label>
            <label className="flex items-start gap-3 p-4 rounded-2xl border border-[#e2e8f0] dark:border-[#1e335a] cursor-pointer">
              <input type="radio" name="commModel" checked={commissionModel === 'B_ARTIST_DEDUCTS'} onChange={() => setCommissionModel('B_ARTIST_DEDUCTS')} className="mt-1" />
              <div className="text-xs">
                <div className="font-bold">Model B — Komisyon Sanatçı Hakedişinden Kesilir</div>
                <p className="text-[#64748b] mt-0.5">İşveren brüt öder, komisyon kesilir.</p>
              </div>
            </label>
            <div>
              <label className="text-xs font-bold block mb-1">Komisyon Oranı (%)</label>
              <input type="number" min="0" max="30" value={commissionRate} onChange={(e) => setCommissionRate(Number(e.target.value))} className="w-32 text-sm font-bold p-3 border border-[#e2e8f0] dark:border-[#1e335a] rounded-xl bg-[#f8fafc] dark:bg-[#0f1c38]" />
            </div>
            <button type="submit" className="px-6 py-2.5 text-xs font-bold text-white bg-[#16274e] dark:bg-[#f25922] rounded-xl cursor-pointer">
              Ayarları Kaydet
            </button>
          </form>
        </div>
      )}

      {activeTab === 'flags' && (
        <div className="bg-white dark:bg-[#13213e] p-6 sm:p-8 rounded-3xl border border-[#e2e8f0] dark:border-[#1e335a] space-y-4">
          <h2 className="font-display text-lg font-bold text-[#0f172a] dark:text-white">Modül &amp; Özellik Bayrakları (Feature Flags)</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {featureFlags.map((flag) => (
              <div key={flag.flagKey} className="p-4 rounded-2xl bg-[#f8fafc] dark:bg-[#0f1c38] border border-[#e2e8f0] dark:border-[#1e335a] flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-bold text-[#0f172a] dark:text-white">{flag.label}</div>
                  <div className="text-[11px] text-[#64748b]">{flag.description}</div>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    const res = await toggleFeatureFlag(flag.flagKey, !flag.enabled);
                    if (res.success) {
                      setFeedback({ type: 'success', text: `${flag.label} durumu güncellendi.` });
                    } else {
                      setFeedback({ type: 'error', text: res.error || 'Özellik bayrağı değiştirilemedi.' });
                    }
                  }}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold cursor-pointer ${
                    flag.enabled ? 'bg-emerald-700 text-white' : 'bg-slate-300 text-slate-800'
                  }`}
                >
                  {flag.enabled ? 'Aktif' : 'Kapalı'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'users' && activeRole === 'admin' && (
        <div className="bg-white dark:bg-[#13213e] p-6 sm:p-8 rounded-3xl border border-[#e2e8f0] dark:border-[#1e335a] space-y-4">
          <div className="flex items-center gap-2">
            <UsersIcon className="w-5 h-5 text-[#f25922]" />
            <h2 className="font-display text-lg font-bold text-[#0f172a] dark:text-white">Kullanıcı Yetki ve Hesap Durumu Yönetimi</h2>
          </div>
          {users.length === 0 ? (
            <p className="text-xs text-[#64748b]">Kullanıcı listesi yükleniyor...</p>
          ) : (
            <div className="space-y-4">
              {users.map((u) => {
                const draftRoles = userRoleDrafts[u.id] || u.roles;
                const isSelf = u.id === currentUser.id;
                const isSuspended = u.status === 'suspended';
                return (
                  <div key={u.id} className="p-4 rounded-2xl bg-[#f8fafc] dark:bg-[#0f1c38] border border-[#e2e8f0] dark:border-[#1e335a] space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-[#0f172a] dark:text-white">
                            {u.firstName} {u.lastName}
                          </span>
                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${
                              isSuspended ? 'bg-rose-100 text-rose-800' : 'bg-emerald-100 text-emerald-800'
                            }`}
                          >
                            {isSuspended ? 'Askıda' : 'Aktif'}
                          </span>
                        </div>
                        <div className="text-xs text-[#64748b]">{u.email} · Aktif Rol: {u.activeRole}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleSaveUserRoles(u.id, u.activeRole)}
                          className="px-3.5 py-1.5 rounded-xl bg-[#16274e] text-white text-xs font-bold cursor-pointer"
                        >
                          Rolleri Kaydet
                        </button>
                        <button
                          type="button"
                          disabled={isSelf}
                          onClick={() => handleToggleUserStatus(u)}
                          className={`px-3.5 py-1.5 rounded-xl text-xs font-bold cursor-pointer disabled:opacity-40 ${
                            isSuspended ? 'bg-emerald-700 text-white' : 'bg-rose-700 text-white'
                          }`}
                        >
                          {isSuspended ? 'Aktifleştir' : 'Askıya Al'}
                        </button>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2 pt-2 border-t border-[#e2e8f0] dark:border-[#1e335a]">
                      {ALL_ASSIGNABLE_ROLES.map((item) => {
                        const checked = draftRoles.includes(item.role);
                        return (
                          <label key={item.role} className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-lg bg-white dark:bg-[#13213e] border border-[#e2e8f0] dark:border-[#1e335a] cursor-pointer">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => handleToggleUserRole(u.id, item.role)}
                              className="accent-[#f25922]"
                            />
                            <span>{item.label}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {activeTab === 'messages' && (
        <div className="bg-white dark:bg-[#13213e] p-6 sm:p-8 rounded-3xl border border-[#e2e8f0] dark:border-[#1e335a] space-y-4">
          <div className="flex items-center gap-2">
            <Mail className="w-5 h-5 text-[#f25922]" />
            <h2 className="font-display text-lg font-bold text-[#0f172a] dark:text-white">Gelen İletişim Mesajları</h2>
          </div>
          {contactMessages.length === 0 ? (
            <p className="text-xs text-[#64748b]">Henüz iletişim formu üzerinden gelen mesaj bulunmamaktadır.</p>
          ) : (
            <div className="space-y-3">
              {contactMessages.map((msg) => (
                <div key={msg.id} className="p-4 rounded-2xl bg-[#f8fafc] dark:bg-[#0f1c38] border border-[#e2e8f0] dark:border-[#1e335a] space-y-1.5 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-bold text-[#0f172a] dark:text-white">{msg.subject}</span>
                    <span className="text-[#64748b] tabular-nums">{String(msg.created_at).slice(0, 16).replace('T', ' ')}</span>
                  </div>
                  <div className="text-[#475569] dark:text-slate-300">
                    <strong>{msg.name}</strong> ({msg.email}{msg.phone ? ` · ${msg.phone}` : ''})
                  </div>
                  <p className="text-[#0f172a] dark:text-slate-200 pt-1">{msg.message}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'audit' && (
        <div className="bg-white dark:bg-[#13213e] p-6 sm:p-8 rounded-3xl border border-[#e2e8f0] dark:border-[#1e335a] space-y-4">
          <h2 className="font-display text-lg font-bold text-[#0f172a] dark:text-white">Sistem Denetim Kayıtları (Audit Logs)</h2>
          <div className="space-y-2 max-h-96 overflow-y-auto text-xs">
            {auditLogs.map((log) => (
              <div key={log.id} className="p-3 rounded-xl bg-[#f8fafc] dark:bg-[#0f1c38] border border-[#e2e8f0] dark:border-[#1e335a] flex flex-wrap justify-between gap-2">
                <span><strong>{log.action}</strong> · {log.resourceType}:{log.resourceId}</span>
                <span className="text-[#64748b] tabular-nums">{log.createdAt}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {rejectingId && (
        <div className="fixed inset-0 z-50 bg-slate-950/65 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#13213e] rounded-3xl max-w-md w-full p-6 text-left shadow-2xl border border-[#e2e8f0] dark:border-[#1e335a] space-y-4">
            <h3 className="text-base font-bold text-[#0f172a] dark:text-white">Başvuruyu Reddet</h3>
            <textarea
              rows={3}
              required
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Gerekçe belirtin..."
              className="w-full text-xs p-3 border border-[#e2e8f0] dark:border-[#1e335a] bg-[#f8fafc] dark:bg-[#0f1c38] rounded-xl"
            />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setRejectingId(null)} className="px-4 py-2 text-xs font-semibold">Vazgeç</button>
              <button type="button" onClick={handleConfirmReject} className="px-4 py-2 text-xs font-bold text-white bg-rose-700 rounded-xl cursor-pointer">
                Kaydet
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
