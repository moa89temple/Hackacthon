import type { DatabaseSync } from "node:sqlite";
import type { LoginPlan, Tokens } from "./connector-login.ts";
import type { NewActivityEntry } from "./store.ts";

/** The services a Student asked to connect, in their own file. Store.services is how the rest of the backend reaches them. */

export const SERVICE_MIGRATION = `CREATE TABLE service_connections (
     student_id TEXT NOT NULL,
     id TEXT NOT NULL,
     name TEXT NOT NULL,
     domain TEXT NOT NULL,
     connector_url TEXT,
     login_plan TEXT,
     fell_back_because TEXT,
     created_at TEXT NOT NULL,
     PRIMARY KEY (student_id, id)
   );
   CREATE TABLE connector_logins (
     student_id TEXT NOT NULL,
     connection TEXT NOT NULL,
     client_id TEXT,
     state TEXT,
     verifier TEXT,
     access_token TEXT,
     refresh_token TEXT,
     expires_at TEXT,
     browser_logged_in INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (student_id, connection)
   );`;

/** Nothing here is secret, so this is safe to pass around. A connector_url of null means Buddy's Browser. */
export interface StoredService {
  id: string;
  name: string;
  domain: string;
  connectorUrl: string | null;
  loginPlan: LoginPlan | null;
  /** Why it's on Buddy's Browser after the connector didn't work out, in Buddy's own words. */
  fellBackBecause: string | null;
}

/** What Buddy holds to log in with. It never leaves the backend except to the service's own domain and the Claude API's MCP connector. */
export interface StoredConnectorLogin {
  clientId: string | null;
  state: string | null;
  verifier: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: Date | null;
  browserLoggedIn: boolean;
}

export interface ServiceStore {
  list(studentId: string): StoredService[];
  add(studentId: string, service: Omit<StoredService, "fellBackBecause">, at: Date): void;
  /** Deletes any token and client along with the connector it was for, because Buddy's Browser has no use for them. */
  fallBackToBrowser(studentId: string, id: string, because: string, entry: NewActivityEntry): void;
  /** Goes with its login and its cards in the conversation. */
  remove(studentId: string, id: string): void;
  login(studentId: string, id: string): StoredConnectorLogin | null;
  saveClient(studentId: string, id: string, clientId: string): void;
  saveAttempt(studentId: string, id: string, attempt: { state: string; verifier: string }): void;
  /** An attempt works once, however it came out. */
  endAttempt(studentId: string, id: string): void;
  saveTokens(studentId: string, id: string, tokens: Tokens, expiresAt: Date | null): void;
  /** Keeps the client, so that the next login needn't sign up again. */
  forgetTokens(studentId: string, id: string): void;
  noteBrowserLogin(studentId: string, id: string, loggedIn: boolean): void;
  /** The Student has just logged in, so Buddy stops asking them to, whatever becomes of the read that follows. */
  noteLoginWorked(studentId: string, id: string): void;
  /** For inside revoking a Read Permission, so that the token goes in that same step. */
  deleteLoginWithoutTransaction(studentId: string, id: string): void;
}

