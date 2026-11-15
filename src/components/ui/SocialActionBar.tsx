import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { UserPlus, UserCheck, Ban, VolumeX, Volume2, Users } from 'lucide-react';

interface SocialActionBarProps {
  targetUserId: string;
  targetName: string;
  followersCount?: number;
  followingCount?: number;
  onBlocked?: () => void;
  hideStats?: boolean;
  statsOnly?: boolean;
}

export const SocialActionBar: React.FC<SocialActionBarProps> = ({
  targetUserId,
  targetName,
  followersCount,
  followingCount,
  onBlocked,
  hideStats = false,
  statsOnly = false,
}) => {
  const {
    currentUser,
    isAuthenticated,
    setAuthModalMode,
    socialGraph,
    followUser,
    unfollowUser,
    blockUser,
    unblockUser,
    muteUser,
    unmuteUser,
  } = useApp();

  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const isOwn = isAuthenticated && currentUser.id === targetUserId;
  const isFollowing = socialGraph.followingUserIds.includes(targetUserId);
  const isBlockedByMe = socialGraph.blockedByMeIds.includes(targetUserId);
  const isMuted = socialGraph.mutedUserIds.includes(targetUserId);
  const resolvedFollowers =
    socialGraph.followerCounts[targetUserId] ?? followersCount ?? 0;
  const resolvedFollowing =
    socialGraph.followingCounts[targetUserId] ?? followingCount ?? 0;

  const handleFollowToggle = async () => {
    if (!isAuthenticated) {
      setAuthModalMode('login');
      return;
    }
    setBusy(true);
    setFeedback(null);
    const res = isFollowing
      ? await unfollowUser(targetUserId)
      : await followUser(targetUserId);
    setBusy(false);
    if (!res.success && res.error) {
      setFeedback(res.error);
    }
  };

  const handleMuteToggle = async () => {
    if (!isAuthenticated) {
      setAuthModalMode('login');
      return;
    }
    setBusy(true);
    setFeedback(null);
    const res = isMuted ? await unmuteUser(targetUserId) : await muteUser(targetUserId);
    setBusy(false);
    if (!res.success && res.error) {
      setFeedback(res.error);
    }
  };

  const handleBlockToggle = async () => {
    if (!isAuthenticated) {
      setAuthModalMode('login');
      return;
    }
    setBusy(true);
    setFeedback(null);
    const res = isBlockedByMe ? await unblockUser(targetUserId) : await blockUser(targetUserId);
    setBusy(false);
    if (res.success) {
      if (!isBlockedByMe && onBlocked) {
        onBlocked();
      }
    } else if (res.error) {
      setFeedback(res.error);
    }
  };

  if (statsOnly) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-bold text-[#0f172a] dark:text-slate-200 tabular-nums">
        <Users className="w-3.5 h-3.5 text-[#f25922]" />
        <span>{resolvedFollowers} Takipçi</span>
        {followingCount !== undefined && (
          <>
            <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">·</span>
            <span>{resolvedFollowing} Takip</span>
          </>
        )}
      </span>
    );
  }

  return (
    <div className="flex flex-col items-start sm:items-end gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        {!hideStats && (
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#f8fafc] dark:bg-[#0f1c38] border border-[#e2e8f0] dark:border-[#1e335a] text-xs font-bold text-[#0f172a] dark:text-slate-200 tabular-nums">
            <Users className="w-3.5 h-3.5 text-[#f25922]" />
            <span>{resolvedFollowers} Takipçi</span>
            {followingCount !== undefined && (
              <>
                <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">·</span>
                <span>{resolvedFollowing} Takip</span>
              </>
            )}
          </span>
        )}

        {!isOwn && (
          <>
            <button
              type="button"
              disabled={busy || isBlockedByMe}
              onClick={handleFollowToggle}
              aria-label={isFollowing ? `${targetName} takibini bırak` : `${targetName} takip et`}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-60 ${
                isFollowing
                  ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100'
                  : 'bg-[#f25922] hover:bg-[#d94b18] text-white shadow-xs'
              }`}
            >
              {isFollowing ? <UserCheck className="w-3.5 h-3.5" /> : <UserPlus className="w-3.5 h-3.5" />}
              <span>{isFollowing ? 'Takip Ediliyor' : 'Takip Et'}</span>
            </button>

            {isAuthenticated && (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleMuteToggle}
                  title={isMuted ? 'Sesi Aç' : 'Sessize Al'}
                  className={`px-2.5 py-2 rounded-xl text-xs font-semibold border transition-colors flex items-center gap-1 cursor-pointer ${
                    isMuted
                      ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-800'
                      : 'bg-white dark:bg-[#0f1c38] text-[#475569] dark:text-slate-300 border-[#e2e8f0] dark:border-[#1e335a] hover:border-slate-300'
                  }`}
                >
                  {isMuted ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
                  <span className="hidden md:inline">{isMuted ? 'Sessizde' : 'Sessize Al'}</span>
                </button>

                <button
                  type="button"
                  disabled={busy}
                  onClick={handleBlockToggle}
                  title={isBlockedByMe ? 'Engeli Kaldır' : 'Engelle'}
                  className={`px-2.5 py-2 rounded-xl text-xs font-semibold border transition-colors flex items-center gap-1 cursor-pointer ${
                    isBlockedByMe
                      ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800'
                      : 'bg-white dark:bg-[#0f1c38] text-[#475569] dark:text-slate-300 border-[#e2e8f0] dark:border-[#1e335a] hover:text-rose-600 hover:border-rose-200'
                  }`}
                >
                  <Ban className="w-3.5 h-3.5" />
                  <span className="hidden md:inline">{isBlockedByMe ? 'Engeli Kaldır' : 'Engelle'}</span>
                </button>
              </>
            )}
          </>
        )}
      </div>

      {feedback && (
        <div role="status" className="text-[11px] font-semibold text-rose-600 dark:text-rose-400">
          {feedback}
        </div>
      )}
    </div>
  );
};
