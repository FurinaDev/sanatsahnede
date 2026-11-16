import { DbInstance } from './database';

export interface Migration {
  version: number;
  name: string;
  up: (db: DbInstance) => void;
}

function hasColumn(db: DbInstance, table: string, column: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return cols.some((c) => c.name === column);
}

function ensureColumn(db: DbInstance, table: string, column: string, definition: string): void {
  if (!hasColumn(db, table, column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
  }
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: '001_core_indexes',
    up: (db) => {
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_sessions_user_expires ON sessions(user_id, expires_at);
        CREATE INDEX IF NOT EXISTS idx_individual_profiles_city_disc ON individual_profiles(city, discipline);
        CREATE INDEX IF NOT EXISTS idx_ensembles_city_leader ON ensembles(city, leader_user_id);
        CREATE INDEX IF NOT EXISTS idx_business_profiles_city_user ON business_profiles(city, user_id);
        CREATE INDEX IF NOT EXISTS idx_listings_status_city_date ON listings(status, city, event_date);
        CREATE INDEX IF NOT EXISTS idx_listings_business_id ON listings(business_id);
        CREATE INDEX IF NOT EXISTS idx_applications_listing_user ON applications(listing_id, applicant_user_id);
        CREATE INDEX IF NOT EXISTS idx_offers_parties_status ON offers(employer_user_id, performer_user_id, status);
        CREATE INDEX IF NOT EXISTS idx_bookings_parties_status ON bookings(business_id, performer_user_id, status);
        CREATE INDEX IF NOT EXISTS idx_events_status_city_date ON events(status, city, event_date);
        CREATE INDEX IF NOT EXISTS idx_event_regs_event_email ON event_registrations(event_id, attendee_email);
        CREATE INDEX IF NOT EXISTS idx_event_regs_user_id ON event_registrations(user_id);
        CREATE INDEX IF NOT EXISTS idx_venues_city_manager ON venues(city, manager_user_id);
        CREATE INDEX IF NOT EXISTS idx_availability_owner_date ON availability_slots(owner_id, slot_date);
        CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, is_read, created_at);
        CREATE INDEX IF NOT EXISTS idx_messages_conv_created ON messages(conversation_id, created_at);
      `);
    },
  },
  {
    version: 2,
    name: '002_media_assets_and_geo_cache',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS media_assets (
          id TEXT PRIMARY KEY,
          owner_user_id TEXT NOT NULL,
          storage_provider TEXT NOT NULL DEFAULT 'local',
          object_key TEXT NOT NULL UNIQUE,
          url TEXT NOT NULL,
          mime_type TEXT NOT NULL,
          size_bytes INTEGER NOT NULL,
          original_name TEXT NOT NULL,
          category TEXT NOT NULL DEFAULT 'general',
          created_at TEXT NOT NULL,
          FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_media_assets_owner_created ON media_assets(owner_user_id, created_at);

        CREATE TABLE IF NOT EXISTS geo_cache (
          query_key TEXT PRIMARY KEY,
          city TEXT NOT NULL DEFAULT '',
          district TEXT NOT NULL DEFAULT '',
          normalized_query TEXT NOT NULL,
          latitude REAL NOT NULL,
          longitude REAL NOT NULL,
          provider TEXT NOT NULL,
          display_name TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_geo_cache_expires ON geo_cache(expires_at);
      `);

      ensureColumn(db, 'individual_profiles', 'latitude', 'REAL');
      ensureColumn(db, 'individual_profiles', 'longitude', 'REAL');
      ensureColumn(db, 'individual_profiles', 'location_privacy', "TEXT NOT NULL DEFAULT 'city_masked'");

      ensureColumn(db, 'business_profiles', 'latitude', 'REAL');
      ensureColumn(db, 'business_profiles', 'longitude', 'REAL');

      ensureColumn(db, 'venues', 'latitude', 'REAL');
      ensureColumn(db, 'venues', 'longitude', 'REAL');
    },
  },
  {
    version: 3,
    name: '003_fk_integrity_and_audit_indexes',
    up: (db) => {
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_audit_logs_user_created ON audit_logs(user_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_career_records_artist_user ON career_records(artist_id, user_id);
        CREATE INDEX IF NOT EXISTS idx_artist_portfolios_user_vis ON artist_portfolios(user_id, visibility);
        CREATE INDEX IF NOT EXISTS idx_financial_ledger_booking ON financial_ledger(booking_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_reviews_target_booking ON reviews(target_id, booking_id);
        CREATE INDEX IF NOT EXISTS idx_verifications_user_status ON verification_requests(user_id, status);
        CREATE INDEX IF NOT EXISTS idx_bookmarks_user ON user_bookmarks(user_id, item_type);
      `);
    },
  },
  {
    version: 4,
    name: '004_social_graph_and_artist_availability',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS follows (
          follower_user_id TEXT NOT NULL,
          following_user_id TEXT NOT NULL,
          created_at TEXT NOT NULL,
          PRIMARY KEY (follower_user_id, following_user_id),
          FOREIGN KEY (follower_user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (following_user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_follows_following ON follows(following_user_id, created_at);

        CREATE TABLE IF NOT EXISTS user_blocks (
          blocker_user_id TEXT NOT NULL,
          blocked_user_id TEXT NOT NULL,
          reason TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          PRIMARY KEY (blocker_user_id, blocked_user_id),
          FOREIGN KEY (blocker_user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (blocked_user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_user_blocks_blocked ON user_blocks(blocked_user_id);

        CREATE TABLE IF NOT EXISTS user_mutes (
          muter_user_id TEXT NOT NULL,
          muted_user_id TEXT NOT NULL,
          created_at TEXT NOT NULL,
          PRIMARY KEY (muter_user_id, muted_user_id),
          FOREIGN KEY (muter_user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (muted_user_id) REFERENCES users(id) ON DELETE CASCADE
        );
      `);

      ensureColumn(db, 'individual_profiles', 'is_available_this_week', 'INTEGER NOT NULL DEFAULT 0');
      ensureColumn(db, 'individual_profiles', 'availability_note', "TEXT NOT NULL DEFAULT ''");
      ensureColumn(db, 'individual_profiles', 'availability_updated_at', 'TEXT');
      ensureColumn(db, 'individual_profiles', 'discipline_showcase_json', "TEXT NOT NULL DEFAULT '{}'");
    },
  },
  {
    version: 5,
    name: '005_profile_visibility_and_social_feed',
    up: (db) => {
      ensureColumn(db, 'individual_profiles', 'profile_visibility', "TEXT NOT NULL DEFAULT 'public'");

      db.exec(`
        CREATE TABLE IF NOT EXISTS posts (
          id TEXT PRIMARY KEY,
          author_user_id TEXT NOT NULL,
          author_type TEXT NOT NULL DEFAULT 'artist',
          author_entity_id TEXT,
          author_name TEXT NOT NULL,
          author_avatar TEXT NOT NULL DEFAULT '',
          author_subtitle TEXT NOT NULL DEFAULT '',
          discipline TEXT NOT NULL DEFAULT 'Müzik',
          post_type TEXT NOT NULL DEFAULT 'update',
          body TEXT NOT NULL DEFAULT '',
          tags_json TEXT NOT NULL DEFAULT '[]',
          link_url TEXT,
          link_preview_json TEXT,
          repost_entity_type TEXT,
          repost_entity_id TEXT,
          visibility TEXT NOT NULL DEFAULT 'public',
          status TEXT NOT NULL DEFAULT 'published',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (author_user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at DESC, id);
        CREATE INDEX IF NOT EXISTS idx_posts_author_created ON posts(author_user_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_posts_discipline_created ON posts(discipline, created_at DESC);

        CREATE TABLE IF NOT EXISTS post_media (
          id TEXT PRIMARY KEY,
          post_id TEXT NOT NULL,
          media_type TEXT NOT NULL DEFAULT 'image',
          url TEXT NOT NULL,
          caption TEXT NOT NULL DEFAULT '',
          sort_order INTEGER NOT NULL DEFAULT 0,
          FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_post_media_post ON post_media(post_id, sort_order);

        CREATE TABLE IF NOT EXISTS post_comments (
          id TEXT PRIMARY KEY,
          post_id TEXT NOT NULL,
          author_user_id TEXT NOT NULL,
          author_name TEXT NOT NULL,
          author_avatar TEXT NOT NULL DEFAULT '',
          body TEXT NOT NULL,
          created_at TEXT NOT NULL,
          FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
          FOREIGN KEY (author_user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_post_comments_post_created ON post_comments(post_id, created_at ASC);

        CREATE TABLE IF NOT EXISTS post_reactions (
          post_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          reaction_type TEXT NOT NULL DEFAULT 'applause',
          created_at TEXT NOT NULL,
          PRIMARY KEY (post_id, user_id),
          FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_post_reactions_post ON post_reactions(post_id);
      `);
    },
  },
  {
    version: 6,
    name: '006_realtime_messaging',
    up: (db) => {
      ensureColumn(db, 'conversations', 'conversation_type', "TEXT NOT NULL DEFAULT 'direct'");
      ensureColumn(db, 'conversations', 'status', "TEXT NOT NULL DEFAULT 'active'");
      ensureColumn(db, 'conversations', 'created_by_user_id', 'TEXT');
      ensureColumn(db, 'conversations', 'group_avatar_url', 'TEXT');

      ensureColumn(db, 'messages', 'reply_to_message_id', 'TEXT');
      ensureColumn(db, 'messages', 'attachment_name', 'TEXT');
      ensureColumn(db, 'messages', 'attachment_type', 'TEXT');
      ensureColumn(db, 'messages', 'edited_at', 'TEXT');
      ensureColumn(db, 'messages', 'deleted_at', 'TEXT');
      ensureColumn(db, 'messages', 'reactions_json', "TEXT NOT NULL DEFAULT '{}'");

      db.exec(`
        UPDATE conversations
        SET conversation_type = CASE
          WHEN context_type = 'group' THEN 'group'
          WHEN context_type = 'direct' THEN 'direct'
          ELSE 'context'
        END;

        CREATE TABLE IF NOT EXISTS conversation_reads (
          conversation_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          last_read_message_id TEXT,
          last_read_at TEXT NOT NULL,
          PRIMARY KEY (conversation_id, user_id),
          FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_conv_reads_user ON conversation_reads(user_id, last_read_at);
        CREATE INDEX IF NOT EXISTS idx_conversations_last_msg ON conversations(last_message_at DESC);
      `);
    },
  },
  {
    version: 7,
    name: '007_communities_channels_and_badge_governance',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS communities (
          id TEXT PRIMARY KEY,
          slug TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          discipline TEXT NOT NULL DEFAULT 'Müzik',
          city TEXT NOT NULL DEFAULT 'İstanbul',
          avatar_url TEXT NOT NULL DEFAULT '',
          cover_url TEXT NOT NULL DEFAULT '',
          visibility TEXT NOT NULL DEFAULT 'public',
          owner_user_id TEXT NOT NULL,
          is_verified INTEGER NOT NULL DEFAULT 0,
          verified_label TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_communities_disc_city ON communities(discipline, city);

        CREATE TABLE IF NOT EXISTS community_members (
          community_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'member',
          is_muted INTEGER NOT NULL DEFAULT 0,
          joined_at TEXT NOT NULL,
          PRIMARY KEY (community_id, user_id),
          FOREIGN KEY (community_id) REFERENCES communities(id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_community_members_user ON community_members(user_id);

        CREATE TABLE IF NOT EXISTS community_channels (
          id TEXT PRIMARY KEY,
          community_id TEXT NOT NULL,
          slug TEXT NOT NULL,
          name TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          channel_type TEXT NOT NULL DEFAULT 'discussion',
          is_readonly INTEGER NOT NULL DEFAULT 0,
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          FOREIGN KEY (community_id) REFERENCES communities(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_community_channels_comm ON community_channels(community_id, sort_order);

        CREATE TABLE IF NOT EXISTS community_messages (
          id TEXT PRIMARY KEY,
          channel_id TEXT NOT NULL,
          community_id TEXT NOT NULL,
          sender_user_id TEXT NOT NULL,
          sender_name TEXT NOT NULL,
          sender_avatar TEXT NOT NULL DEFAULT '',
          body TEXT NOT NULL DEFAULT '',
          attachment_url TEXT,
          attachment_name TEXT,
          attachment_type TEXT,
          reply_to_message_id TEXT,
          reactions_json TEXT NOT NULL DEFAULT '{}',
          is_pinned INTEGER NOT NULL DEFAULT 0,
          deleted_at TEXT,
          created_at TEXT NOT NULL,
          FOREIGN KEY (channel_id) REFERENCES community_channels(id) ON DELETE CASCADE,
          FOREIGN KEY (community_id) REFERENCES communities(id) ON DELETE CASCADE,
          FOREIGN KEY (sender_user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_community_messages_chan ON community_messages(channel_id, created_at);
      `);

      ensureColumn(db, 'individual_profiles', 'verified_label', "TEXT NOT NULL DEFAULT ''");
      ensureColumn(db, 'ensembles', 'verified_label', "TEXT NOT NULL DEFAULT ''");
      ensureColumn(db, 'business_profiles', 'verified_label', "TEXT NOT NULL DEFAULT ''");
    },
  },
];

export function runMigrations(db: DbInstance): { appliedVersions: number[]; currentVersion: number } {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const appliedRows = db
    .prepare('SELECT version FROM schema_migrations ORDER BY version ASC')
    .all() as Array<{ version: number }>;
  const appliedSet = new Set(appliedRows.map((r) => Number(r.version)));
  const newlyApplied: number[] = [];

  for (const migration of MIGRATIONS) {
    if (appliedSet.has(migration.version)) {
      continue;
    }

    const tx = db.transaction(() => {
      migration.up(db);
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
        migration.version,
        migration.name,
        new Date().toISOString()
      );
    });
    tx();
    newlyApplied.push(migration.version);
    appliedSet.add(migration.version);
  }

  const maxRow = db
    .prepare('SELECT COALESCE(MAX(version), 0) as currentVersion FROM schema_migrations')
    .get() as { currentVersion: number };

  return {
    appliedVersions: newlyApplied,
    currentVersion: Number(maxRow?.currentVersion || 0),
  };
}

export function getSchemaVersion(db: DbInstance): number {
  const row = db
    .prepare('SELECT COALESCE(MAX(version), 0) as v FROM schema_migrations')
    .get() as { v: number } | undefined;
  return Number(row?.v || 0);
}
