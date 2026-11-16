import React, { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext';
import { apiRequest, uploadMediaFile } from '../services/api';
import {
  ArtDiscipline,
  DisciplineShowcase,
  Instrument,
  MusicGenre,
  EducationItem,
  ExperienceItem,
  MediaItem,
  UserPreferences,
} from '../types';
import { ART_DISCIPLINES, DISCIPLINE_SPECIALTIES, resolveDiscipline } from '../utils/disciplineConfig';
import {
  ChevronLeft,
  Camera,
  Save,
  Plus,
  Trash2,
  CheckCircle,
  GraduationCap,
  Briefcase,
  Music,
  MapPin,
  UploadCloud,
  Image as ImageIcon,
  X,
  CalendarCheck2,
  Sparkles,
  Ban,
  VolumeX,
  Lock,
  Globe,
  ExternalLink,
  Bell,
} from 'lucide-react';
import { AppView } from '../context/AppContext';

export const SocialRelationshipsCard: React.FC = () => {
  const {
    blockedUsersDetail,
    mutedUsersDetail,
    unblockUser,
    unmuteUser,
    navigateTo,
  } = useApp();
  const [busyId, setBusyId] = useState<string | null>(null);

  const handleUnblock = async (userId: string) => {
    setBusyId(userId);
    await unblockUser(userId);
    setBusyId(null);
  };

  const handleUnmute = async (userId: string) => {
    setBusyId(userId);
    await unmuteUser(userId);
    setBusyId(null);
  };

  return (
    <div
      id="privacy-relationships"
      className="bg-white dark:bg-[#13213e] p-6 sm:p-8 rounded-3xl border border-[#e2e8f0] dark:border-[#1e335a] shadow-xs space-y-5 text-left"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#e2e8f0] dark:border-[#1e335a]">
        <div className="flex items-center gap-2">
          <Ban className="w-4 h-4 text-[#f25922]" />
          <h3 className="text-sm font-bold text-[#0f172a] dark:text-white">
            Engellenen ve Sessize Alınan Kullanıcılar
          </h3>
        </div>
        <span className="text-[11px] font-semibold text-[#64748b] dark:text-slate-400">
          {blockedUsersDetail.length} engelli · {mutedUsersDetail.length} sessizde
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Blocked Users */}
        <div className="space-y-3">
          <div className="text-xs font-bold text-[#0f172a] dark:text-slate-200 flex items-center gap-1.5">
            <Ban className="w-3.5 h-3.5 text-rose-500" />
            <span>Engellediklerim ({blockedUsersDetail.length})</span>
          </div>
          {blockedUsersDetail.length === 0 ? (
            <div className="p-4 rounded-2xl bg-[#f8fafc] dark:bg-[#0f1c38] border border-[#e2e8f0] dark:border-[#1e335a] text-xs text-[#64748b] dark:text-slate-400">
              Henüz engellediğiniz bir kullanıcı bulunmuyor.
            </div>
          ) : (
            <div className="space-y-2">
              {blockedUsersDetail.map((u) => (
                <div
                  key={u.userId}
                  className="p-3 rounded-2xl bg-[#f8fafc] dark:bg-[#0f1c38] border border-[#e2e8f0] dark:border-[#1e335a] flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <img
                      src={u.avatarUrl || '/src/assets/images/artist_jazz_pianist_1794440057025.jpg'}
                      alt={u.fullName}
                      className="w-9 h-9 rounded-xl object-cover shrink-0 border border-[#e2e8f0] dark:border-[#1e335a]"
                    />
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-[#0f172a] dark:text-white truncate">
                        {u.fullName}
                      </div>
                      <div className="text-[11px] text-[#64748b] dark:text-slate-400 truncate">
                        {u.subtitle || 'Platform Üyesi'}
                      </div>
                      {u.reason && (
                        <div className="text-[10px] text-rose-600 dark:text-rose-400 truncate">
                          Not: {u.reason}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {u.profileView && u.profileEntityId && (
                      <button
                        type="button"
                        onClick={() => navigateTo(u.profileView as AppView, u.profileEntityId)}
                        title="Profile Git"
                        className="p-1.5 rounded-lg border border-[#e2e8f0] dark:border-[#1e335a] text-[#64748b] hover:text-[#16274e] dark:hover:text-white cursor-pointer"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={busyId === u.userId}
                      onClick={() => handleUnblock(u.userId)}
                      className="px-3 py-1.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-[11px] font-bold cursor-pointer disabled:opacity-50"
                    >
                      Engeli Kaldır
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Muted Users */}
        <div className="space-y-3">
          <div className="text-xs font-bold text-[#0f172a] dark:text-slate-200 flex items-center gap-1.5">
            <VolumeX className="w-3.5 h-3.5 text-amber-500" />
            <span>Sessize Aldıklarım ({mutedUsersDetail.length})</span>
          </div>
          {mutedUsersDetail.length === 0 ? (
            <div className="p-4 rounded-2xl bg-[#f8fafc] dark:bg-[#0f1c38] border border-[#e2e8f0] dark:border-[#1e335a] text-xs text-[#64748b] dark:text-slate-400">
              Henüz sessize aldığınız bir kullanıcı bulunmuyor.
            </div>
          ) : (
            <div className="space-y-2">
              {mutedUsersDetail.map((u) => (
                <div
                  key={u.userId}
                  className="p-3 rounded-2xl bg-[#f8fafc] dark:bg-[#0f1c38] border border-[#e2e8f0] dark:border-[#1e335a] flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <img
                      src={u.avatarUrl || '/src/assets/images/artist_jazz_pianist_1794440057025.jpg'}
                      alt={u.fullName}
                      className="w-9 h-9 rounded-xl object-cover shrink-0 border border-[#e2e8f0] dark:border-[#1e335a]"
                    />
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-[#0f172a] dark:text-white truncate">
                        {u.fullName}
                      </div>
                      <div className="text-[11px] text-[#64748b] dark:text-slate-400 truncate">
                        {u.subtitle || 'Platform Üyesi'}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {u.profileView && u.profileEntityId && (
                      <button
                        type="button"
                        onClick={() => navigateTo(u.profileView as AppView, u.profileEntityId)}
                        title="Profile Git"
                        className="p-1.5 rounded-lg border border-[#e2e8f0] dark:border-[#1e335a] text-[#64748b] hover:text-[#16274e] dark:hover:text-white cursor-pointer"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={busyId === u.userId}
                      onClick={() => handleUnmute(u.userId)}
                      className="px-3 py-1.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 hover:bg-amber-100 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 text-[11px] font-bold cursor-pointer disabled:opacity-50"
                    >
                      Sesi Aç
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export const NotificationPrivacyPreferencesCard: React.FC = () => {
  const { isAuthenticated } = useApp();
  const [prefs, setPrefs] = useState<UserPreferences | null>(null);
  const [saving, setSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    apiRequest<{ preferences: UserPreferences }>('/api/social/preferences')
      .then((res) => {
        if (!cancelled) setPrefs(res.preferences);
      })
      .catch(() => {
        // fallback cleanly
      });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated]);

  if (!isAuthenticated || !prefs) return null;

  const togglePref = async (key: keyof Omit<UserPreferences, 'userId' | 'updatedAt'>) => {
    const nextVal = !prefs[key];
    setPrefs({ ...prefs, [key]: nextVal });
    setSaving(true);
    setStatusMsg(null);
    try {
      const res = await apiRequest<{ preferences: UserPreferences }>('/api/social/preferences', {
        method: 'PUT',
        body: { [key]: nextVal },
      });
      setPrefs(res.preferences);
      setStatusMsg('Tercihler kaydedildi.');
    } catch {
      setPrefs(prefs);
    } finally {
      setSaving(false);
    }
  };

  const items: Array<{ key: keyof Omit<UserPreferences, 'userId' | 'updatedAt'>; label: string; desc: string }> = [
    { key: 'notifMessages', label: 'Mesaj Bildirimleri', desc: 'Yeni sohbet ve mesaj isteklerinde uyarı al' },
    { key: 'notifBookings', label: 'İlan & Rezervasyon Uyarıları', desc: 'Başvuru seçimi, teklif ve sahne onayları' },
    { key: 'notifEmergency', label: 'Acil Sahne İkame Çağrıları', desc: 'Şehir ve disiplininize uygun acil sahne fırsatları' },
    { key: 'notifFollowers', label: 'Yeni Takipçi Bildirimleri', desc: 'Profilinizi takip eden kullanıcı bildirimleri' },
    { key: 'notifCommunity', label: 'Topluluk & Kanal Hareketleri', desc: 'Üyesi olduğunuz kanallardan duyuru ve yanıtlar' },
    { key: 'allowDirectMessages', label: 'Doğrudan Mesaj İsteklerine İzin Ver', desc: 'Tanımadığınız üyelerden ilk mesaj isteği alın' },
    { key: 'showOnlineStatus', label: 'Çevrimiçi Durumunu Göster', desc: 'Mesajlaşma listesinde aktiflik göstergesi' },
  ];

  return (
    <div className="bg-white dark:bg-[#13213e] p-6 sm:p-8 rounded-3xl border border-[#e2e8f0] dark:border-[#1e335a] shadow-xs space-y-4 text-left">
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-[#e2e8f0] dark:border-[#1e335a]">
        <div className="flex items-center gap-2">
          <Bell className="w-4 h-4 text-[#f25922]" />
          <h3 className="text-sm font-bold text-[#0f172a] dark:text-white">
            Bildirim ve Mesajlaşma Tercihleri
          </h3>
        </div>
        {statusMsg && (
          <span role="status" className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
            {statusMsg}
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {items.map((item) => (
          <label
            key={item.key}
            className="flex items-start gap-3 p-3 rounded-2xl bg-[#f8fafc] dark:bg-[#0f1c38] border border-[#e2e8f0] dark:border-[#1e335a] cursor-pointer hover:border-[#f25922]/40 transition-colors"
          >
            <input
              type="checkbox"
              disabled={saving}
              checked={Boolean(prefs[item.key])}
              onChange={() => togglePref(item.key)}
              className="mt-0.5 w-4 h-4 accent-[#f25922] rounded cursor-pointer"
            />
            <div>
              <div className="text-xs font-bold text-[#0f172a] dark:text-white">{item.label}</div>
              <div className="text-[11px] text-[#64748b] dark:text-slate-400 mt-0.5">{item.desc}</div>
            </div>
          </label>
        ))}
      </div>
    </div>
  );
};

export const ProfileEditView: React.FC = () => {
  const {
    artists,
    currentUser,
    isAuthenticated,
    setAuthModalMode,
    addRoleWorkspace,
  } = useApp();

  const currentArtist = isAuthenticated
    ? artists.find((a) => a.userId === currentUser.id)
    : undefined;

  if (!isAuthenticated) {
    return (
      <div className="max-w-xl mx-auto my-12 p-8 bg-white dark:bg-[#111A2E] rounded-3xl border border-slate-200 dark:border-slate-800 text-center space-y-4">
        <h2 className="font-display text-xl font-bold text-slate-900 dark:text-white">Profil ve Gizlilik Ayarları İçin Giriş Yapın</h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">Yalnızca kendi profil ve gizlilik ayarlarınızı düzenleyebilirsiniz.</p>
        <button
          type="button"
          onClick={() => setAuthModalMode('login')}
          className="px-5 py-2.5 rounded-xl bg-[#E45424] text-white text-xs font-bold cursor-pointer"
        >
          Giriş Yap
        </button>
      </div>
    );
  }

  if (!currentArtist) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        <NotificationPrivacyPreferencesCard />
        <SocialRelationshipsCard />

        <div className="p-8 bg-white dark:bg-[#111A2E] rounded-3xl border border-slate-200 dark:border-slate-800 text-center space-y-4">
          <h2 className="font-display text-xl font-bold text-slate-900 dark:text-white">Bireysel Sanatçı Profiliniz Henüz Oluşturulmamış</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Mevcut hesabınıza bireysel sanatçı çalışma alanı ekleyerek kendi portfolyonuzu düzenleyebilirsiniz.
          </p>
          <button
            type="button"
            onClick={async () => {
              await addRoleWorkspace('artist');
            }}
            className="px-5 py-2.5 rounded-xl bg-[#E45424] text-white text-xs font-bold cursor-pointer"
          >
            Sanatçı Profilimi Oluştur
          </button>
        </div>
      </div>
    );
  }

  return <ProfileEditForm currentArtist={currentArtist} />;
};

const ProfileEditForm: React.FC<{ currentArtist: NonNullable<ReturnType<typeof useApp>['artists'][number]> }> = ({
  currentArtist,
}) => {
  const { updateArtistProfile, updateArtistPrivacy, navigateTo } = useApp();

  // Local editable form state
  const [fullName, setFullName] = useState(currentArtist.fullName);
  const [stageName, setStageName] = useState(currentArtist.stageName || '');
  const [title, setTitle] = useState(currentArtist.title);
  const [city, setCity] = useState(currentArtist.city);
  const [district, setDistrict] = useState(currentArtist.district);
  const [experienceYears, setExperienceYears] = useState(currentArtist.experienceYears);
  const [avatarUrl, setAvatarUrl] = useState(currentArtist.avatarUrl);
  const [coverUrl, setCoverUrl] = useState(currentArtist.coverUrl || '');
  const [bioShort, setBioShort] = useState(currentArtist.bioShort);
  const [bioLong, setBioLong] = useState(currentArtist.bioLong);

  // Selected discipline, availability, and adaptive showcase
  const [discipline, setDiscipline] = useState<ArtDiscipline>(resolveDiscipline(currentArtist.discipline));
  const [specialtyTags, setSpecialtyTags] = useState<string[]>(currentArtist.specialtyTags || []);
  const [isAvailableThisWeek, setIsAvailableThisWeek] = useState<boolean>(Boolean(currentArtist.isAvailableThisWeek));
  const [availabilityNote, setAvailabilityNote] = useState<string>(currentArtist.availabilityNote || '');
  const initialShowcase: DisciplineShowcase = currentArtist.disciplineShowcase || {};
  const [mediumsText, setMediumsText] = useState((initialShowcase.mediums || []).join(', '));
  const [materialsText, setMaterialsText] = useState((initialShowcase.materials || []).join(', '));
  const [scaleRange, setScaleRange] = useState(initialShowcase.scaleRange || '');
  const [exhibitions, setExhibitions] = useState<string[]>(initialShowcase.exhibitions || []);
  const [newExhibition, setNewExhibition] = useState('');
  const [stageWorksText, setStageWorksText] = useState((initialShowcase.stageWorks || []).join(', '));
  const [stageRequirements, setStageRequirements] = useState(initialShowcase.stageRequirements || '');
  const [publicationsText, setPublicationsText] = useState((initialShowcase.publications || []).join(', '));
  const [talkTopicsText, setTalkTopicsText] = useState((initialShowcase.talkTopics || []).join(', '));
  const [avSetup, setAvSetup] = useState(initialShowcase.avSetup || '');
  const [studioLocation, setStudioLocation] = useState(initialShowcase.studioLocation || '');
  const [commissionOpen, setCommissionOpen] = useState<boolean>(Boolean(initialShowcase.commissionOpen));

  // Selected instruments
  const [selectedInstruments, setSelectedInstruments] = useState<Instrument[]>(
    currentArtist.instruments || [currentArtist.primaryInstrument]
  );
  const [selectedGenres, setSelectedGenres] = useState<MusicGenre[]>(currentArtist.genres || []);

  // Education list
  const [educations, setEducations] = useState<EducationItem[]>(
    currentArtist.educations || [
      {
        id: 'edu_1',
        school: 'Mimar Sinan Güzel Sanatlar Üniversitesi Devlet Konservatuvarı',
        degree: 'Lisans',
        field: 'Piyano Ana Sanat Dalı',
        yearStart: '2012',
        yearEnd: '2016',
      },
    ]
  );

  // Experience list
  const [experiences, setExperiences] = useState<ExperienceItem[]>(
    currentArtist.experiences || [
      {
        id: 'exp_1',
        role: 'Solist & Eşlikçi Piyanist',
        organization: 'İstanbul Devlet Senfoni Orkestrası & Oda Müziği',
        year: '2016 - Günümüz',
        description: 'Sezon konserleri, festival resitalleri ve özel kurumsal etkinlikler.',
      },
    ]
  );

  // Repertoire list
  const [repertoire, setRepertoire] = useState<string[]>(
    currentArtist.repertoire || [
      'Chopin: Nocturne No. 20 in C-sharp minor',
      'Debussy: Clair de Lune',
      'Bill Evans: Waltz for Debby (Caz Aranjmanı)',
    ]
  );
  const [newRepertoirePiece, setNewRepertoirePiece] = useState('');

  // Media items
  const [mediaItems, setMediaItems] = useState<MediaItem[]>(
    currentArtist.mediaItems || [
      {
        id: 'med_1',
        title: 'Chopin Nocturne Op. 9 No. 2 Resitali',
        url: 'https://youtube.com/watch?v=demo1',
        type: 'video',
      },
      {
        id: 'med_2',
        title: 'Akustik Caz Trio Kaydı (Borusan)',
        url: 'https://soundcloud.com/demo2',
        type: 'audio',
      },
    ]
  );

  const [locationPrivacy, setLocationPrivacy] = useState<'city_masked' | 'district_masked' | 'hidden'>(
    currentArtist.locationPrivacy || 'city_masked'
  );
  const [profileVisibility, setProfileVisibility] = useState<'public' | 'private'>(
    currentArtist.profileVisibility === 'private' ? 'private' : 'public'
  );
  const [privacyFeedback, setPrivacyFeedback] = useState<string | null>(null);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isUploadingMedia, setIsUploadingMedia] = useState(false);
  const [avatarDragging, setAvatarDragging] = useState(false);
  const [coverDragging, setCoverDragging] = useState(false);
  const [showManualUrl, setShowManualUrl] = useState(false);

  const processFile = async (file: File, setter: (uploadedUrl: string) => void) => {
    if (!file.type.startsWith('image/')) {
      setSaveError('Lütfen yalnızca PNG, JPG, WEBP veya GIF formatında görsel seçiniz.');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setSaveError('Görsel boyutu en fazla 10 MB olabilir.');
      return;
    }
    setSaveError(null);
    setIsUploadingMedia(true);
    try {
      const asset = await uploadMediaFile(file, 'profile');
      setter(asset.url);
    } catch (err: any) {
      setSaveError(err?.message || 'Görsel sunucuya yüklenirken bir hata oluştu.');
    } finally {
      setIsUploadingMedia(false);
    }
  };

  const ALL_INSTRUMENTS: Instrument[] = [
    'Piyano',
    'Keman',
    'Viyola',
    'Viyolonsel (Çello)',
    'Kontrbas',
    'Flüt',
    'Klarnet',
    'Saksafon',
    'Akustik Gitar',
    'Klasik Gitar',
    'Bas Gitar',
    'Davul',
    'Perküsyon',
    'Vokal',
    'Arp',
    'Kanun',
    'Ud',
    'Ney',
  ];

  const ALL_GENRES: MusicGenre[] = [
    'Klasik Müzik',
    'Caz Müzik',
    'Oda Müziği',
    'Pop',
    'Rock',
    'Türk Sanat Müziği',
    'Türk Halk Müziği',
    'Dünya Müziği',
  ];

  const toggleInstrument = (inst: Instrument) => {
    if (selectedInstruments.includes(inst)) {
      if (selectedInstruments.length > 1) {
        setSelectedInstruments(selectedInstruments.filter((i) => i !== inst));
      }
    } else {
      setSelectedInstruments([...selectedInstruments, inst]);
    }
  };

  const toggleGenre = (genre: MusicGenre) => {
    if (selectedGenres.includes(genre)) {
      if (selectedGenres.length > 1) {
        setSelectedGenres(selectedGenres.filter((g) => g !== genre));
      }
    } else {
      setSelectedGenres([...selectedGenres, genre]);
    }
  };

  const handleAddEducation = () => {
    const newEdu: EducationItem = {
      id: `edu_${Date.now()}`,
      school: 'Konservatuvar / Müzik Akademisi',
      degree: 'Lisans / Yüksek Lisans',
      field: 'Ana Sanat Dalı',
      yearStart: '2018',
      yearEnd: '2022',
    };
    setEducations([...educations, newEdu]);
  };

  const handleRemoveEducation = (id: string) => {
    setEducations(educations.filter((e) => e.id !== id));
  };

  const handleAddExperience = () => {
    const newExp: ExperienceItem = {
      id: `exp_${Date.now()}`,
      role: 'Sanatçı / İcracı',
      organization: 'Topluluk veya Kurum Adı',
      year: '2023 - 2026',
      description: 'Konserler, festivaller ve stüdyo kayıtları.',
    };
    setExperiences([...experiences, newExp]);
  };

  const handleRemoveExperience = (id: string) => {
    setExperiences(experiences.filter((e) => e.id !== id));
  };

  const handleAddRepertoire = () => {
    if (!newRepertoirePiece.trim()) return;
    setRepertoire([...repertoire, newRepertoirePiece.trim()]);
    setNewRepertoirePiece('');
  };

  const handleRemoveRepertoire = (idx: number) => {
    setRepertoire(repertoire.filter((_, i) => i !== idx));
  };

  const parseCommaList = (val: string) =>
    val
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

  const toggleSpecialtyTag = (tag: string) => {
    setSpecialtyTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  };

  const handleAddExhibition = () => {
    if (!newExhibition.trim()) return;
    setExhibitions((prev) => [...prev, newExhibition.trim()]);
    setNewExhibition('');
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveError(null);
    setSavedSuccess(false);

    const disciplineShowcasePayload: DisciplineShowcase = {
      mediums: parseCommaList(mediumsText),
      materials: parseCommaList(materialsText),
      scaleRange: scaleRange.trim() || undefined,
      exhibitions,
      stageWorks: parseCommaList(stageWorksText),
      stageRequirements: stageRequirements.trim() || undefined,
      publications: parseCommaList(publicationsText),
      talkTopics: parseCommaList(talkTopicsText),
      avSetup: avSetup.trim() || undefined,
      studioLocation: studioLocation.trim() || undefined,
      commissionOpen,
    };

    const res = await updateArtistProfile({
      fullName,
      stageName,
      title,
      discipline,
      specialtyTags,
      city,
      district,
      experienceYears: Number(experienceYears),
      avatarUrl,
      coverUrl,
      bioShort,
      bioLong,
      primaryInstrument: selectedInstruments[0] || currentArtist.primaryInstrument,
      instruments: selectedInstruments,
      genres: selectedGenres,
      educations,
      experiences,
      repertoire,
      mediaItems,
      locationPrivacy,
      profileVisibility,
      isAvailableThisWeek,
      availabilityNote: availabilityNote.trim(),
      disciplineShowcase: disciplineShowcasePayload,
      education: educations[0] ? `${educations[0].school} (${educations[0].degree})` : currentArtist.education,
    });

    if (res.success) {
      setSavedSuccess(true);
      setTimeout(() => {
        navigateTo('artist_profile', currentArtist.id);
      }, 600);
    } else {
      setSaveError(res.error || 'Profil kaydedilirken bir hata oluştu. Lütfen tekrar deneyin.');
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 text-left">
      {/* Top Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <button
          type="button"
          onClick={() => navigateTo('artist_profile', currentArtist.id)}
          className="flex items-center gap-1.5 text-xs font-semibold text-[#475569] dark:text-slate-300 hover:text-[#16274e] dark:hover:text-white transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
          <span>Profile Geri Dön</span>
        </button>

        <div className="flex flex-wrap items-center gap-2">
          {isUploadingMedia && (
            <div role="status" className="text-xs font-semibold text-[#16274e] dark:text-[#ffb59e] bg-[#f1f3ff] dark:bg-[#0f1c38] px-3 py-1.5 rounded-lg border border-[#dae2ff] dark:border-[#1e335a]">
              Görsel yükleniyor...
            </div>
          )}
          {savedSuccess && (
            <div role="status" className="flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/50 px-3 py-1.5 rounded-lg border border-emerald-200 dark:border-emerald-800">
              <CheckCircle className="w-3.5 h-3.5" />
              <span>Değişiklikler Kaydedildi!</span>
            </div>
          )}
          <button
            type="button"
            disabled={isUploadingMedia}
            onClick={handleSave}
            className="flex items-center gap-1.5 px-4 py-2 bg-[#16274e] hover:bg-[#111d38] dark:bg-[#f25922] dark:hover:bg-[#d94b18] disabled:opacity-60 text-white rounded-xl text-xs font-bold shadow-xs transition-colors cursor-pointer"
          >
            <Save className="w-4 h-4" />
            <span>Profili Kaydet ve Yayınla</span>
          </button>
        </div>
      </div>

      {saveError && (
        <div
          role="alert"
          className="mb-5 p-4 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs font-semibold text-rose-800 dark:text-rose-200 flex items-center justify-between gap-3"
        >
          <span>{saveError}</span>
          <button
            type="button"
            onClick={() => setSaveError(null)}
            className="underline shrink-0 cursor-pointer"
          >
            Kapat
          </button>
        </div>
      )}

      <div className="space-y-6">
        {/* Banner and Avatar section with Drag & Drop / File Selector */}
        <div className="bg-white dark:bg-[#13213e] rounded-3xl border border-[#e2e8f0] dark:border-[#1e335a] overflow-hidden shadow-xs">
          {/* Cover Photo Dropzone */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setCoverDragging(true);
            }}
            onDragLeave={() => setCoverDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setCoverDragging(false);
              const file = e.dataTransfer.files?.[0];
              if (file) processFile(file, setCoverUrl);
            }}
            className={`relative h-48 sm:h-60 bg-[#16274e] transition-colors ${
              coverDragging ? 'ring-4 ring-[#f25922] ring-inset bg-[#111d38]' : ''
            }`}
          >
            {coverUrl ? (
              <img
                src={coverUrl}
                alt="Kapak Görseli"
                className="w-full h-full object-cover object-center"
              />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center text-slate-300 text-xs gap-2 p-4 text-center">
                <ImageIcon className="w-8 h-8 text-slate-400" />
                <span>Kapak fotoğrafınızı buraya sürükleyip bırakın veya bilgisayardan seçin</span>
              </div>
            )}
            <div className="absolute inset-0 bg-[#0c0e12]/30 pointer-events-none" />

            {/* Cover Action Buttons */}
            <div className="absolute bottom-3 right-3 flex items-center gap-2">
              <label className="cursor-pointer bg-white/95 dark:bg-[#13213e]/95 hover:bg-white dark:hover:bg-[#13213e] text-[#0f172a] dark:text-white text-xs font-semibold px-3 py-1.5 rounded-xl shadow-md flex items-center gap-1.5 transition-colors">
                <UploadCloud className="w-4 h-4 text-[#f25922]" />
                <span>Bilgisayardan Kapak Seç</span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) processFile(file, setCoverUrl);
                  }}
                  className="hidden"
                />
              </label>

              {coverUrl && (
                <button
                  type="button"
                  onClick={() => setCoverUrl('')}
                  className="bg-[#16274e]/90 hover:bg-[#16274e] text-white p-1.5 rounded-xl shadow-md transition-colors"
                  title="Kapak Fotoğrafını Kaldır"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          {/* Avatar & Photo Management */}
          <div className="px-5 sm:px-6 pb-6 pt-3">
            {/* Top row with elevated Avatar */}
            <div className="flex flex-wrap items-end justify-between gap-3 -mt-16 sm:-mt-20 mb-4">
              <div className="relative w-28 h-28 sm:w-32 sm:h-32 rounded-2xl overflow-hidden border-4 border-white dark:border-[#13213e] shadow-xl bg-[#f8fafc] dark:bg-[#0f1c38] shrink-0">
                <img
                  src={avatarUrl}
                  alt={fullName}
                  className="w-full h-full object-cover"
                />
              </div>

              <label className="cursor-pointer bg-[#16274e] hover:bg-[#111d38] dark:bg-[#0f1c38] dark:border dark:border-[#1e335a] text-white text-xs font-semibold px-4 py-2 rounded-xl shadow-md flex items-center gap-1.5 transition-colors">
                <UploadCloud className="w-4 h-4 text-[#f25922]" />
                <span>Yeni Profil Fotoğrafı Yükle</span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) processFile(file, setAvatarUrl);
                  }}
                  className="hidden"
                />
              </label>
            </div>

            {/* Avatar Drag-and-Drop Uploader Box */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setAvatarDragging(true);
              }}
              onDragLeave={() => setAvatarDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setAvatarDragging(false);
                const file = e.dataTransfer.files?.[0];
                if (file) processFile(file, setAvatarUrl);
              }}
              className={`border-2 border-dashed rounded-2xl p-4 transition-colors flex flex-col sm:flex-row items-center justify-between gap-4 ${
                avatarDragging
                  ? 'border-[#f25922] bg-[#f25922]/10'
                  : 'border-[#cbd5e1] dark:border-[#1e335a] hover:border-[#16274e] dark:hover:border-[#f25922] bg-[#f8fafc] dark:bg-[#0f1c38]'
              }`}
            >
              <div className="flex items-center gap-3 text-left">
                <div className="w-10 h-10 rounded-xl bg-white dark:bg-[#13213e] border border-[#e2e8f0] dark:border-[#1e335a] flex items-center justify-center shrink-0 text-[#f25922] shadow-2xs">
                  <Camera className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-xs font-bold text-[#0f172a] dark:text-white">
                    Profil Fotoğrafı Sürükle veya Seç
                  </div>
                  <div className="text-[11px] text-[#64748b] dark:text-slate-400">
                    Bilgisayarınızdan bir görsel seçin veya buraya bırakın (PNG, JPG, WEBP — Maks. 10MB)
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <label className="cursor-pointer bg-white dark:bg-[#13213e] hover:bg-slate-100 dark:hover:bg-[#1e335a] text-[#0f172a] dark:text-slate-200 border border-[#e2e8f0] dark:border-[#1e335a] text-xs font-semibold px-4 py-2 rounded-xl shadow-2xs flex items-center gap-1.5 transition-colors">
                  <UploadCloud className="w-4 h-4 text-[#64748b] dark:text-slate-400" />
                  <span>Dosya Seç</span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) processFile(file, setAvatarUrl);
                    }}
                    className="hidden"
                  />
                </label>
              </div>
            </div>

            {/* Optional URL Toggle */}
            <div className="pt-2 text-left">
              <button
                type="button"
                onClick={() => setShowManualUrl(!showManualUrl)}
                className="text-[11px] font-semibold text-[#64748b] dark:text-slate-400 hover:text-[#0f172a] dark:hover:text-white underline transition-colors"
              >
                {showManualUrl ? 'Manuel URL alanlarını gizle' : 'Alternatif: Web bağlantısı (URL) ile girmek için tıklayın'}
              </button>

              {showManualUrl && (
                <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 bg-[#f8fafc] dark:bg-[#0f1c38] rounded-xl border border-[#e2e8f0] dark:border-[#1e335a]">
                  <div>
                    <label className="block text-[11px] font-bold text-[#475569] dark:text-slate-300 mb-1">
                      Profil Fotoğrafı URL
                    </label>
                    <input
                      type="url"
                      value={avatarUrl}
                      onChange={(e) => setAvatarUrl(e.target.value)}
                      placeholder="https://..."
                      className="w-full px-3 py-1.5 text-xs rounded-lg border border-[#e2e8f0] dark:border-[#1e335a] bg-white dark:bg-[#13213e] text-[#0f172a] dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-[#475569] dark:text-slate-300 mb-1">
                      Kapak Fotoğrafı URL
                    </label>
                    <input
                      type="url"
                      value={coverUrl}
                      onChange={(e) => setCoverUrl(e.target.value)}
                      placeholder="https://..."
                      className="w-full px-3 py-1.5 text-xs rounded-lg border border-[#e2e8f0] dark:border-[#1e335a] bg-white dark:bg-[#13213e] text-[#0f172a] dark:text-white"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* General Details */}
        <div className="bg-white dark:bg-[#13213e] p-6 sm:p-8 rounded-3xl border border-[#e2e8f0] dark:border-[#1e335a] shadow-xs space-y-4">
          <h3 className="text-sm font-bold text-[#0f172a] dark:text-white pb-2 border-b border-[#e2e8f0] dark:border-[#1e335a]">
            Temel Kimlik ve Konum Bilgileri
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-[#475569] dark:text-slate-300 mb-1">Ad Soyad</label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-xl border border-[#e2e8f0] dark:border-[#1e335a] bg-[#f8fafc] dark:bg-[#0f1c38] text-[#0f172a] dark:text-white focus:ring-2 focus:ring-[#f25922] focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#475569] dark:text-slate-300 mb-1">Sahne Adı (Varsa)</label>
              <input
                type="text"
                value={stageName}
                onChange={(e) => setStageName(e.target.value)}
                placeholder="Örn: Efe Jazz"
                className="w-full px-3 py-2 text-xs rounded-xl border border-[#e2e8f0] dark:border-[#1e335a] bg-[#f8fafc] dark:bg-[#0f1c38] text-[#0f172a] dark:text-white focus:ring-2 focus:ring-[#f25922] focus:outline-none"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-[#475569] dark:text-slate-300 mb-1">
                Mesleki Ünvan / Sahne Başlığı
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Örn: Konser Piyanisti & Akustik Caz İcracısı"
                className="w-full px-3 py-2 text-xs rounded-xl border border-[#e2e8f0] dark:border-[#1e335a] bg-[#f8fafc] dark:bg-[#0f1c38] text-[#0f172a] dark:text-white focus:ring-2 focus:ring-[#f25922] focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#475569] dark:text-slate-300 mb-1">Şehir</label>
              <input
                type="text"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-xl border border-[#e2e8f0] dark:border-[#1e335a] bg-[#f8fafc] dark:bg-[#0f1c38] text-[#0f172a] dark:text-white focus:ring-2 focus:ring-[#f25922] focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#475569] dark:text-slate-300 mb-1">İlçe</label>
              <input
                type="text"
                value={district}
                onChange={(e) => setDistrict(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-xl border border-[#e2e8f0] dark:border-[#1e335a] bg-[#f8fafc] dark:bg-[#0f1c38] text-[#0f172a] dark:text-white focus:ring-2 focus:ring-[#f25922] focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#475569] dark:text-slate-300 mb-1">
                Sahne Deneyimi (Yıl)
              </label>
              <input
                type="number"
                value={experienceYears}
                onChange={(e) => setExperienceYears(Number(e.target.value))}
                className="w-full px-3 py-2 text-xs rounded-xl border border-[#e2e8f0] dark:border-[#1e335a] bg-[#f8fafc] dark:bg-[#0f1c38] text-[#0f172a] dark:text-white focus:ring-2 focus:ring-[#f25922] focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#475569] dark:text-slate-300 mb-1">
                Harita Konum Gizliliği
              </label>
              <select
                value={locationPrivacy}
                onChange={(e) => setLocationPrivacy(e.target.value as 'city_masked' | 'district_masked' | 'hidden')}
                className="w-full px-3 py-2 text-xs rounded-xl border border-[#e2e8f0] dark:border-[#1e335a] bg-[#f8fafc] dark:bg-[#0f1c38] text-[#0f172a] dark:text-white focus:ring-2 focus:ring-[#f25922] focus:outline-none"
              >
                <option value="city_masked">Şehir / İlçe Yaklaşık Bölge (Önerilen)</option>
                <option value="district_masked">İlçe Çevresi (~1.8 km yarıçap)</option>
                <option value="hidden">Haritada Konum Gösterme</option>
              </select>
            </div>
          </div>

          <div className="pt-2">
            <label className="block text-xs font-semibold text-[#475569] dark:text-slate-300 mb-1">Kısa Tanıtım (Özet)</label>
            <textarea
              rows={2}
              value={bioShort}
              onChange={(e) => setBioShort(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-xl border border-[#e2e8f0] dark:border-[#1e335a] bg-[#f8fafc] dark:bg-[#0f1c38] text-[#0f172a] dark:text-white focus:ring-2 focus:ring-[#f25922] focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#475569] dark:text-slate-300 mb-1">
              Detaylı Biyografi & Sanat Geçmişi
            </label>
            <textarea
              rows={4}
              value={bioLong}
              onChange={(e) => setBioLong(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-xl border border-[#e2e8f0] dark:border-[#1e335a] bg-[#f8fafc] dark:bg-[#0f1c38] text-[#0f172a] dark:text-white focus:ring-2 focus:ring-[#f25922] focus:outline-none"
            />
          </div>
        </div>

        {/* Profile Privacy & Visibility */}
        <div className="bg-white dark:bg-[#13213e] p-6 sm:p-8 rounded-3xl border border-[#e2e8f0] dark:border-[#1e335a] shadow-xs space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-[#e2e8f0] dark:border-[#1e335a]">
            <div className="flex items-center gap-2">
              {profileVisibility === 'private' ? (
                <Lock className="w-4 h-4 text-[#f25922]" />
              ) : (
                <Globe className="w-4 h-4 text-emerald-600" />
              )}
              <h3 className="text-sm font-bold text-[#0f172a] dark:text-white">
                Profil Görünürlüğü ve Gizlilik
              </h3>
            </div>
            {privacyFeedback && (
              <span role="status" className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                {privacyFeedback}
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
            <div>
              <label htmlFor="profile-visibility" className="block text-xs font-semibold text-[#475569] dark:text-slate-300 mb-1">
                Profil Görünürlük Tercihi
              </label>
              <select
                id="profile-visibility"
                value={profileVisibility}
                onChange={async (e) => {
                  const next = e.target.value === 'private' ? 'private' : 'public';
                  setProfileVisibility(next);
                  const res = await updateArtistPrivacy(next);
                  if (res.success) {
                    setPrivacyFeedback(next === 'private' ? 'Gizli profil aktif edildi.' : 'Herkese açık profil aktif edildi.');
                  }
                }}
                className="w-full px-3 py-2 text-xs rounded-xl border border-[#e2e8f0] dark:border-[#1e335a] bg-[#f8fafc] dark:bg-[#0f1c38] text-[#0f172a] dark:text-white focus:ring-2 focus:ring-[#f25922] focus:outline-none"
              >
                <option value="public">Herkese Açık (Tam Portfolyo Görünür)</option>
                <option value="private">Gizli Profil (Yalnızca Temel Kimlik Görünür)</option>
              </select>
            </div>

            <div className="p-3.5 rounded-2xl bg-[#f8fafc] dark:bg-[#0f1c38] border border-[#e2e8f0] dark:border-[#1e335a] text-[11px] text-[#475569] dark:text-slate-300 space-y-1.5">
              <div className="font-bold text-[#0f172a] dark:text-white">
                {profileVisibility === 'private' ? 'Gizli Profilde Ne Olur?' : 'Herkese Açık Profil'}
              </div>
              <p>
                <strong>Görünür kalanlar:</strong> Ad soyad, fotoğraf, doğrulama rozeti, ana disiplin, şehir, takipçi sayıları ve takip/engelle butonları.
              </p>
              <p>
                <strong>Gizlenenler:</strong> Biyografi, repertuvar, ses/video kayıtları, eğitim/deneyim geçmişi, müsaitlik notu ve işveren yorumları.
              </p>
            </div>
          </div>
        </div>

        {/* Notification & Privacy Preferences */}
        <NotificationPrivacyPreferencesCard />

        {/* Blocked & Muted Users */}
        <SocialRelationshipsCard />

        {/* Discipline & Weekly Availability */}
        <div className="bg-white dark:bg-[#13213e] p-6 sm:p-8 rounded-3xl border border-[#e2e8f0] dark:border-[#1e335a] shadow-xs space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-[#e2e8f0] dark:border-[#1e335a]">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-[#f25922]" />
              <h3 className="text-sm font-bold text-[#0f172a] dark:text-white">
                Sanat Disiplini ve Haftalık Sahne Müsaitliği
              </h3>
            </div>
            <span className="text-[11px] font-semibold text-[#64748b] dark:text-slate-400">
              Profil vitrininiz seçtiğiniz disipline göre uyarlanır
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
            <div>
              <label htmlFor="profile-discipline" className="block text-xs font-semibold text-[#475569] dark:text-slate-300 mb-1">
                Ana Sanat Disiplini
              </label>
              <select
                id="profile-discipline"
                value={discipline}
                onChange={(e) => setDiscipline(e.target.value as ArtDiscipline)}
                className="w-full px-3 py-2 text-xs rounded-xl border border-[#e2e8f0] dark:border-[#1e335a] bg-[#f8fafc] dark:bg-[#0f1c38] text-[#0f172a] dark:text-white focus:ring-2 focus:ring-[#f25922] focus:outline-none"
              >
                {ART_DISCIPLINES.filter((d): d is ArtDiscipline => d !== 'Tümü').map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>

            <div className="p-3.5 rounded-2xl bg-[#f8fafc] dark:bg-[#0f1c38] border border-[#e2e8f0] dark:border-[#1e335a] space-y-2.5">
              <label className="flex items-center gap-2.5 text-xs font-bold text-[#0f172a] dark:text-white cursor-pointer">
                <input
                  id="profile-available-week"
                  type="checkbox"
                  checked={isAvailableThisWeek}
                  onChange={(e) => setIsAvailableThisWeek(e.target.checked)}
                  className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                />
                <CalendarCheck2 className="w-4 h-4 text-emerald-600" />
                <span>Bu hafta sahne / proje için müsaitim</span>
              </label>
              <input
                id="profile-availability-note"
                type="text"
                value={availabilityNote}
                onChange={(e) => setAvailabilityNote(e.target.value)}
                placeholder="Örn: Cuma ve Cumartesi akşamları İstanbul içi solo/duo için uygunum"
                className="w-full px-3 py-1.5 text-xs rounded-lg border border-[#e2e8f0] dark:border-[#1e335a] bg-white dark:bg-[#13213e] text-[#0f172a] dark:text-white"
              />
            </div>
          </div>
        </div>

        {/* Adaptive Discipline Showcase: Music OR Non-Music */}
        {discipline === 'Müzik' ? (
          <div className="bg-white dark:bg-[#13213e] p-6 sm:p-8 rounded-3xl border border-[#e2e8f0] dark:border-[#1e335a] shadow-xs space-y-4">
            <h3 className="text-sm font-bold text-[#0f172a] dark:text-white pb-2 border-b border-[#e2e8f0] dark:border-[#1e335a]">
              Enstrümanlar ve Müzik Türleri
            </h3>

            <div>
              <label className="block text-xs font-semibold text-[#475569] dark:text-slate-300 mb-2">
                Çaldığınız Enstrümanlar (Çoklu Seçim)
              </label>
              <div className="flex flex-wrap gap-1.5">
                {ALL_INSTRUMENTS.map((inst) => {
                  const isSelected = selectedInstruments.includes(inst);
                  return (
                    <button
                      key={inst}
                      type="button"
                      onClick={() => toggleInstrument(inst)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors ${
                        isSelected
                          ? 'bg-[#16274e] dark:bg-[#f25922] text-white border-[#16274e] dark:border-[#f25922]'
                          : 'bg-[#f8fafc] dark:bg-[#0f1c38] text-[#475569] dark:text-slate-300 border-[#e2e8f0] dark:border-[#1e335a] hover:bg-[#f1f3ff] dark:hover:bg-[#1e335a]'
                      }`}
                    >
                      {inst}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="pt-2">
              <label className="block text-xs font-semibold text-[#0f172a] dark:text-slate-200 mb-2">
                İcra Ettiğiniz Müzik Türleri
              </label>
              <div className="flex flex-wrap gap-1.5">
                {ALL_GENRES.map((g) => {
                  const isSelected = selectedGenres.includes(g);
                  return (
                    <button
                      key={g}
                      type="button"
                      onClick={() => toggleGenre(g)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors ${
                        isSelected
                          ? 'bg-[#f25922] text-white border-[#f25922]'
                          : 'bg-[#f8fafc] dark:bg-[#0f1c38] text-[#ad3300] dark:text-[#ff8a65] border-[#ffb59e] dark:border-[#f25922]/40 hover:bg-[#ffdbd0]/40 dark:hover:bg-[#f25922]/15'
                      }`}
                    >
                      {g}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-white dark:bg-[#13213e] p-6 sm:p-8 rounded-3xl border border-[#e2e8f0] dark:border-[#1e335a] shadow-xs space-y-5">
            <h3 className="text-sm font-bold text-[#0f172a] dark:text-white pb-2 border-b border-[#e2e8f0] dark:border-[#1e335a]">
              {discipline} — Uzmanlıklar ve Uyarlanabilir Vitrin
            </h3>

            <div>
              <label className="block text-xs font-semibold text-[#475569] dark:text-slate-300 mb-2">
                Alt Uzmanlık Alanları (Çoklu Seçim)
              </label>
              <div className="flex flex-wrap gap-1.5">
                {(DISCIPLINE_SPECIALTIES[discipline] || []).map((tag) => {
                  const isSelected = specialtyTags.includes(tag);
                  return (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => toggleSpecialtyTag(tag)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors cursor-pointer ${
                        isSelected
                          ? 'bg-[#f25922] text-white border-[#f25922]'
                          : 'bg-[#f8fafc] dark:bg-[#0f1c38] text-[#475569] dark:text-slate-300 border-[#e2e8f0] dark:border-[#1e335a]'
                      }`}
                    >
                      {tag}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {(discipline === 'Görsel Sanatlar & Sergi' || discipline === 'Bileşik Sanatlar') && (
                <div>
                  <label htmlFor="showcase-mediums" className="block text-xs font-semibold text-[#475569] dark:text-slate-300 mb-1">
                    Kullanılan Mecra &amp; Teknikler (virgülle ayırın)
                  </label>
                  <input
                    id="showcase-mediums"
                    type="text"
                    value={mediumsText}
                    onChange={(e) => setMediumsText(e.target.value)}
                    placeholder="Örn: Yağlıboya, Akrilik, Canlı Çizim, Video Projeksiyon"
                    className="w-full px-3 py-2 text-xs rounded-xl border border-[#e2e8f0] dark:border-[#1e335a] bg-[#f8fafc] dark:bg-[#0f1c38] text-[#0f172a] dark:text-white"
                  />
                </div>
              )}

              {discipline === 'Heykel & Enstalasyon' && (
                <>
                  <div>
                    <label htmlFor="showcase-materials" className="block text-xs font-semibold text-[#475569] dark:text-slate-300 mb-1">
                      Malzemeler (virgülle ayırın)
                    </label>
                    <input
                      id="showcase-materials"
                      type="text"
                      value={materialsText}
                      onChange={(e) => setMaterialsText(e.target.value)}
                      placeholder="Örn: Bronz, Doğal Taş, Paslanmaz Çelik"
                      className="w-full px-3 py-2 text-xs rounded-xl border border-[#e2e8f0] dark:border-[#1e335a] bg-[#f8fafc] dark:bg-[#0f1c38] text-[#0f172a] dark:text-white"
                    />
                  </div>
                  <div>
                    <label htmlFor="showcase-scale" className="block text-xs font-semibold text-[#475569] dark:text-slate-300 mb-1">
                      Ölçek Aralığı
                    </label>
                    <input
                      id="showcase-scale"
                      type="text"
                      value={scaleRange}
                      onChange={(e) => setScaleRange(e.target.value)}
                      placeholder="Örn: 80cm - 4.5m kamusal alan yerleştirmesi"
                      className="w-full px-3 py-2 text-xs rounded-xl border border-[#e2e8f0] dark:border-[#1e335a] bg-[#f8fafc] dark:bg-[#0f1c38] text-[#0f172a] dark:text-white"
                    />
                  </div>
                </>
              )}

              {discipline === 'Sahne & Tiyatro' && (
                <>
                  <div>
                    <label htmlFor="showcase-stage-works" className="block text-xs font-semibold text-[#475569] dark:text-slate-300 mb-1">
                      Sahnelenen Oyun &amp; Performanslar (virgülle)
                    </label>
                    <input
                      id="showcase-stage-works"
                      type="text"
                      value={stageWorksText}
                      onChange={(e) => setStageWorksText(e.target.value)}
                      placeholder="Örn: Tek Kişilik Monolog, Fiziksel Tiyatro Etüdü"
                      className="w-full px-3 py-2 text-xs rounded-xl border border-[#e2e8f0] dark:border-[#1e335a] bg-[#f8fafc] dark:bg-[#0f1c38] text-[#0f172a] dark:text-white"
                    />
                  </div>
                  <div>
                    <label htmlFor="showcase-stage-req" className="block text-xs font-semibold text-[#475569] dark:text-slate-300 mb-1">
                      Sahne &amp; Teknik Gereksinim
                    </label>
                    <input
                      id="showcase-stage-req"
                      type="text"
                      value={stageRequirements}
                      onChange={(e) => setStageRequirements(e.target.value)}
                      placeholder="Örn: Min. 5x4m siyah zemin, temel spot ışık"
                      className="w-full px-3 py-2 text-xs rounded-xl border border-[#e2e8f0] dark:border-[#1e335a] bg-[#f8fafc] dark:bg-[#0f1c38] text-[#0f172a] dark:text-white"
                    />
                  </div>
                </>
              )}

              {discipline === 'Edebiyat & Söyleşi' && (
                <>
                  <div>
                    <label htmlFor="showcase-publications" className="block text-xs font-semibold text-[#475569] dark:text-slate-300 mb-1">
                      Yayınlar &amp; Kitaplar (virgülle)
                    </label>
                    <input
                      id="showcase-publications"
                      type="text"
                      value={publicationsText}
                      onChange={(e) => setPublicationsText(e.target.value)}
                      placeholder="Örn: Kentin Sesleri (2024), Sahne Denemeleri"
                      className="w-full px-3 py-2 text-xs rounded-xl border border-[#e2e8f0] dark:border-[#1e335a] bg-[#f8fafc] dark:bg-[#0f1c38] text-[#0f172a] dark:text-white"
                    />
                  </div>
                  <div>
                    <label htmlFor="showcase-talk-topics" className="block text-xs font-semibold text-[#475569] dark:text-slate-300 mb-1">
                      Söyleşi &amp; Atölye Başlıkları (virgülle)
                    </label>
                    <input
                      id="showcase-talk-topics"
                      type="text"
                      value={talkTopicsText}
                      onChange={(e) => setTalkTopicsText(e.target.value)}
                      placeholder="Örn: Yaratıcı Yazarlık, Şiir ve Müzik Buluşması"
                      className="w-full px-3 py-2 text-xs rounded-xl border border-[#e2e8f0] dark:border-[#1e335a] bg-[#f8fafc] dark:bg-[#0f1c38] text-[#0f172a] dark:text-white"
                    />
                  </div>
                </>
              )}

              <div>
                <label htmlFor="showcase-av" className="block text-xs font-semibold text-[#475569] dark:text-slate-300 mb-1">
                  AV / Kürasyon / Prodüksiyon Altyapısı
                </label>
                <input
                  id="showcase-av"
                  type="text"
                  value={avSetup}
                  onChange={(e) => setAvSetup(e.target.value)}
                  placeholder="Örn: 4K Projeksiyon, DMX Işık Senkronu"
                  className="w-full px-3 py-2 text-xs rounded-xl border border-[#e2e8f0] dark:border-[#1e335a] bg-[#f8fafc] dark:bg-[#0f1c38] text-[#0f172a] dark:text-white"
                />
              </div>

              <div>
                <label htmlFor="showcase-studio" className="block text-xs font-semibold text-[#475569] dark:text-slate-300 mb-1">
                  Atölye / Stüdyo Konumu
                </label>
                <input
                  id="showcase-studio"
                  type="text"
                  value={studioLocation}
                  onChange={(e) => setStudioLocation(e.target.value)}
                  placeholder="Örn: Beyoğlu Galata Atölye"
                  className="w-full px-3 py-2 text-xs rounded-xl border border-[#e2e8f0] dark:border-[#1e335a] bg-[#f8fafc] dark:bg-[#0f1c38] text-[#0f172a] dark:text-white"
                />
              </div>
            </div>

            <label className="inline-flex items-center gap-2 text-xs font-semibold text-[#0f172a] dark:text-white cursor-pointer">
              <input
                type="checkbox"
                checked={commissionOpen}
                onChange={(e) => setCommissionOpen(e.target.checked)}
                className="rounded border-slate-300 text-[#f25922] focus:ring-[#f25922]"
              />
              <span>Özel sipariş, sergi kürasyonu ve kurumsal komisyona açığım</span>
            </label>

            <div className="space-y-2 pt-2 border-t border-[#e2e8f0] dark:border-[#1e335a]">
              <label className="block text-xs font-semibold text-[#475569] dark:text-slate-300">
                Sergi, Yerleştirme veya Festival Geçmişi
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newExhibition}
                  onChange={(e) => setNewExhibition(e.target.value)}
                  placeholder="Örn: İstanbul Tasarım Bienali — Yan Program (2025)"
                  className="flex-1 px-3 py-2 text-xs rounded-xl border border-[#e2e8f0] dark:border-[#1e335a] bg-[#f8fafc] dark:bg-[#0f1c38] text-[#0f172a] dark:text-white"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddExhibition();
                    }
                  }}
                />
                <button
                  type="button"
                  onClick={handleAddExhibition}
                  className="px-4 py-2 bg-[#16274e] dark:bg-[#f25922] text-white rounded-xl text-xs font-bold cursor-pointer"
                >
                  Ekle
                </button>
              </div>
              {exhibitions.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {exhibitions.map((ex, idx) => (
                    <div
                      key={idx}
                      className="p-2.5 rounded-xl bg-[#f8fafc] dark:bg-[#0f1c38] border border-[#e2e8f0] dark:border-[#1e335a] text-xs flex items-center justify-between"
                    >
                      <span className="truncate">{ex}</span>
                      <button
                        type="button"
                        onClick={() => setExhibitions(exhibitions.filter((_, i) => i !== idx))}
                        className="text-[#64748b] hover:text-rose-600 ml-2 shrink-0 cursor-pointer"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Education (LinkedIn-style) */}
        <div className="bg-white dark:bg-[#13213e] p-6 sm:p-8 rounded-3xl border border-[#e2e8f0] dark:border-[#1e335a] shadow-xs space-y-4">
          <div className="flex items-center justify-between pb-2 border-b border-[#e2e8f0] dark:border-[#1e335a]">
            <div className="flex items-center gap-2">
              <GraduationCap className="w-4 h-4 text-[#475569] dark:text-slate-300" />
              <h3 className="text-sm font-bold text-[#0f172a] dark:text-white">Eğitim ve Akreditasyon</h3>
            </div>
            <button
              type="button"
              onClick={handleAddEducation}
              className="text-xs font-semibold text-[#f25922] hover:underline flex items-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Eğitim Ekle</span>
            </button>
          </div>

          <div className="space-y-3">
            {educations.map((edu, idx) => (
              <div key={edu.id} className="p-4 rounded-2xl bg-[#f8fafc] dark:bg-[#0f1c38] border border-[#e2e8f0] dark:border-[#1e335a] space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[#475569] dark:text-slate-300">Eğitim #{idx + 1}</span>
                  {educations.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleRemoveEducation(edu.id)}
                      className="text-[#64748b] hover:text-rose-600 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] font-semibold text-[#475569] dark:text-slate-300">Okul / Konservatuvar</label>
                    <input
                      type="text"
                      value={edu.school}
                      onChange={(e) => {
                        const val = e.target.value;
                        setEducations(educations.map((item) => (item.id === edu.id ? { ...item, school: val } : item)));
                      }}
                      className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-[#e2e8f0] dark:border-[#1e335a] bg-white dark:bg-[#13213e] text-[#0f172a] dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold text-[#475569] dark:text-slate-300">Derece / Bölüm</label>
                    <input
                      type="text"
                      value={edu.field}
                      onChange={(e) => {
                        const val = e.target.value;
                        setEducations(educations.map((item) => (item.id === edu.id ? { ...item, field: val } : item)));
                      }}
                      className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-[#e2e8f0] dark:border-[#1e335a] bg-white dark:bg-[#13213e] text-[#0f172a] dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold text-[#475569] dark:text-slate-300">Başlangıç Yılı</label>
                    <input
                      type="text"
                      value={edu.yearStart}
                      onChange={(e) => {
                        const val = e.target.value;
                        setEducations(educations.map((item) => (item.id === edu.id ? { ...item, yearStart: val } : item)));
                      }}
                      className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-[#e2e8f0] dark:border-[#1e335a] bg-white dark:bg-[#13213e] text-[#0f172a] dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold text-[#475569] dark:text-slate-300">Mezuniyet Yılı</label>
                    <input
                      type="text"
                      value={edu.yearEnd}
                      onChange={(e) => {
                        const val = e.target.value;
                        setEducations(educations.map((item) => (item.id === edu.id ? { ...item, yearEnd: val } : item)));
                      }}
                      className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-[#e2e8f0] dark:border-[#1e335a] bg-white dark:bg-[#13213e] text-[#0f172a] dark:text-white"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Experience (LinkedIn-style) */}
        <div className="bg-white dark:bg-[#13213e] p-6 sm:p-8 rounded-3xl border border-[#e2e8f0] dark:border-[#1e335a] shadow-xs space-y-4">
          <div className="flex items-center justify-between pb-2 border-b border-[#e2e8f0] dark:border-[#1e335a]">
            <div className="flex items-center gap-2">
              <Briefcase className="w-4 h-4 text-[#475569] dark:text-slate-300" />
              <h3 className="text-sm font-bold text-[#0f172a] dark:text-white">Sahne & Orkestra Deneyimleri</h3>
            </div>
            <button
              type="button"
              onClick={handleAddExperience}
              className="text-xs font-semibold text-[#f25922] hover:underline flex items-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Deneyim Ekle</span>
            </button>
          </div>

          <div className="space-y-3">
            {experiences.map((exp, idx) => (
              <div key={exp.id} className="p-4 rounded-2xl bg-[#f8fafc] dark:bg-[#0f1c38] border border-[#e2e8f0] dark:border-[#1e335a] space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[#475569] dark:text-slate-300">Pozisyon #{idx + 1}</span>
                  {experiences.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleRemoveExperience(exp.id)}
                      className="text-[#64748b] hover:text-rose-600 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] font-semibold text-[#475569] dark:text-slate-300">Görev / Rol</label>
                    <input
                      type="text"
                      value={exp.role}
                      onChange={(e) => {
                        const val = e.target.value;
                        setExperiences(experiences.map((item) => (item.id === exp.id ? { ...item, role: val } : item)));
                      }}
                      className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-[#e2e8f0] dark:border-[#1e335a] bg-white dark:bg-[#13213e] text-[#0f172a] dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold text-[#475569] dark:text-slate-300">Kurum / Topluluk</label>
                    <input
                      type="text"
                      value={exp.organization}
                      onChange={(e) => {
                        const val = e.target.value;
                        setExperiences(experiences.map((item) => (item.id === exp.id ? { ...item, organization: val } : item)));
                      }}
                      className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-[#e2e8f0] dark:border-[#1e335a] bg-white dark:bg-[#13213e] text-[#0f172a] dark:text-white"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="text-[11px] font-semibold text-[#475569] dark:text-slate-300">Tarih Aralığı</label>
                    <input
                      type="text"
                      value={exp.year}
                      onChange={(e) => {
                        const val = e.target.value;
                        setExperiences(experiences.map((item) => (item.id === exp.id ? { ...item, year: val } : item)));
                      }}
                      placeholder="Örn: 2020 - 2024"
                      className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-[#e2e8f0] dark:border-[#1e335a] bg-white dark:bg-[#13213e] text-[#0f172a] dark:text-white"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="text-[11px] font-semibold text-[#475569] dark:text-slate-300">Açıklama</label>
                    <input
                      type="text"
                      value={exp.description}
                      onChange={(e) => {
                        const val = e.target.value;
                        setExperiences(experiences.map((item) => (item.id === exp.id ? { ...item, description: val } : item)));
                      }}
                      className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-[#e2e8f0] dark:border-[#1e335a] bg-white dark:bg-[#13213e] text-[#0f172a] dark:text-white"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Repertoire / Selected Works List */}
        <div className="bg-white dark:bg-[#13213e] p-6 sm:p-8 rounded-3xl border border-[#e2e8f0] dark:border-[#1e335a] shadow-xs space-y-4">
          <div className="flex items-center gap-2 pb-2 border-b border-[#e2e8f0] dark:border-[#1e335a]">
            <Music className="w-4 h-4 text-[#475569] dark:text-slate-300" />
            <h3 className="text-sm font-bold text-[#0f172a] dark:text-white">
              {discipline === 'Müzik' ? 'Repertuvar Listesi' : 'Seçili Eserler / Projeler / Yayınlar'}
            </h3>
          </div>

          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              value={newRepertoirePiece}
              onChange={(e) => setNewRepertoirePiece(e.target.value)}
              placeholder="Yeni eser / beste ekle (Örn: Beethoven Sonata No. 14)"
              className="flex-1 px-3 py-2 text-xs rounded-xl border border-[#e2e8f0] dark:border-[#1e335a] bg-[#f8fafc] dark:bg-[#0f1c38] text-[#0f172a] dark:text-white focus:ring-2 focus:ring-[#f25922] focus:outline-none"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleAddRepertoire();
                }
              }}
            />
            <button
              type="button"
              onClick={handleAddRepertoire}
              className="px-4 py-2 bg-[#16274e] hover:bg-[#111d38] dark:bg-[#f25922] dark:hover:bg-[#d94b18] text-white rounded-xl text-xs font-bold transition-colors"
            >
              Ekle
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2">
            {repertoire.map((piece, idx) => (
              <div
                key={idx}
                className="p-3 rounded-xl bg-[#f8fafc] dark:bg-[#0f1c38] border border-[#e2e8f0] dark:border-[#1e335a] text-xs flex items-center justify-between"
              >
                <div className="flex items-center gap-2 text-[#0f172a] dark:text-slate-200 truncate">
                  <div className="w-1.5 h-1.5 rounded-full bg-[#f25922] shrink-0" />
                  <span className="truncate">{piece}</span>
                </div>
                <button
                  type="button"
                  onClick={() => handleRemoveRepertoire(idx)}
                  className="text-[#64748b] hover:text-rose-600 ml-2 transition-colors shrink-0"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom Save Action */}
        <div className="flex justify-end pt-4">
          <button
            type="button"
            onClick={handleSave}
            className="w-full sm:w-auto justify-center px-6 py-3 bg-[#16274e] hover:bg-[#111d38] dark:bg-[#f25922] dark:hover:bg-[#d94b18] text-white rounded-xl text-xs font-bold shadow-md transition-colors flex items-center gap-2"
          >
            <Save className="w-4 h-4" />
            <span>Tüm Değişiklikleri Kaydet ve Profile Dön</span>
          </button>
        </div>
      </div>
    </div>
  );
};