export function createServiceStore(
  db: DatabaseSync,
  inTransaction: <T>(work: () => T) => T,
  addActivity: (studentId: string, entry: NewActivityEntry) => void,
): ServiceStore {
  const selectAll = db.prepare(`SELECT id, name, domain, connector_url, login_plan, fell_back_because FROM service_connections WHERE student_id = ? ORDER BY created_at, id`);
  const insert = db.prepare(`INSERT INTO service_connections (student_id, id, name, domain, connector_url, login_plan, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const updateToBrowser = db.prepare(`UPDATE service_connections SET connector_url = NULL, login_plan = NULL, fell_back_because = ? WHERE student_id = ? AND id = ?`);
  const deleteService = db.prepare(`DELETE FROM service_connections WHERE student_id = ? AND id = ?`);
  const deleteCards = db.prepare(`DELETE FROM read_permission_cards WHERE student_id = ? AND connection = ?`);
  const selectLogin = db.prepare(`SELECT client_id, state, verifier, access_token, refresh_token, expires_at, browser_logged_in FROM connector_logins WHERE student_id = ? AND connection = ?`);
  const ensureLogin = db.prepare(`INSERT OR IGNORE INTO connector_logins (student_id, connection) VALUES (?, ?)`);
  const updateClient = db.prepare(`UPDATE connector_logins SET client_id = ? WHERE student_id = ? AND connection = ?`);
  const updateAttempt = db.prepare(`UPDATE connector_logins SET state = ?, verifier = ? WHERE student_id = ? AND connection = ?`);
  const updateTokens = db.prepare(`UPDATE connector_logins SET access_token = ?, refresh_token = ?, expires_at = ? WHERE student_id = ? AND connection = ?`);
  const updateBrowserLogin = db.prepare(`UPDATE connector_logins SET browser_logged_in = ? WHERE student_id = ? AND connection = ?`);
  const deleteLogin = db.prepare(`DELETE FROM connector_logins WHERE student_id = ? AND connection = ?`);
  const clearNeedsLogin = db.prepare(`UPDATE read_permissions SET needs_login = 0 WHERE student_id = ? AND connection = ?`);

  const emptyLogin = () => db.exec("PRAGMA wal_checkpoint(TRUNCATE)");

  return {
    list(studentId) {
      return selectAll.all(studentId).map((row: any) => ({
        id: row.id,
        name: row.name,
        domain: row.domain,
        connectorUrl: row.connector_url,
        loginPlan: row.login_plan ? (JSON.parse(row.login_plan) as LoginPlan) : null,
        fellBackBecause: row.fell_back_because,
      }));
    },

    add(studentId, service, at) {
      insert.run(studentId, service.id, service.name, service.domain, service.connectorUrl, service.loginPlan ? JSON.stringify(service.loginPlan) : null, at.toISOString());
    },

    fallBackToBrowser(studentId, id, because, entry) {
      inTransaction(() => {
        addActivity(studentId, entry);
        updateToBrowser.run(because, studentId, id);
        deleteLogin.run(studentId, id);
      });
      emptyLogin();
    },

    remove(studentId, id) {
      inTransaction(() => {
        deleteService.run(studentId, id);
        deleteCards.run(studentId, id);
        deleteLogin.run(studentId, id);
      });
      emptyLogin();
    },

    login(studentId, id) {
      const row = selectLogin.get(studentId, id) as any;
      if (!row) return null;
      return {
        clientId: row.client_id,
        state: row.state,
        verifier: row.verifier,
        accessToken: row.access_token,
        refreshToken: row.refresh_token,
        expiresAt: row.expires_at ? new Date(row.expires_at) : null,
        browserLoggedIn: row.browser_logged_in !== 0,
      };
    },

    saveClient(studentId, id, clientId) {
      ensureLogin.run(studentId, id);
      updateClient.run(clientId, studentId, id);
    },

    saveAttempt(studentId, id, { state, verifier }) {
      ensureLogin.run(studentId, id);
      updateAttempt.run(state, verifier, studentId, id);
    },

    endAttempt(studentId, id) {
      updateAttempt.run(null, null, studentId, id);
      emptyLogin();
    },

    saveTokens(studentId, id, tokens, expiresAt) {
      ensureLogin.run(studentId, id);
      updateTokens.run(tokens.accessToken, tokens.refreshToken, expiresAt?.toISOString() ?? null, studentId, id);
      // So that a token that's been swapped doesn't stay in the log of recent changes.
      emptyLogin();
    },

    forgetTokens(studentId, id) {
      updateTokens.run(null, null, null, studentId, id);
      emptyLogin();
    },

    noteBrowserLogin(studentId, id, loggedIn) {
      ensureLogin.run(studentId, id);
      updateBrowserLogin.run(loggedIn ? 1 : 0, studentId, id);
    },

    noteLoginWorked(studentId, id) {
      clearNeedsLogin.run(studentId, id);
    },

    deleteLoginWithoutTransaction(studentId, id) {
      deleteLogin.run(studentId, id);
    },
  };
}
