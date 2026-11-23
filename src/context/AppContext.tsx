import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import {
  User,
  RoleType,
  Listing,
  ListingApplication,
  Booking,
  Review,
  IndividualProfile,
  Ensemble,
  BusinessProfile,
  VerificationRequest,
  PlatformSettings,
  MusicGenre,
  EnsembleType,
  Instrument,
  BusinessType,
  EventAnnouncement,
  EventRegistration,
  ArtDiscipline,
  Offer,
  DigitalContract,
  DisputeRecord,
  FinancialLedgerEntry,
  Organization,
  OrganizationMember,
  Venue,
  AvailabilitySlot,
  TechnicalProvider,
  TechnicalRequest,
  TechnicalQuote,
  ProductionWorkspace,
  ProjectItem,
  ProjectApplication,
  OpportunityItem,
  OpportunityApplication,
  ArtistPortfolioVersion,
  CareerRecord,
  Conversation,
  MessagingContact,
  RealtimeEvent,
  NotificationItem,
  CulturalProgram,
  OriginalsProgram,
  FeatureFlag,
  SocialGraphState,
  SocialRelationshipUser,
} from '../types';
import {
  INITIAL_INDIVIDUAL_PROFILES,
  INITIAL_ENSEMBLES,
  INITIAL_BUSINESS_PROFILES,
  INITIAL_LISTINGS,
  INITIAL_REVIEWS,
  INITIAL_SETTINGS,
  INITIAL_EVENTS,
} from '../data/seedData';
import { CommissionModel } from '../utils/businessLogic';
import { apiRequest, setSessionToken } from '../services/api';
import { realtimeClient } from '../services/realtimeClient';

export interface FilterState {
  searchQuery: string;
  discipline: ArtDiscipline | 'Tümü';
  specialty: string;
  genre: MusicGenre | 'Tümü';
  ensembleType: EnsembleType | 'Tümü';
  instrument: Instrument | 'Tümü';
  city: string;
  minBudget: number;
  maxBudget: number;
  businessType: BusinessType | 'Tümü';
  onlyVerified: boolean;
  onlyUrgent: boolean;
  sortBy: 'newest' | 'budget_desc' | 'budget_asc' | 'date_asc';
}

export const INITIAL_FILTERS: FilterState = {
  searchQuery: '',
  discipline: 'Tümü',
  specialty: 'Tümü',
  genre: 'Tümü',
  ensembleType: 'Tümü',
  instrument: 'Tümü',
  city: 'Tümü',
  minBudget: 0,
  maxBudget: 100000,
  businessType: 'Tümü',
  onlyVerified: false,
  onlyUrgent: false,
  sortBy: 'newest',
};

export type AppView =
  | 'home'
  | 'listings'
  | 'listing_detail'
  | 'artists_directory'
  | 'artist_profile'
  | 'profile_edit'
  | 'ensembles_directory'
  | 'ensemble_profile'
  | 'businesses_directory'
  | 'business_profile'
  | 'business_dashboard'
  | 'artist_dashboard'
  | 'ensemble_dashboard'
  | 'venue_dashboard'
  | 'technical_dashboard'
  | 'organizer_dashboard'
  | 'audience_dashboard'
  | 'admin_panel'
  | 'open_stage'
  | 'project_lab'
  | 'project_workspace'
  | 'production_desk'
  | 'technical_match'
  | 'opportunity_radar'
  | 'artist_studio'
  | 'career_passport'
  | 'culture_desk'
  | 'originals'
  | 'messages'
  | 'communities'
  | 'my_calendar'
  | 'feed'
  | 'how_it_works'
  | 'events'
  | 'event_detail'
  | 'contact'
  | 'about'
  | 'team';

export interface FeedRepostDraft {
  entityType: 'event' | 'listing' | 'project' | 'post';
  entityId: string;
  title: string;
  subtitle?: string;
}

export interface RuntimeConfig {
  enableDemoQuickLogin: boolean;
  paymentMode: 'sandbox' | 'production';
  hasGoogleMapsKey: boolean;
  hasGeminiKey: boolean;
}

export interface DirectorySearchPreset {
  targetView: 'artists_directory' | 'ensembles_directory' | 'businesses_directory' | 'events';
  query: string;
  city: string;
  discipline: ArtDiscipline | 'Tümü';
}

export type AsyncActionResult = Promise<{ success: boolean; error?: string; [key: string]: any }>;

interface AppContextType {
  // Settings & Navigation
  settings: PlatformSettings;
  runtimeConfig: RuntimeConfig;
  featureFlags: FeatureFlag[];
  isFlagEnabled: (key: string) => boolean;
  isLoadingBootstrap: boolean;
  refreshBootstrap: () => Promise<void>;
  activeView: AppView;
  selectedEntityId: string | null;
  navigateTo: (view: AppView, entityId?: string) => void;
  filters: FilterState;
  setFilters: React.Dispatch<React.SetStateAction<FilterState>>;
  resetFilters: () => void;
  directorySearchPreset: DirectorySearchPreset | null;
  setDirectorySearchPreset: React.Dispatch<React.SetStateAction<DirectorySearchPreset | null>>;

  // Auth & Roles
  currentUser: User;
  isAuthenticated: boolean;
  activeRole: RoleType;
  switchRole: (role: RoleType) => AsyncActionResult;
  addRoleWorkspace: (role: RoleType, extra?: { organizationName?: string; city?: string }) => AsyncActionResult;
  authModalMode: 'login' | 'register' | 'forgot_password' | null;
  setAuthModalMode: (mode: 'login' | 'register' | 'forgot_password' | null) => void;
  login: (email: string, pass: string) => AsyncActionResult;
  demoLogin: (email: string) => AsyncActionResult;
  register: (data: {
    email: string;
    password: string;
    firstName: string;
    lastName?: string;
    role: RoleType;
    phone?: string;
    organizationName?: string;
    city?: string;
  }) => AsyncActionResult;
  logout: () => Promise<void>;
  verifyEmailSandbox: (code?: string) => AsyncActionResult;
  verifyPhoneSandbox: (code?: string) => AsyncActionResult;
  resetPassword: (email: string) => AsyncActionResult;

  // Recommendations
  recommendationPeriod: 'weekly' | 'monthly';
  setRecommendationPeriod: (period: 'weekly' | 'monthly') => void;

  // Core Data
  listings: Listing[];
  applications: ListingApplication[];
  offers: Offer[];
  bookings: Booking[];
  contracts: DigitalContract[];
  disputes: DisputeRecord[];
  ledger: FinancialLedgerEntry[];
  reviews: Review[];
  artists: IndividualProfile[];
  ensembles: Ensemble[];
  businesses: BusinessProfile[];
  verifications: VerificationRequest[];
  events: EventAnnouncement[];
  eventRegistrations: EventRegistration[];
  eventRegistrationCounts: Record<string, number>;

  // Extended Ecosystem Data
  venues: Venue[];
  availabilitySlots: AvailabilitySlot[];
  technicalProviders: TechnicalProvider[];
  technicalRequests: TechnicalRequest[];
  technicalQuotes: TechnicalQuote[];
  productionWorkspaces: ProductionWorkspace[];
  projects: ProjectItem[];
  projectApplications: ProjectApplication[];
  opportunities: OpportunityItem[];
  opportunityApplications: OpportunityApplication[];
  bookmarks: Array<{ id: string; itemType: string; itemId: string }>;
  portfolios: ArtistPortfolioVersion[];
  careerRecords: CareerRecord[];
  conversations: Conversation[];
  notifications: NotificationItem[];
  organizations: Organization[];
  organizationMembers: OrganizationMember[];
  culturalPrograms: CulturalProgram[];
  originalsPrograms: OriginalsProgram[];

