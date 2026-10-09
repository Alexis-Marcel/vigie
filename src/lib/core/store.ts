import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { ChatMessage, Judgement } from "./types.js";
import type { StreamInfo } from "./sources/twitch-info.js";

/** Un seul fichier SQLite : messages, contextes de live, verdicts, annotations. Tout se rejoue depuis là. */
export class Store {
  private db: DatabaseSync;

  constructor(path = "data/vigie.sqlite") {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        channel TEXT NOT NULL,
        user_id TEXT NOT NULL,
        user_name TEXT NOT NULL,
        text TEXT NOT NULL,
        sent_at INTEGER NOT NULL,
        is_mod INTEGER NOT NULL,
        is_sub INTEGER NOT NULL,
        emote_only INTEGER NOT NULL DEFAULT 0,
        session TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS messages_channel_sent ON messages(channel, sent_at);
      CREATE TABLE IF NOT EXISTS stream_context (
        channel TEXT NOT NULL,
        fetched_at INTEGER NOT NULL,
        live INTEGER NOT NULL,
        title TEXT NOT NULL,
        game TEXT NOT NULL,
        language TEXT NOT NULL,
        viewers INTEGER NOT NULL,
        tags TEXT NOT NULL,
        PRIMARY KEY (channel, fetched_at)
      );
      CREATE TABLE IF NOT EXISTS judgements (
        message_id TEXT NOT NULL,
        judge TEXT NOT NULL,
        rule_id TEXT NOT NULL,
        confidence REAL NOT NULL,
        latency_ms INTEGER NOT NULL,
        input_tokens INTEGER,
        cost_usd REAL,
        judged_at INTEGER NOT NULL,
        PRIMARY KEY (message_id, judge, rule_id)
      );
      CREATE TABLE IF NOT EXISTS accounts (
        user_id TEXT PRIMARY KEY,
        login TEXT NOT NULL,
        display_name TEXT NOT NULL,
        avatar TEXT NOT NULL,
        access_token TEXT NOT NULL,
        refresh_token TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        scopes TEXT NOT NULL,
        connected_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS actions (
        message_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        by_user_id TEXT NOT NULL,
        automatic INTEGER NOT NULL,
        ok INTEGER NOT NULL,
        error TEXT,
        acted_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS channel_rules (
        key TEXT PRIMARY KEY,
        channel TEXT NOT NULL,
        yaml TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS annotations (
        message_id TEXT NOT NULL,
        rule_id TEXT NOT NULL,
        label INTEGER NOT NULL,
        annotated_at INTEGER NOT NULL,
        PRIMARY KEY (message_id, rule_id)
      );
    `);
  }

  insertMessage(m: ChatMessage, session: string): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO messages (id, channel, user_id, user_name, text, sent_at, is_mod, is_sub, emote_only, session)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(m.id, m.channel, m.userId, m.userName, m.text, m.sentAt, m.isMod ? 1 : 0, m.isSub ? 1 : 0, m.emoteOnly ? 1 : 0, session);
  }

  insertContext(info: StreamInfo): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO stream_context (channel, fetched_at, live, title, game, language, viewers, tags)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(info.channel, info.fetchedAt, info.live ? 1 : 0, info.title, info.game, info.language, info.viewers, JSON.stringify(info.tags));
  }

  /** Dernier contexte connu au moment `at` (ou le premier après, si la capture a commencé avant la première récupération). */
  contextAt(channel: string, at: number): StreamInfo | null {
    const r =
      (this.db
        .prepare(`SELECT * FROM stream_context WHERE channel = ? AND fetched_at <= ? ORDER BY fetched_at DESC LIMIT 1`)
        .get(channel, at) as Record<string, unknown> | undefined) ??
      (this.db
        .prepare(`SELECT * FROM stream_context WHERE channel = ? ORDER BY fetched_at ASC LIMIT 1`)
        .get(channel) as Record<string, unknown> | undefined);
    if (!r) return null;
    return {
      channel,
      live: r.live === 1,
      title: r.title as string,
      game: r.game as string,
      language: r.language as string,
      viewers: r.viewers as number,
      tags: JSON.parse(r.tags as string),
      fetchedAt: r.fetched_at as number,
    };
  }

  insertJudgement(j: Judgement): void {
    const stmt = this.db.prepare(
      `INSERT OR REPLACE INTO judgements (message_id, judge, rule_id, confidence, latency_ms, input_tokens, cost_usd, judged_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const now = Date.now();
    for (const v of j.verdicts) {
      stmt.run(j.messageId, j.judge, v.ruleId, v.confidence, j.latencyMs, j.inputTokens ?? null, j.costUsd ?? null, now);
    }
  }

  judgementsFor(messageId: string, judge = "jev"): Record<string, number> {
    const rows = this.db
      .prepare(`SELECT rule_id, confidence FROM judgements WHERE message_id = ? AND judge = ?`)
      .all(messageId, judge) as { rule_id: string; confidence: number }[];
    return Object.fromEntries(rows.map((r) => [r.rule_id, r.confidence]));
  }

  setAnnotations(messageId: string, labels: Record<string, boolean>): void {
    const stmt = this.db.prepare(
      `INSERT OR REPLACE INTO annotations (message_id, rule_id, label, annotated_at) VALUES (?, ?, ?, ?)`,
    );
    const now = Date.now();
    for (const [ruleId, v] of Object.entries(labels)) stmt.run(messageId, ruleId, v ? 1 : 0, now);
  }

  isAnnotated(messageId: string): boolean {
    return !!this.db.prepare(`SELECT 1 FROM annotations WHERE message_id = ? LIMIT 1`).get(messageId);
  }

  /** Pour les stats : chaque message annoté avec, par règle, le label humain et la proba Jev. */
  annotatedWithJudgements(channel: string, judge = "jev"): Array<{ messageId: string; text: string; ruleId: string; label: boolean; confidence: number | null }> {
    return (
      this.db
        .prepare(
          `SELECT a.message_id, m.text, a.rule_id, a.label, j.confidence
           FROM annotations a
           JOIN messages m ON m.id = a.message_id
           LEFT JOIN judgements j ON j.message_id = a.message_id AND j.rule_id = a.rule_id AND j.judge = ?
           WHERE m.channel = ?`,
        )
        .all(judge, channel) as { message_id: string; text: string; rule_id: string; label: number; confidence: number | null }[]
    ).map((r) => ({ messageId: r.message_id, text: r.text, ruleId: r.rule_id, label: r.label === 1, confidence: r.confidence }));
  }

  // --- règles par chaîne (clé = chaîne pour les modérateurs, chaîne@navigateur pour un anonyme)

  channelRulesYaml(key: string): string | null {
    const r = this.db.prepare(`SELECT yaml FROM channel_rules WHERE key = ?`).get(key) as { yaml: string } | undefined;
    return r?.yaml ?? null;
  }

  saveChannelRulesYaml(key: string, channel: string, yaml: string): void {
    this.db
      .prepare(`INSERT OR REPLACE INTO channel_rules (key, channel, yaml, updated_at) VALUES (?, ?, ?, ?)`)
      .run(key, channel, yaml, Date.now());
  }

  // --- limites et entretien

  /** Dépense Jev enregistrée depuis un instant donné, toutes chaînes confondues. */
  costSince(since: number): number {
    const r = this.db.prepare(`SELECT COALESCE(SUM(cost_usd), 0) AS c FROM judgements WHERE judged_at >= ?`).get(since) as { c: number };
    return r.c;
  }

  /** Efface les messages bruts plus vieux qu'un instant. Verdicts et annotations restent. */
  purgeMessagesBefore(ts: number): number {
    const r = this.db.prepare(`DELETE FROM messages WHERE sent_at < ?`).run(ts);
    return Number(r.changes);
  }

  // --- comptes Twitch connectés

  saveAccount(a: Account): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO accounts (user_id, login, display_name, avatar, access_token, refresh_token, expires_at, scopes, connected_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(a.userId, a.login, a.displayName, a.avatar, a.accessToken, a.refreshToken, a.expiresAt, a.scopes.join(" "), Date.now());
  }

  account(userId: string): Account | null {
    const r = this.db.prepare(`SELECT * FROM accounts WHERE user_id = ?`).get(userId) as Record<string, unknown> | undefined;
    return r ? rowToAccount(r) : null;
  }

  deleteAccount(userId: string): void {
    this.db.prepare(`DELETE FROM accounts WHERE user_id = ?`).run(userId);
    this.db.prepare(`DELETE FROM sessions WHERE user_id = ?`).run(userId);
  }

  createSession(userId: string): string {
    const id = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, "");
    this.db.prepare(`INSERT INTO sessions (id, user_id, created_at) VALUES (?, ?, ?)`).run(id, userId, Date.now());
    return id;
  }

  sessionAccount(sessionId: string): Account | null {
    const r = this.db
      .prepare(`SELECT a.* FROM sessions s JOIN accounts a ON a.user_id = s.user_id WHERE s.id = ?`)
      .get(sessionId) as Record<string, unknown> | undefined;
    return r ? rowToAccount(r) : null;
  }

  deleteSession(sessionId: string): void {
    this.db.prepare(`DELETE FROM sessions WHERE id = ?`).run(sessionId);
  }

  insertAction(a: { messageId: string; kind: string; byUserId: string; automatic: boolean; ok: boolean; error?: string }): void {
    this.db
      .prepare(`INSERT INTO actions (message_id, kind, by_user_id, automatic, ok, error, acted_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(a.messageId, a.kind, a.byUserId, a.automatic ? 1 : 0, a.ok ? 1 : 0, a.error ?? null, Date.now());
  }

  messages(channel: string, session?: string): ChatMessage[] {
    const rows = session
      ? this.db.prepare(`SELECT * FROM messages WHERE channel = ? AND session = ? ORDER BY sent_at`).all(channel, session)
      : this.db.prepare(`SELECT * FROM messages WHERE channel = ? ORDER BY sent_at`).all(channel);
    return (rows as Record<string, unknown>[]).map(rowToMessage);
  }

  /** Messages jugés, avec leur proba max, pour construire l'échantillon d'annotation. */
  judgedMessages(channel: string, judge = "jev"): Array<ChatMessage & { maxConfidence: number; maxRule: string }> {
    const rows = this.db
      .prepare(
        `SELECT m.*, j.rule_id AS max_rule, MAX(j.confidence) AS max_conf
         FROM messages m JOIN judgements j ON j.message_id = m.id AND j.judge = ?
         WHERE m.channel = ? GROUP BY m.id ORDER BY m.sent_at`,
      )
      .all(judge, channel) as Record<string, unknown>[];
    return rows.map((r) => ({ ...rowToMessage(r), maxConfidence: r.max_conf as number, maxRule: r.max_rule as string }));
  }

  count(channel: string): number {
    const r = this.db.prepare(`SELECT COUNT(*) AS n FROM messages WHERE channel = ?`).get(channel) as { n: number };
    return r.n;
  }

  close(): void {
    this.db.close();
  }
}

export interface Account {
  userId: string;
  login: string;
  displayName: string;
  avatar: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scopes: string[];
}

function rowToAccount(r: Record<string, unknown>): Account {
  return {
    userId: r.user_id as string,
    login: r.login as string,
    displayName: r.display_name as string,
    avatar: r.avatar as string,
    accessToken: r.access_token as string,
    refreshToken: r.refresh_token as string,
    expiresAt: r.expires_at as number,
    scopes: (r.scopes as string).split(" ").filter(Boolean),
  };
}

function rowToMessage(r: Record<string, unknown>): ChatMessage {
  return {
    id: r.id as string,
    channel: r.channel as string,
    userId: r.user_id as string,
    userName: r.user_name as string,
    text: r.text as string,
    sentAt: r.sent_at as number,
    isMod: r.is_mod === 1,
    isSub: r.is_sub === 1,
    emoteOnly: r.emote_only === 1,
  };
}