  // Core Marketplace Actions
  updateArtistProfile: (profileData: Partial<IndividualProfile>) => AsyncActionResult;
  updateBusinessProfile: (profileData: Partial<BusinessProfile>) => AsyncActionResult;
  updateEnsembleProfile: (ensembleId: string, profileData: Partial<Ensemble>) => AsyncActionResult;
  addEnsembleMember: (ensembleId: string, data: { name: string; instrument: string; roleTitle: string; email?: string }) => AsyncActionResult;
  respondEnsembleInvite: (ensembleId: string, memberId: string, decision: 'accept' | 'decline') => AsyncActionResult;
  removeEnsembleMember: (ensembleId: string, memberId: string) => AsyncActionResult;
  createListing: (data: Partial<Listing>) => AsyncActionResult;
  updateListing: (listingId: string, data: Partial<Listing>) => AsyncActionResult;
  closeListing: (listingId: string) => AsyncActionResult;
  applyToListing: (
    listingId: string,
    message: string,
    applicantType: 'individual' | 'ensemble',
    participatingMembers?: string[]
  ) => AsyncActionResult;
  withdrawApplication: (applicationId: string) => AsyncActionResult;
  shortlistApplication: (applicationId: string) => AsyncActionResult;
  rejectApplication: (applicationId: string) => AsyncActionResult;
  selectApplicantAndCreateBooking: (applicationId: string) => AsyncActionResult;
  createOffer: (data: { listingId: string; applicationId?: string; performerId: string; performerType: 'individual' | 'ensemble'; proposedAmount: number; scopeNotes?: string }) => AsyncActionResult;
  counterOffer: (offerId: string, proposedAmount: number, scopeNotes?: string) => AsyncActionResult;
  acceptOffer: (offerId: string) => AsyncActionResult;
  rejectOffer: (offerId: string) => AsyncActionResult;
  acceptContract: (bookingId: string) => AsyncActionResult;
  payBookingSandbox: (bookingId: string) => AsyncActionResult;
  completePerformerService: (bookingId: string) => AsyncActionResult;
  completeEmployerService: (bookingId: string) => AsyncActionResult;
  cancelBooking: (bookingId: string, reason: string) => AsyncActionResult;
  createEmergencyReplacement: (bookingId: string, urgentReason?: string) => AsyncActionResult;
  openDispute: (bookingId: string, reason: string, evidenceNotes?: string) => AsyncActionResult;
  submitReview: (
    bookingId: string,
    scores: { overall: number; quality: number; comm: number; prof: number },
    comment: string
  ) => AsyncActionResult;
  submitVerificationRequest: (
    accountType: 'artist' | 'ensemble' | 'business',
    entityName: string,
    docUrl: string
  ) => AsyncActionResult;

  // Admin & Moderation Actions
  adminApproveVerification: (requestId: string) => AsyncActionResult;
  adminRejectVerification: (requestId: string, reason: string) => AsyncActionResult;
  adminUpdateCommission: (rate: number, model: CommissionModel) => AsyncActionResult;
  adminUpdateUserRoles: (userId: string, roles: RoleType[], activeRole?: RoleType) => AsyncActionResult;
  adminUpdateUserStatus: (userId: string, status: 'active' | 'suspended') => AsyncActionResult;
  adminVerifyVenue: (venueId: string, isVerified: boolean) => AsyncActionResult;
  adminVerifyTechnicalProvider: (providerId: string, isVerified: boolean) => AsyncActionResult;
  adminVerifyEntity: (
    entityType: 'artist' | 'ensemble' | 'business' | 'community' | 'venue' | 'technical_provider',
    id: string,
    isVerified: boolean,
    note?: string
  ) => AsyncActionResult;
  moderateEntity: (entityType: 'listing' | 'event' | 'opportunity' | 'project', id: string, decision: 'approve' | 'reject') => AsyncActionResult;
  moderateEventAnnouncement: (eventId: string, status: 'published' | 'rejected') => AsyncActionResult;
  resolveDispute: (disputeId: string, outcome: 'resolved_refund' | 'resolved_release', resolutionNote: string) => AsyncActionResult;
  toggleFeatureFlag: (flagKey: string, enabled: boolean) => AsyncActionResult;
  resetAllData: () => AsyncActionResult;

  // Events & Communications
  addEventAnnouncement: (data: Omit<EventAnnouncement, 'id' | 'createdAt' | 'status'>) => AsyncActionResult;
  updateEventAnnouncement: (eventId: string, data: Partial<EventAnnouncement>) => AsyncActionResult;
  deleteEventAnnouncement: (eventId: string) => AsyncActionResult;
  registerForEvent: (
    eventId: string,
    details: { attendeeName: string; attendeeEmail: string; attendeePhone?: string; notes?: string; visibility?: 'private' | 'public_attendee' }
  ) => AsyncActionResult;
  cancelEventRegistration: (eventId: string, registrationId?: string, attendeeEmail?: string) => AsyncActionResult;
  sendContactMessage: (data: { name: string; email: string; phone?: string; subject: string; message: string }) => AsyncActionResult;
  startConversation: (data: {
    contextType: string;
    contextId: string;
    conversationType?: 'direct' | 'group' | 'context';
    title: string;
    participantUserIds: string[];
    initialMessage?: string;
  }) => AsyncActionResult;
  sendMessage: (
    conversationId: string,
    body: string,
    options?: {
      attachmentUrl?: string;
      attachmentName?: string;
      attachmentType?: string;
      replyToMessageId?: string;
    }
  ) => AsyncActionResult;
  editMessage: (conversationId: string, messageId: string, body: string) => AsyncActionResult;
  deleteMessage: (conversationId: string, messageId: string) => AsyncActionResult;
  toggleMessageReaction: (conversationId: string, messageId: string, emoji: string) => AsyncActionResult;
  markConversationRead: (conversationId: string, lastReadMessageId?: string) => Promise<void>;
  respondConversationRequest: (
    conversationId: string,
    decision: 'accept' | 'decline' | 'block'
  ) => AsyncActionResult;
  addConversationMember: (conversationId: string, userId: string) => AsyncActionResult;
  removeConversationMember: (conversationId: string, userId: string) => AsyncActionResult;
  sendTypingIndicator: (conversationId: string, isTyping: boolean) => void;
  fetchMessagingContacts: (query?: string) => Promise<MessagingContact[]>;
  wsConnected: boolean;
  onlineUserIds: string[];
  typingByConversation: Record<string, Array<{ userId: string; userName: string; expiresAt: number }>>;
  unreadMessagesCount: number;
  markNotificationRead: (id: string) => Promise<void>;
  markAllNotificationsRead: () => Promise<void>;
  toggleBookmark: (itemType: string, itemId: string) => AsyncActionResult;
  generateAiDraft: (kind: 'cover_letter' | 'listing_brief' | 'project_brief' | 'technical_rider' | 'press_bio', context: Record<string, string>) => Promise<{ text: string; source: string } | null>;

  // Stage 2 & 3 Social Graph, Privacy & Feed
  socialGraph: SocialGraphState;
  blockedUsersDetail: SocialRelationshipUser[];
  mutedUsersDetail: SocialRelationshipUser[];
  refreshSocialRelationships: () => Promise<void>;
  followUser: (targetUserId: string) => AsyncActionResult;
  unfollowUser: (targetUserId: string) => AsyncActionResult;
  blockUser: (targetUserId: string, reason?: string) => AsyncActionResult;
  unblockUser: (targetUserId: string) => AsyncActionResult;
  muteUser: (targetUserId: string) => AsyncActionResult;
  unmuteUser: (targetUserId: string) => AsyncActionResult;
  toggleArtistAvailability: (isAvailableThisWeek: boolean, availabilityNote?: string) => AsyncActionResult;
  updateArtistPrivacy: (profileVisibility: 'public' | 'private') => AsyncActionResult;
  repostDraft: FeedRepostDraft | null;
  setRepostDraft: React.Dispatch<React.SetStateAction<FeedRepostDraft | null>>;
  shareToFeed: (draft: FeedRepostDraft) => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

const EMPTY_GUEST_USER: User = {
  id: 'guest',
  email: '',
  firstName: 'Misafir',
  lastName: '',
  phone: '',
  avatarUrl: '/src/assets/images/artist_jazz_pianist_1794440057025.jpg',
  roles: ['audience'],
  activeRole: 'audience',
  isVerified: false,
  createdAt: new Date().toISOString(),
};

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [settings, setSettings] = useState<PlatformSettings>(INITIAL_SETTINGS);
  const [runtimeConfig, setRuntimeConfig] = useState<RuntimeConfig>({
    enableDemoQuickLogin: true,
    paymentMode: 'sandbox',
    hasGoogleMapsKey: false,
    hasGeminiKey: false,
  });
  const [featureFlags, setFeatureFlags] = useState<FeatureFlag[]>([]);
  const [isLoadingBootstrap, setIsLoadingBootstrap] = useState<boolean>(true);

  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authModalMode, setAuthModalMode] = useState<'login' | 'register' | 'forgot_password' | null>(null);
  const [recommendationPeriod, setRecommendationPeriod] = useState<'weekly' | 'monthly'>('weekly');
  const [activeView, setActiveView] = useState<AppView>('home');
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [filters, setFilters] = useState<FilterState>(INITIAL_FILTERS);
  const [directorySearchPreset, setDirectorySearchPreset] = useState<DirectorySearchPreset | null>(null);

  const [listings, setListings] = useState<Listing[]>(INITIAL_LISTINGS);
  const [applications, setApplications] = useState<ListingApplication[]>([]);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [contracts, setContracts] = useState<DigitalContract[]>([]);
  const [disputes, setDisputes] = useState<DisputeRecord[]>([]);
  const [ledger, setLedger] = useState<FinancialLedgerEntry[]>([]);
  const [reviews, setReviews] = useState<Review[]>(INITIAL_REVIEWS);
  const [artists, setArtists] = useState<IndividualProfile[]>(INITIAL_INDIVIDUAL_PROFILES);
  const [ensembles, setEnsembles] = useState<Ensemble[]>(INITIAL_ENSEMBLES);
  const [businesses, setBusinesses] = useState<BusinessProfile[]>(INITIAL_BUSINESS_PROFILES);
  const [verifications, setVerifications] = useState<VerificationRequest[]>([]);
  const [events, setEvents] = useState<EventAnnouncement[]>(INITIAL_EVENTS);
  const [eventRegistrations, setEventRegistrations] = useState<EventRegistration[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const raw = localStorage.getItem('ss_guest_event_registrations');
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });
  const [eventRegistrationCounts, setEventRegistrationCounts] = useState<Record<string, number>>({});

  const [venues, setVenues] = useState<Venue[]>([]);
  const [availabilitySlots, setAvailabilitySlots] = useState<AvailabilitySlot[]>([]);
  const [technicalProviders, setTechnicalProviders] = useState<TechnicalProvider[]>([]);
  const [technicalRequests, setTechnicalRequests] = useState<TechnicalRequest[]>([]);
  const [technicalQuotes, setTechnicalQuotes] = useState<TechnicalQuote[]>([]);
  const [productionWorkspaces, setProductionWorkspaces] = useState<ProductionWorkspace[]>([]);
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [projectApplications, setProjectApplications] = useState<ProjectApplication[]>([]);
  const [opportunities, setOpportunities] = useState<OpportunityItem[]>([]);
  const [opportunityApplications, setOpportunityApplications] = useState<OpportunityApplication[]>([]);
  const [bookmarks, setBookmarks] = useState<Array<{ id: string; itemType: string; itemId: string }>>([]);
  const [portfolios, setPortfolios] = useState<ArtistPortfolioVersion[]>([]);
  const [careerRecords, setCareerRecords] = useState<CareerRecord[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [organizationMembers, setOrganizationMembers] = useState<OrganizationMember[]>([]);
  const [culturalPrograms, setCulturalPrograms] = useState<CulturalProgram[]>([]);
  const [originalsPrograms, setOriginalsPrograms] = useState<OriginalsProgram[]>([]);
  const [socialGraph, setSocialGraph] = useState<SocialGraphState>({
    followingUserIds: [],
    followerUserIds: [],
    blockedByMeIds: [],
    blockedUserIds: [],
    mutedUserIds: [],
    followerCounts: {},
    followingCounts: {},
  });
  const [blockedUsersDetail, setBlockedUsersDetail] = useState<SocialRelationshipUser[]>([]);
  const [mutedUsersDetail, setMutedUsersDetail] = useState<SocialRelationshipUser[]>([]);
  const [repostDraft, setRepostDraft] = useState<FeedRepostDraft | null>(null);
  const [wsConnected, setWsConnected] = useState<boolean>(false);
  const [onlineUserIds, setOnlineUserIds] = useState<string[]>([]);
  const [typingByConversation, setTypingByConversation] = useState<
    Record<string, Array<{ userId: string; userName: string; expiresAt: number }>>
  >({});

  const isAuthenticated = Boolean(currentUser && currentUser.id !== 'guest');
  const activeRole: RoleType = currentUser?.activeRole || 'audience';

  const bootstrapSeqRef = useRef(0);
  const currentUserIdRef = useRef<string | null>(null);
  currentUserIdRef.current = isAuthenticated && currentUser ? currentUser.id : null;

  const upsertConversationState = useCallback((conv: Conversation) => {
    setConversations((prev) => {
      const next = [conv, ...prev.filter((c) => c.id !== conv.id)];
      next.sort((a, b) => (b.lastMessageAt || '').localeCompare(a.lastMessageAt || ''));
      return next;
    });
  }, []);

  const refreshSocialRelationships = useCallback(async () => {
    try {
      const rel = await apiRequest<{
        blockedUsers?: SocialRelationshipUser[];
        mutedUsers?: SocialRelationshipUser[];
      }>('/api/social/relationships');
      setBlockedUsersDetail(Array.isArray(rel.blockedUsers) ? rel.blockedUsers : []);
      setMutedUsersDetail(Array.isArray(rel.mutedUsers) ? rel.mutedUsers : []);
    } catch {
      setBlockedUsersDetail([]);
      setMutedUsersDetail([]);
    }
  }, []);

  const refreshBootstrap = useCallback(async () => {
    const seq = ++bootstrapSeqRef.current;
    try {
      const [data, artistsRes, ensemblesRes, businessesRes, listingsRes, eventsRes] = await Promise.all([
        apiRequest<any>('/api/bootstrap/core'),
        apiRequest<any>('/api/artists?limit=100').catch(() => null),
        apiRequest<any>('/api/ensembles?limit=100').catch(() => null),
        apiRequest<any>('/api/businesses?limit=100').catch(() => null),
        apiRequest<any>('/api/listings?limit=100').catch(() => null),
        apiRequest<any>('/api/events?limit=100').catch(() => null),
      ]);

      if (seq !== bootstrapSeqRef.current) return;

      if (data.settings) setSettings(data.settings);
      if (data.runtimeConfig) setRuntimeConfig(data.runtimeConfig);
      if (Array.isArray(data.featureFlags)) setFeatureFlags(data.featureFlags);
      setCurrentUser(data.user || null);
      if (!data.user) {
        setSessionToken(null);
      }

      const nextArtists = artistsRes?.items || artistsRes?.artists || data.artists;
      const nextEnsembles = ensemblesRes?.items || ensemblesRes?.ensembles || data.ensembles;
      const nextBusinesses = businessesRes?.items || businessesRes?.businesses || data.businesses;
      const nextListings = listingsRes?.items || listingsRes?.listings || data.listings;
      const nextEvents = eventsRes?.items || eventsRes?.events || data.events;

      if (Array.isArray(nextArtists)) setArtists(nextArtists);
      if (Array.isArray(nextEnsembles)) setEnsembles(nextEnsembles);
      if (Array.isArray(nextBusinesses)) setBusinesses(nextBusinesses);
      if (Array.isArray(nextListings)) setListings(nextListings);
      if (Array.isArray(data.applications)) setApplications(data.applications);
      if (Array.isArray(data.offers)) setOffers(data.offers);
      if (Array.isArray(data.bookings)) setBookings(data.bookings);
      if (Array.isArray(data.contracts)) setContracts(data.contracts);
      if (Array.isArray(data.disputes)) setDisputes(data.disputes);
      if (Array.isArray(data.ledger)) setLedger(data.ledger);
      if (Array.isArray(data.reviews)) setReviews(data.reviews);
      if (Array.isArray(data.verifications)) setVerifications(data.verifications);
      if (Array.isArray(nextEvents)) setEvents(nextEvents);
      if (data.eventRegistrationCounts && typeof data.eventRegistrationCounts === 'object') {
        setEventRegistrationCounts(data.eventRegistrationCounts);
      }
      if (data.user && Array.isArray(data.eventRegistrations)) {
        setEventRegistrations(data.eventRegistrations);
      } else if (!data.user && typeof window !== 'undefined') {
        try {
          const raw = localStorage.getItem('ss_guest_event_registrations');
          setEventRegistrations(raw ? JSON.parse(raw) : []);
        } catch {
          setEventRegistrations([]);
        }
      }
      if (Array.isArray(data.venues)) setVenues(data.venues);
      if (Array.isArray(data.availabilitySlots)) setAvailabilitySlots(data.availabilitySlots);
      if (Array.isArray(data.technicalProviders)) setTechnicalProviders(data.technicalProviders);
      if (Array.isArray(data.technicalRequests)) setTechnicalRequests(data.technicalRequests);
      if (Array.isArray(data.technicalQuotes)) setTechnicalQuotes(data.technicalQuotes);
      if (Array.isArray(data.productionWorkspaces)) setProductionWorkspaces(data.productionWorkspaces);
      if (Array.isArray(data.projects)) setProjects(data.projects);
      if (Array.isArray(data.projectApplications)) setProjectApplications(data.projectApplications);
      if (Array.isArray(data.opportunities)) setOpportunities(data.opportunities);
      if (Array.isArray(data.opportunityApplications)) setOpportunityApplications(data.opportunityApplications);
      if (Array.isArray(data.bookmarks)) setBookmarks(data.bookmarks);
      if (Array.isArray(data.portfolios)) setPortfolios(data.portfolios);
      if (Array.isArray(data.careerRecords)) setCareerRecords(data.careerRecords);
      if (Array.isArray(data.conversations)) setConversations(data.conversations);
      if (Array.isArray(data.notifications)) setNotifications(data.notifications);
      if (Array.isArray(data.organizations)) setOrganizations(data.organizations);
      if (Array.isArray(data.organizationMembers)) setOrganizationMembers(data.organizationMembers);
      if (Array.isArray(data.culturalPrograms)) setCulturalPrograms(data.culturalPrograms);
      if (Array.isArray(data.originalsPrograms)) setOriginalsPrograms(data.originalsPrograms);
      if (data.socialGraph && typeof data.socialGraph === 'object') {
        setSocialGraph({
          followingUserIds: Array.isArray(data.socialGraph.followingUserIds) ? data.socialGraph.followingUserIds : [],
          followerUserIds: Array.isArray(data.socialGraph.followerUserIds) ? data.socialGraph.followerUserIds : [],
          blockedByMeIds: Array.isArray(data.socialGraph.blockedByMeIds) ? data.socialGraph.blockedByMeIds : [],
          blockedUserIds: Array.isArray(data.socialGraph.blockedUserIds) ? data.socialGraph.blockedUserIds : [],
          mutedUserIds: Array.isArray(data.socialGraph.mutedUserIds) ? data.socialGraph.mutedUserIds : [],
          followerCounts: data.socialGraph.followerCounts || {},
          followingCounts: data.socialGraph.followingCounts || {},
        });
      }
      if (data.user) {
        await refreshSocialRelationships();
      } else {
        setBlockedUsersDetail([]);
        setMutedUsersDetail([]);
      }
    } catch {
      // Fallback safely if server not reachable yet
    } finally {
      setIsLoadingBootstrap(false);
    }
  }, [refreshSocialRelationships]);

  useEffect(() => {
    refreshBootstrap();
  }, [refreshBootstrap]);

  // Real-time WebSocket connection lifecycle & authoritative event reducer
  useEffect(() => {
    if (!isAuthenticated || !currentUser?.id) {
      realtimeClient.disconnect();
      setOnlineUserIds([]);
      setTypingByConversation({});
      return;
    }

    const unsubStatus = realtimeClient.subscribeStatus((connected) => {
      setWsConnected(connected);
    });

    const unsubEvents = realtimeClient.subscribe((event: RealtimeEvent) => {
      const myUserId = currentUserIdRef.current;

      if (event.type === 'ws:connected') {
        const list = Array.isArray(event.payload?.onlineUserIds) ? event.payload.onlineUserIds : [];
        setOnlineUserIds(list);
        return;
      }

      if (event.type === 'presence:update') {
        const uid = event.payload?.userId as string | undefined;
        const isOnline = Boolean(event.payload?.isOnline);
        if (!uid) return;
        setOnlineUserIds((prev) =>
          isOnline ? Array.from(new Set([...prev, uid])) : prev.filter((id) => id !== uid)
        );
        setConversations((prev) =>
          prev.map((c) => ({
            ...c,
            participants: c.participants?.map((p) =>
              p.userId === uid ? { ...p, isOnline } : p
            ),
          }))
        );
        return;
      }

      if (event.type === 'typing:update') {
        const { conversationId, userId, userName, isTyping } = event.payload || {};
        if (!conversationId || !userId || userId === myUserId) return;
        setTypingByConversation((prev) => {
          const existing = (prev[conversationId] || []).filter(
            (item) => item.userId !== userId && item.expiresAt > Date.now()
          );
          if (isTyping) {
            existing.push({
              userId,
              userName: userName || 'Bir kullanıcı',
              expiresAt: Date.now() + 4500,
            });
          }
          return { ...prev, [conversationId]: existing };
        });
        return;
      }

      if (
        event.type === 'message:created' ||
        event.type === 'message:updated' ||
        event.type === 'message:deleted' ||
        event.type === 'message:reaction' ||
        event.type === 'conversation:created' ||
        event.type === 'conversation:updated'
      ) {
        if (event.payload?.removed && event.payload?.conversationId) {
          setConversations((prev) => prev.filter((c) => c.id !== event.payload.conversationId));
          return;
        }
        const conv = event.payload?.conversation as Conversation | undefined;
        if (conv && conv.id) {
          if (conv.status === 'declined') {
            setConversations((prev) => prev.filter((c) => c.id !== conv.id));
          } else {
            upsertConversationState(conv);
          }
          if (event.type === 'message:created' && event.payload?.message?.senderUserId) {
            setTypingByConversation((prev) => ({
              ...prev,
              [conv.id]: (prev[conv.id] || []).filter(
                (t) => t.userId !== event.payload.message.senderUserId
              ),
            }));
          }
        }
        return;
      }

      if (event.type === 'conversation:read') {
        const { conversationId, userId, lastReadMessageId, lastReadAt } = event.payload || {};
        if (!conversationId || !userId) return;
        setConversations((prev) =>
          prev.map((c) => {
            if (c.id !== conversationId) return c;
            const nextReadBy = {
              ...(c.readBy || {}),
              [userId]: { lastReadMessageId, lastReadAt },
            };
            const nextUnread = userId === myUserId ? 0 : c.unreadCount;
            return { ...c, readBy: nextReadBy, unreadCount: nextUnread };
          })
        );
        return;
      }

      if (event.type === 'notification:created') {
        const notif = event.payload?.notification as NotificationItem | undefined;
        if (notif && notif.id) {
          setNotifications((prev) => [notif, ...prev.filter((n) => n.id !== notif.id)]);
        }
      }
    });

    realtimeClient.connect();

    const cleanupTimer = window.setInterval(() => {
      const now = Date.now();
      setTypingByConversation((prev) => {
        let changed = false;
        const next: Record<string, Array<{ userId: string; userName: string; expiresAt: number }>> = {};
        for (const [cid, list] of Object.entries(prev)) {
          const filtered = list.filter((item) => item.expiresAt > now);
          if (filtered.length !== list.length) changed = true;
          if (filtered.length > 0) next[cid] = filtered;
        }
        return changed ? next : prev;
      });
    }, 2000);

    return () => {
      window.clearInterval(cleanupTimer);
      unsubEvents();
      unsubStatus();
      realtimeClient.disconnect();
    };
  }, [isAuthenticated, currentUser?.id, upsertConversationState]);

  const isFlagEnabled = useCallback(
    (key: string) => {
      const found = featureFlags.find((f) => f.flagKey === key);
      return found ? found.enabled : true;
    },
    [featureFlags]
  );

  // Path <-> View resolution
  const resolveRouteFromPath = useCallback(
    (pathname: string): { view: AppView; entityId: string | null } => {
      const clean = pathname.replace(/\/+$/, '') || '/';
      if (clean === '/') return { view: 'home', entityId: null };
      if (clean === '/ilanlar') return { view: 'listings', entityId: null };
      if (clean.startsWith('/ilanlar/')) {
        const param = decodeURIComponent(clean.slice('/ilanlar/'.length));
        const matched = listings.find((l) => l.slug === param || l.id === param);
        return { view: 'listing_detail', entityId: matched ? matched.id : param };
      }
      if (clean === '/sanatcilar') return { view: 'artists_directory', entityId: null };
      if (clean.startsWith('/sanatcilar/')) {
        const param = decodeURIComponent(clean.slice('/sanatcilar/'.length));
        const matched = artists.find((a) => a.slug === param || a.id === param);
        return { view: 'artist_profile', entityId: matched ? matched.id : param };
      }
      if (clean === '/topluluklar') return { view: 'ensembles_directory', entityId: null };
      if (clean.startsWith('/topluluklar/')) {
        const param = decodeURIComponent(clean.slice('/topluluklar/'.length));
        const matched = ensembles.find((e) => e.slug === param || e.id === param);
        return { view: 'ensemble_profile', entityId: matched ? matched.id : param };
      }
      if (clean === '/isletmeler') return { view: 'businesses_directory', entityId: null };
      if (clean.startsWith('/isletmeler/')) {
        const param = decodeURIComponent(clean.slice('/isletmeler/'.length));
        const matched = businesses.find((b) => b.slug === param || b.id === param);
        return { view: 'business_profile', entityId: matched ? matched.id : param };
      }
      if (clean === '/etkinlikler') return { view: 'events', entityId: null };
      if (clean.startsWith('/etkinlikler/')) {
        const param = decodeURIComponent(clean.slice('/etkinlikler/'.length));
        const matched = events.find((e) => e.id === param);
        return { view: 'event_detail', entityId: matched ? matched.id : param };
      }
      if (clean === '/sahne-takvimi') return { view: 'open_stage', entityId: null };
      if (clean === '/proje-lab') return { view: 'project_lab', entityId: null };
      if (clean.startsWith('/proje-alani/')) return { view: 'project_workspace', entityId: clean.slice('/proje-alani/'.length) };
      if (clean.startsWith('/produksiyon/')) return { view: 'production_desk', entityId: clean.slice('/produksiyon/'.length) };
      if (clean === '/teknik-eslesme') return { view: 'technical_match', entityId: null };
      if (clean === '/firsat-radari') return { view: 'opportunity_radar', entityId: null };
      if (clean === '/sanatci-studyosu') return { view: 'artist_studio', entityId: null };
      if (clean === '/kariyer-pasaportu') return { view: 'career_passport', entityId: null };
      if (clean === '/kultur-masasi') return { view: 'culture_desk', entityId: null };
      if (clean === '/originals') return { view: 'originals', entityId: null };
      if (clean === '/akis') return { view: 'feed', entityId: null };
      if (clean === '/mesajlar') return { view: 'messages', entityId: null };
      if (clean === '/takvimim') return { view: 'my_calendar', entityId: null };
      if (clean === '/kanallar') return { view: 'communities', entityId: null };
      if (clean.startsWith('/kanallar/')) {
        const param = decodeURIComponent(clean.slice('/kanallar/'.length));
        return { view: 'communities', entityId: param };
      }
      if (clean === '/iletisim') return { view: 'contact', entityId: null };
      if (clean === '/hakkimizda') return { view: 'about', entityId: null };
      if (clean === '/ekibimiz') return { view: 'team', entityId: null };
      if (clean === '/nasil-calisir') return { view: 'how_it_works', entityId: null };
      if (clean === '/profil-duzenle') return { view: 'profile_edit', entityId: null };
      if (clean === '/panel/isletme') return { view: 'business_dashboard', entityId: null };
      if (clean === '/panel/sanatci') return { view: 'artist_dashboard', entityId: null };
      if (clean === '/panel/topluluk') return { view: 'ensemble_dashboard', entityId: null };
      if (clean === '/panel/mekan') return { view: 'venue_dashboard', entityId: null };
      if (clean === '/panel/teknik') return { view: 'technical_dashboard', entityId: null };
      if (clean === '/panel/organizator') return { view: 'organizer_dashboard', entityId: null };
      if (clean === '/panel/izleyici') return { view: 'audience_dashboard', entityId: null };
      if (clean === '/panel/yonetim') return { view: 'admin_panel', entityId: null };
      return { view: 'home', entityId: null };
    },
    [listings, artists, ensembles, businesses]
  );

  const buildPathForRoute = (view: AppView, entityId?: string | null): string => {
    switch (view) {
      case 'home': return '/';
      case 'listings': return '/ilanlar';
      case 'listing_detail': {
        const found = listings.find((l) => l.id === entityId || l.slug === entityId);
        return `/ilanlar/${found?.slug || entityId || ''}`;
      }
      case 'artists_directory': return '/sanatcilar';
      case 'artist_profile': {
        const found = artists.find((a) => a.id === entityId || a.slug === entityId);
        return `/sanatcilar/${found?.slug || entityId || ''}`;
      }
      case 'ensembles_directory': return '/topluluklar';
      case 'ensemble_profile': {
        const found = ensembles.find((e) => e.id === entityId || e.slug === entityId);
        return `/topluluklar/${found?.slug || entityId || ''}`;
      }
      case 'businesses_directory': return '/isletmeler';
      case 'business_profile': {
        const found = businesses.find((b) => b.id === entityId || b.slug === entityId);
        return `/isletmeler/${found?.slug || entityId || ''}`;
      }
      case 'events': return '/etkinlikler';
      case 'event_detail': return entityId ? `/etkinlikler/${entityId}` : '/etkinlikler';
      case 'open_stage': return '/sahne-takvimi';
      case 'project_lab': return '/proje-lab';
      case 'project_workspace': return `/proje-alani/${entityId || ''}`;
      case 'production_desk': return `/produksiyon/${entityId || ''}`;
      case 'technical_match': return '/teknik-eslesme';
      case 'opportunity_radar': return '/firsat-radari';
      case 'artist_studio': return '/sanatci-studyosu';
      case 'career_passport': return '/kariyer-pasaportu';
      case 'culture_desk': return '/kultur-masasi';
      case 'originals': return '/originals';
      case 'feed': return '/akis';
      case 'messages': return '/mesajlar';
      case 'my_calendar': return '/takvimim';
      case 'communities': return entityId ? `/kanallar/${entityId}` : '/kanallar';
      case 'contact': return '/iletisim';
      case 'about': return '/hakkimizda';
      case 'team': return '/ekibimiz';
      case 'how_it_works': return '/nasil-calisir';
      case 'profile_edit': return '/profil-duzenle';
      case 'business_dashboard': return '/panel/isletme';
      case 'artist_dashboard': return '/panel/sanatci';
      case 'ensemble_dashboard': return '/panel/topluluk';
      case 'venue_dashboard': return '/panel/mekan';
      case 'technical_dashboard': return '/panel/teknik';
      case 'organizer_dashboard': return '/panel/organizator';
      case 'audience_dashboard': return '/panel/izleyici';
      case 'admin_panel': return '/panel/yonetim';
      default: return '/';
    }
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const initial = resolveRouteFromPath(window.location.pathname);
    if (initial.view !== 'home') {
      setActiveView(initial.view);
      setSelectedEntityId(initial.entityId);
    }
    const handlePopState = () => {
      const next = resolveRouteFromPath(window.location.pathname);
      setActiveView(next.view);
      setSelectedEntityId(next.entityId);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const navigateTo = (view: AppView, entityId?: string) => {
    setActiveView(view);
    if (entityId) {
      setSelectedEntityId(entityId);
    } else if (
      !['listing_detail', 'artist_profile', 'ensemble_profile', 'business_profile', 'event_detail', 'project_workspace', 'production_desk', 'career_passport'].includes(view)
    ) {
      setSelectedEntityId(null);
    }
    if (typeof window !== 'undefined') {
      const nextPath = buildPathForRoute(view, entityId ?? null);
      if (window.location.pathname !== nextPath) {
        window.history.pushState({}, '', nextPath);
      }
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const resetFilters = () => setFilters(INITIAL_FILTERS);

  const wrap = async (fn: () => Promise<any>, shouldRefresh = true) => {
    try {
      const res = await fn();
      if (shouldRefresh) await refreshBootstrap();
      return { success: true, ...res };
    } catch (err: any) {
      return { success: false, error: err?.message || 'İşlem sırasında bir hata oluştu.' };
    }
  };

  const login = (email: string, password: string) =>
    wrap(async () => {
      const data = await apiRequest('/api/auth/login', {
        method: 'POST',
        body: { email, password },
      });
      bootstrapSeqRef.current++;
      if (data.sessionToken) setSessionToken(data.sessionToken);
      setCurrentUser(data.user);
      setAuthModalMode(null);
      return data;
    });

  const demoLogin = (email: string) =>
    wrap(async () => {
      const data = await apiRequest('/api/auth/demo-login', {
        method: 'POST',
        body: { email },
      });
      bootstrapSeqRef.current++;
      if (data.sessionToken) setSessionToken(data.sessionToken);
      setCurrentUser(data.user);
      setAuthModalMode(null);
      return data;
    });

  const register = (data: {
    email: string;
    password: string;
    firstName: string;
    lastName?: string;
    role: RoleType;
    phone?: string;
    organizationName?: string;
    city?: string;
  }) =>
    wrap(async () => {
      const res = await apiRequest('/api/auth/register', {
        method: 'POST',
        body: data,
      });
      bootstrapSeqRef.current++;
      if (res.sessionToken) setSessionToken(res.sessionToken);
      setCurrentUser(res.user);
      setAuthModalMode(null);
      return res;
    });

  const logout = async () => {
    bootstrapSeqRef.current++;
    try {
      await apiRequest('/api/auth/logout', { method: 'POST' });
    } catch {
      // ignore
    }
    setSessionToken(null);
    setCurrentUser(null);
    await refreshBootstrap();
    navigateTo('home');
  };

  const switchRole = (role: RoleType) =>
    wrap(async () => {
      const data = await apiRequest('/api/auth/switch-role', {
        method: 'POST',
        body: { role },
      });
      setCurrentUser(data.user);
      return data;
    });

  const addRoleWorkspace = (role: RoleType, extra?: { organizationName?: string; city?: string }) =>
    wrap(async () => {
      const data = await apiRequest('/api/auth/add-role', {
        method: 'POST',
        body: { role, ...(extra || {}) },
      });
      setCurrentUser(data.user);
      return data;
    });

  const verifyEmailSandbox = (code = 'SANDBOX-OK') =>
    wrap(() => apiRequest('/api/auth/verify-email', { method: 'POST', body: { code } }));

  const verifyPhoneSandbox = (code = 'SANDBOX-OK') =>
    wrap(() => apiRequest('/api/auth/verify-phone', { method: 'POST', body: { code } }));

  const resetPassword = (email: string) =>
    wrap(() => apiRequest('/api/auth/forgot-password', { method: 'POST', body: { email } }), false);

  const updateArtistProfile = (profileData: Partial<IndividualProfile>) =>
    wrap(() => apiRequest('/api/artists/me', { method: 'PATCH', body: profileData }));

  const toggleArtistAvailability = (isAvailableThisWeek: boolean, availabilityNote?: string) =>
    wrap(() =>
      apiRequest('/api/artists/me/availability', {
        method: 'PATCH',
        body: { isAvailableThisWeek, availabilityNote },
      })
    );

  const updateArtistPrivacy = (profileVisibility: 'public' | 'private') =>
    wrap(() =>
      apiRequest('/api/artists/me/privacy', {
        method: 'PATCH',
        body: { profileVisibility },
      })
    );

  const shareToFeed = (draft: FeedRepostDraft) => {
    setRepostDraft(draft);
    navigateTo('feed');
  };

  const applySocialSummary = (targetUserId: string, summary?: any, kind?: 'follow' | 'unfollow' | 'block' | 'unblock' | 'mute' | 'unmute') => {
    setSocialGraph((prev) => {
      const nextFollowing =
        kind === 'follow'
          ? Array.from(new Set([...prev.followingUserIds, targetUserId]))
          : kind === 'unfollow' || kind === 'block'
          ? prev.followingUserIds.filter((id) => id !== targetUserId)
          : prev.followingUserIds;
      const nextBlockedByMe =
        kind === 'block'
          ? Array.from(new Set([...prev.blockedByMeIds, targetUserId]))
          : kind === 'unblock'
          ? prev.blockedByMeIds.filter((id) => id !== targetUserId)
          : prev.blockedByMeIds;
      const nextBlocked =
        kind === 'block'
          ? Array.from(new Set([...prev.blockedUserIds, targetUserId]))
          : kind === 'unblock'
          ? prev.blockedUserIds.filter((id) => id !== targetUserId)
          : prev.blockedUserIds;
      const nextMuted =
        kind === 'mute'
          ? Array.from(new Set([...prev.mutedUserIds, targetUserId]))
          : kind === 'unmute'
          ? prev.mutedUserIds.filter((id) => id !== targetUserId)
          : prev.mutedUserIds;

      const nextFollowerCounts = { ...prev.followerCounts };
      const nextFollowingCounts = { ...prev.followingCounts };
      if (summary && typeof summary.followersCount === 'number') {
        nextFollowerCounts[targetUserId] = summary.followersCount;
      }
      if (summary && typeof summary.followingCount === 'number') {
        nextFollowingCounts[targetUserId] = summary.followingCount;
      }

      return {
        ...prev,
        followingUserIds: nextFollowing,
        blockedByMeIds: nextBlockedByMe,
        blockedUserIds: nextBlocked,
        mutedUserIds: nextMuted,
        followerCounts: nextFollowerCounts,
        followingCounts: nextFollowingCounts,
      };
    });
  };

  const followUser = (targetUserId: string) =>
    wrap(async () => {
      const res = await apiRequest(`/api/social/follow/${targetUserId}`, { method: 'POST' });
      applySocialSummary(targetUserId, res?.summary, 'follow');
      return res;
    });

  const unfollowUser = (targetUserId: string) =>
    wrap(async () => {
      const res = await apiRequest(`/api/social/follow/${targetUserId}`, { method: 'DELETE' });
      applySocialSummary(targetUserId, res?.summary, 'unfollow');
      return res;
    });

  const blockUser = (targetUserId: string, reason?: string) =>
    wrap(async () => {
      const res = await apiRequest(`/api/social/block/${targetUserId}`, { method: 'POST', body: { reason } });
      applySocialSummary(targetUserId, res?.summary, 'block');
      await refreshSocialRelationships();
      return res;
    });

  const unblockUser = (targetUserId: string) =>
    wrap(async () => {
      const res = await apiRequest(`/api/social/block/${targetUserId}`, { method: 'DELETE' });
      applySocialSummary(targetUserId, res?.summary, 'unblock');
      await refreshSocialRelationships();
      return res;
    });

  const muteUser = (targetUserId: string) =>
    wrap(async () => {
      const res = await apiRequest(`/api/social/mute/${targetUserId}`, { method: 'POST' });
      applySocialSummary(targetUserId, res?.summary, 'mute');
      await refreshSocialRelationships();
      return res;
    });

  const unmuteUser = (targetUserId: string) =>
    wrap(async () => {
      const res = await apiRequest(`/api/social/mute/${targetUserId}`, { method: 'DELETE' });
      applySocialSummary(targetUserId, res?.summary, 'unmute');
      await refreshSocialRelationships();
      return res;
    });

  const updateBusinessProfile = (profileData: Partial<BusinessProfile>) =>
    wrap(() => apiRequest('/api/businesses/me', { method: 'PATCH', body: profileData }));

  const updateEnsembleProfile = (ensembleId: string, profileData: Partial<Ensemble>) =>
    wrap(() => apiRequest(`/api/ensembles/${ensembleId}`, { method: 'PATCH', body: profileData }));

  const addEnsembleMember = (ensembleId: string, data: { name: string; instrument: string; roleTitle: string; email?: string }) =>
    wrap(() => apiRequest(`/api/ensembles/${ensembleId}/members`, { method: 'POST', body: data }));

  const respondEnsembleInvite = (ensembleId: string, memberId: string, decision: 'accept' | 'decline') =>
    wrap(() => apiRequest(`/api/ensembles/${ensembleId}/members/${memberId}/respond`, { method: 'POST', body: { decision } }));

  const removeEnsembleMember = (ensembleId: string, memberId: string) =>
    wrap(() => apiRequest(`/api/ensembles/${ensembleId}/members/${memberId}`, { method: 'DELETE' }));

  const createListing = (data: Partial<Listing>) =>
    wrap(async () => {
      const res = await apiRequest('/api/listings', { method: 'POST', body: data });
      return { listingId: res.listing?.id, listing: res.listing };
    });

  const updateListing = (listingId: string, data: Partial<Listing>) =>
    wrap(async () => {
      const res = await apiRequest(`/api/listings/${listingId}`, { method: 'PATCH', body: data });
      return { listing: res.listing };
    });

  const closeListing = (listingId: string) =>
    wrap(() => apiRequest(`/api/listings/${listingId}`, { method: 'DELETE' }));

  const applyToListing = (
    listingId: string,
    message: string,
    applicantType: 'individual' | 'ensemble',
    participatingMembers?: string[]
  ) =>
    wrap(() =>
      apiRequest('/api/applications', {
        method: 'POST',
        body: { listingId, message, applicantType, participatingMembers },
      })
    );

  const withdrawApplication = (applicationId: string) =>
    wrap(() => apiRequest(`/api/applications/${applicationId}`, { method: 'DELETE' }));

  const shortlistApplication = (applicationId: string) =>
    wrap(() => apiRequest(`/api/applications/${applicationId}/status`, { method: 'PATCH', body: { status: 'shortlisted' } }));

  const rejectApplication = (applicationId: string) =>
    wrap(() => apiRequest(`/api/applications/${applicationId}/status`, { method: 'PATCH', body: { status: 'rejected' } }));

  const selectApplicantAndCreateBooking = (applicationId: string) =>
    wrap(async () => {
      const res = await apiRequest(`/api/applications/${applicationId}/status`, {
        method: 'PATCH',
        body: { status: 'selected' },
      });
      return { bookingId: res.booking?.id, booking: res.booking };
    });

  const createOffer = (data: {
    listingId: string;
    applicationId?: string;
    performerId: string;
    performerType: 'individual' | 'ensemble';
    proposedAmount: number;
    scopeNotes?: string;
  }) => wrap(() => apiRequest('/api/offers', { method: 'POST', body: data }));

  const counterOffer = (offerId: string, proposedAmount: number, scopeNotes?: string) =>
    wrap(() => apiRequest(`/api/offers/${offerId}/counter`, { method: 'POST', body: { proposedAmount, scopeNotes } }));

  const acceptOffer = (offerId: string) =>
    wrap(() => apiRequest(`/api/offers/${offerId}/accept`, { method: 'POST' }));

  const rejectOffer = (offerId: string) =>
    wrap(() => apiRequest(`/api/offers/${offerId}/reject`, { method: 'POST' }));

  const acceptContract = (bookingId: string) =>
    wrap(() => apiRequest(`/api/bookings/${bookingId}/accept-contract`, { method: 'POST' }));

  const payBookingSandbox = (bookingId: string) =>
    wrap(() => apiRequest(`/api/bookings/${bookingId}/checkout`, { method: 'POST', body: { confirmSandboxNow: true } }));

  const completePerformerService = (bookingId: string) =>
    wrap(() => apiRequest(`/api/bookings/${bookingId}/complete`, { method: 'POST' }));

  const completeEmployerService = (bookingId: string) =>
    wrap(() => apiRequest(`/api/bookings/${bookingId}/complete`, { method: 'POST' }));

  const cancelBooking = (bookingId: string, reason: string) =>
    wrap(() => apiRequest(`/api/bookings/${bookingId}/cancel`, { method: 'POST', body: { reason } }));

  const createEmergencyReplacement = (bookingId: string, urgentReason?: string) =>
    wrap(async () => {
      const res = await apiRequest(`/api/bookings/${bookingId}/emergency-replacement`, {
        method: 'POST',
        body: { urgentReason },
      });
      return { newListingId: res.listing?.id, listing: res.listing };
    });

  const openDispute = (bookingId: string, reason: string, evidenceNotes = '') =>
    wrap(() => apiRequest(`/api/bookings/${bookingId}/dispute`, { method: 'POST', body: { reason, evidenceNotes } }));

  const submitReview = (
    bookingId: string,
    scores: { overall: number; quality: number; comm: number; prof: number },
    comment: string
  ) =>
    wrap(() =>
      apiRequest(`/api/bookings/${bookingId}/reviews`, {
        method: 'POST',
        body: {
          scoreOverall: scores.overall,
          scoreQuality: scores.quality,
          scoreCommunication: scores.comm,
          scoreProfessionalism: scores.prof,
          comment,
        },
      })
    );

  const submitVerificationRequest = (
    accountType: 'artist' | 'ensemble' | 'business',
    entityName: string,
    docUrl: string
  ) =>
    wrap(() =>
      apiRequest('/api/auth/verifications', {
        method: 'POST',
        body: {
          accountType,
          entityName,
          documents: [{ title: 'Resmî Belge / Portfolyo', url: docUrl, type: 'pdf' }],
        },
      })
    );

  const adminApproveVerification = (requestId: string) =>
    wrap(() => apiRequest(`/api/admin/verifications/${requestId}/approve`, { method: 'POST' }));

  const adminRejectVerification = (requestId: string, reason: string) =>
    wrap(() => apiRequest(`/api/admin/verifications/${requestId}/reject`, { method: 'POST', body: { note: reason } }));

  const adminUpdateCommission = (rate: number, model: CommissionModel) =>
    wrap(() => apiRequest('/api/admin/settings', { method: 'PATCH', body: { commissionRate: rate, commissionModel: model } }));

  const adminUpdateUserRoles = (userId: string, roles: RoleType[], activeRole?: RoleType) =>
    wrap(() => apiRequest(`/api/admin/users/${userId}/roles`, { method: 'PATCH', body: { roles, activeRole } }));

  const adminUpdateUserStatus = (userId: string, status: 'active' | 'suspended') =>
    wrap(() => apiRequest(`/api/admin/users/${userId}/status`, { method: 'PATCH', body: { status } }));

  const adminVerifyVenue = (venueId: string, isVerified: boolean) =>
    wrap(() => apiRequest(`/api/admin/venues/${venueId}/verify`, { method: 'POST', body: { isVerified } }));

  const adminVerifyTechnicalProvider = (providerId: string, isVerified: boolean) =>
    wrap(() => apiRequest(`/api/admin/technical-providers/${providerId}/verify`, { method: 'POST', body: { isVerified } }));

  const adminVerifyEntity = (
    entityType: 'artist' | 'ensemble' | 'business' | 'community' | 'venue' | 'technical_provider',
    id: string,
    isVerified: boolean,
    note?: string
  ) =>
    wrap(() =>
      apiRequest(`/api/admin/entities/${entityType}/${id}/verify`, {
        method: 'POST',
        body: { isVerified, note },
      })
    );

  const moderateEntity = (entityType: 'listing' | 'event' | 'opportunity' | 'project', id: string, decision: 'approve' | 'reject') =>
    wrap(() => apiRequest(`/api/admin/moderation/${entityType}/${id}`, { method: 'POST', body: { decision } }));

  const moderateEventAnnouncement = (eventId: string, status: 'published' | 'rejected') =>
    moderateEntity('event', eventId, status === 'published' ? 'approve' : 'reject');

  const resolveDispute = (disputeId: string, outcome: 'resolved_refund' | 'resolved_release', resolutionNote: string) =>
    wrap(() => apiRequest(`/api/admin/disputes/${disputeId}/resolve`, { method: 'POST', body: { outcome, resolutionNote } }));

  const toggleFeatureFlag = (flagKey: string, enabled: boolean) =>
    wrap(() => apiRequest(`/api/admin/feature-flags/${flagKey}`, { method: 'PATCH', body: { enabled } }));

  const resetAllData = () =>
    wrap(async () => {
      const res = await apiRequest('/api/admin/reset-demo', { method: 'POST' });
      navigateTo('home');
      return res;
    });

  const addEventAnnouncement = (data: Omit<EventAnnouncement, 'id' | 'createdAt' | 'status'>) =>
    wrap(async () => {
      const res = await apiRequest('/api/events', { method: 'POST', body: data });
      return { eventId: res.event?.id, event: res.event };
    });

  const updateEventAnnouncement = (eventId: string, data: Partial<EventAnnouncement>) =>
    wrap(() => apiRequest(`/api/events/${eventId}`, { method: 'PATCH', body: data }));

  const deleteEventAnnouncement = (eventId: string) =>
    wrap(() => apiRequest(`/api/events/${eventId}`, { method: 'DELETE' }));

  const registerForEvent = async (
    eventId: string,
    details: { attendeeName: string; attendeeEmail: string; attendeePhone?: string; notes?: string; visibility?: 'private' | 'public_attendee' }
  ) => {
    try {
      const res = await apiRequest<{ registration: EventRegistration; registrationCount: number }>(
        `/api/events/${eventId}/register`,
        { method: 'POST', body: details }
      );
      if (res.registration) {
        setEventRegistrations((prev) => {
          const next = [res.registration, ...prev.filter((r) => r.eventId !== eventId)];
          if (!isAuthenticated && typeof window !== 'undefined') {
            try {
              localStorage.setItem('ss_guest_event_registrations', JSON.stringify(next));
            } catch {
              // ignore storage errors
            }
          }
          return next;
        });
      }
      if (typeof res.registrationCount === 'number') {
        setEventRegistrationCounts((prev) => ({ ...prev, [eventId]: res.registrationCount }));
      }
      return { success: true, ...res };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Etkinlik kaydı tamamlanamadı.' };
    }
  };

  const cancelEventRegistration = async (
    eventId: string,
    registrationId?: string,
    attendeeEmail?: string
  ) => {
    try {
      const res = await apiRequest<{ success: boolean; registrationCount: number }>(
        `/api/events/${eventId}/register`,
        {
          method: 'DELETE',
          body: { registrationId, attendeeEmail },
        }
      );
      setEventRegistrations((prev) => {
        const next = prev.filter((r) =>
          registrationId ? r.id !== registrationId : r.eventId !== eventId
        );
        if (!isAuthenticated && typeof window !== 'undefined') {
          try {
            localStorage.setItem('ss_guest_event_registrations', JSON.stringify(next));
          } catch {
            // ignore storage errors
          }
        }
        return next;
      });
      if (typeof res.registrationCount === 'number') {
        setEventRegistrationCounts((prev) => ({ ...prev, [eventId]: res.registrationCount }));
      }
      return { ...res, success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Etkinlik kaydı iptal edilemedi.' };
    }
  };

  const sendContactMessage = (data: { name: string; email: string; phone?: string; subject: string; message: string }) =>
    wrap(() => apiRequest('/api/contact', { method: 'POST', body: data }), false);

  const startConversation = async (data: {
    contextType: string;
    contextId: string;
    conversationType?: 'direct' | 'group' | 'context';
    title: string;
    participantUserIds: string[];
    initialMessage?: string;
  }) => {
    try {
      const res = await apiRequest<{ conversation: Conversation; existing?: boolean }>(
        '/api/conversations',
        { method: 'POST', body: data }
      );
      if (res.conversation) {
        upsertConversationState(res.conversation);
      }
      return { success: true, ...res };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Görüşme başlatılamadı.' };
    }
  };

  const sendMessage = async (
    conversationId: string,
    body: string,
    options?: {
      attachmentUrl?: string;
      attachmentName?: string;
      attachmentType?: string;
      replyToMessageId?: string;
    }
  ) => {
    try {
      const res = await apiRequest<{ conversation: Conversation }>(
        `/api/conversations/${conversationId}/messages`,
        {
          method: 'POST',
          body: {
            body,
            ...(options || {}),
          },
        }
      );
      if (res.conversation) {
        upsertConversationState(res.conversation);
      }
      return { success: true, ...res };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Mesaj gönderilemedi.' };
    }
  };

  const editMessage = async (conversationId: string, messageId: string, body: string) => {
    try {
      const res = await apiRequest<{ conversation: Conversation }>(
        `/api/conversations/${conversationId}/messages/${messageId}`,
        { method: 'PATCH', body: { body } }
      );
      if (res.conversation) upsertConversationState(res.conversation);
      return { success: true, ...res };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Mesaj düzenlenemedi.' };
    }
  };

  const deleteMessage = async (conversationId: string, messageId: string) => {
    try {
      const res = await apiRequest<{ conversation: Conversation }>(
        `/api/conversations/${conversationId}/messages/${messageId}`,
        { method: 'DELETE' }
      );
      if (res.conversation) upsertConversationState(res.conversation);
      return { success: true, ...res };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Mesaj silinemedi.' };
    }
  };

  const toggleMessageReaction = async (
    conversationId: string,
    messageId: string,
    emoji: string
  ) => {
    try {
      const res = await apiRequest<{ conversation: Conversation }>(
        `/api/conversations/${conversationId}/messages/${messageId}/reactions`,
        { method: 'POST', body: { emoji } }
      );
      if (res.conversation) upsertConversationState(res.conversation);
      return { success: true, ...res };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Tepki eklenemedi.' };
    }
  };

  const markConversationRead = async (conversationId: string, lastReadMessageId?: string) => {
    try {
      const res = await apiRequest<{ conversation: Conversation }>(
        `/api/conversations/${conversationId}/read`,
        { method: 'POST', body: { lastReadMessageId } }
      );
      if (res.conversation) {
        upsertConversationState(res.conversation);
      }
    } catch {
      // ignore read sync errors silently
    }
  };

  const respondConversationRequest = async (
    conversationId: string,
    decision: 'accept' | 'decline' | 'block'
  ) => {
    try {
      const res = await apiRequest<{ conversation: Conversation }>(
        `/api/conversations/${conversationId}/respond`,
        { method: 'POST', body: { decision } }
      );
      if (decision === 'accept' && res.conversation) {
        upsertConversationState(res.conversation);
      } else {
        setConversations((prev) => prev.filter((c) => c.id !== conversationId));
        if (decision === 'block') {
          await refreshBootstrap();
        }
      }
      return { success: true, ...res };
    } catch (err: any) {
      return { success: false, error: err?.message || 'İstek yanıtlanamadı.' };
    }
  };

  const addConversationMember = async (conversationId: string, userId: string) => {
    try {
      const res = await apiRequest<{ conversation: Conversation }>(
        `/api/conversations/${conversationId}/members`,
        { method: 'POST', body: { userId } }
      );
      if (res.conversation) upsertConversationState(res.conversation);
      return { success: true, ...res };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Üye eklenemedi.' };
    }
  };

  const removeConversationMember = async (conversationId: string, userId: string) => {
    try {
      const res = await apiRequest<{ conversation: Conversation }>(
        `/api/conversations/${conversationId}/members/${userId}`,
        { method: 'DELETE' }
      );
      if (userId === currentUser?.id) {
        setConversations((prev) => prev.filter((c) => c.id !== conversationId));
      } else if (res.conversation) {
        upsertConversationState(res.conversation);
      }
      return { success: true, ...res };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Üye gruptan çıkarılamadı.' };
    }
  };

  const sendTypingIndicator = useCallback((conversationId: string, isTyping: boolean) => {
    realtimeClient.sendTyping(conversationId, isTyping);
  }, []);

  const fetchMessagingContacts = useCallback(async (query = ''): Promise<MessagingContact[]> => {
    try {
      const res = await apiRequest<{ contacts: MessagingContact[] }>(
        `/api/conversations/contacts${query ? `?q=${encodeURIComponent(query)}` : ''}`
      );
      return Array.isArray(res.contacts) ? res.contacts : [];
    } catch {
      return [];
    }
  }, []);

  const unreadMessagesCount = conversations.reduce((sum, c) => sum + (c.unreadCount || 0), 0);

  const markNotificationRead = async (id: string) => {
    try {
      await apiRequest(`/api/notifications/${id}/read`, { method: 'POST' });
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)));
    } catch {
      // ignore
    }
  };

  const markAllNotificationsRead = async () => {
    try {
      await apiRequest('/api/notifications/read-all', { method: 'POST' });
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    } catch {
      // ignore
    }
  };

  const toggleBookmark = (itemType: string, itemId: string) =>
    wrap(() => apiRequest('/api/bookmarks/toggle', { method: 'POST', body: { itemType, itemId } }));

  const generateAiDraft = async (
    kind: 'cover_letter' | 'listing_brief' | 'project_brief' | 'technical_rider' | 'press_bio',
    context: Record<string, string>
  ) => {
    try {
      return await apiRequest<{ text: string; source: string }>('/api/ai/draft', {
        method: 'POST',
        body: { kind, context },
      });
    } catch {
      return null;
    }
  };

  return (
    <AppContext.Provider
      value={{
        settings,
        runtimeConfig,
        featureFlags,
        isFlagEnabled,
        isLoadingBootstrap,
        refreshBootstrap,
        activeView,
        selectedEntityId,
        navigateTo,
        filters,
        setFilters,
        resetFilters,
        directorySearchPreset,
        setDirectorySearchPreset,
        currentUser: currentUser || EMPTY_GUEST_USER,
        isAuthenticated,
        activeRole,
        switchRole,
        addRoleWorkspace,
        authModalMode,
        setAuthModalMode,
        login,
        demoLogin,
        register,
        logout,
        verifyEmailSandbox,
        verifyPhoneSandbox,
        resetPassword,
        recommendationPeriod,
        setRecommendationPeriod,
        listings,
        applications,
        offers,
        bookings,
        contracts,
        disputes,
        ledger,
        reviews,
        artists,
        ensembles,
        businesses,
        verifications,
        events,
        eventRegistrations,
        eventRegistrationCounts,
        venues,
        availabilitySlots,
        technicalProviders,
        technicalRequests,
        technicalQuotes,
        productionWorkspaces,
        projects,
        projectApplications,
        opportunities,
        opportunityApplications,
        bookmarks,
        portfolios,
        careerRecords,
        conversations,
        notifications,
        organizations,
        organizationMembers,
        culturalPrograms,
        originalsPrograms,
        updateArtistProfile,
        updateBusinessProfile,
        updateEnsembleProfile,
        addEnsembleMember,
        respondEnsembleInvite,
        removeEnsembleMember,
        createListing,
        updateListing,
        closeListing,
        applyToListing,
        withdrawApplication,
        shortlistApplication,
        rejectApplication,
        selectApplicantAndCreateBooking,
        createOffer,
        counterOffer,
        acceptOffer,
        rejectOffer,
        acceptContract,
        payBookingSandbox,
        completePerformerService,
        completeEmployerService,
        cancelBooking,
        createEmergencyReplacement,
        openDispute,
        submitReview,
        submitVerificationRequest,
        adminApproveVerification,
        adminRejectVerification,
        adminUpdateCommission,
        adminUpdateUserRoles,
        adminUpdateUserStatus,
        adminVerifyVenue,
        adminVerifyTechnicalProvider,
        adminVerifyEntity,
        moderateEntity,
        moderateEventAnnouncement,
        resolveDispute,
        toggleFeatureFlag,
        resetAllData,
        addEventAnnouncement,
        updateEventAnnouncement,
        deleteEventAnnouncement,
        registerForEvent,
        cancelEventRegistration,
        sendContactMessage,
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
        markNotificationRead,
        markAllNotificationsRead,
        toggleBookmark,
        generateAiDraft,
        socialGraph,
        blockedUsersDetail,
        mutedUsersDetail,
        refreshSocialRelationships,
        followUser,
        unfollowUser,
        blockUser,
        unblockUser,
        muteUser,
        unmuteUser,
        toggleArtistAvailability,
        updateArtistPrivacy,
        repostDraft,
        setRepostDraft,
        shareToFeed,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
};
