export interface ClaudeMessage {
  role: "user" | "assistant";
  content: string;
}

interface Session {
  messages: ClaudeMessage[];
  contextToken: string;
  typingTicket?: string;
  lastActivity: number;
}

export class SessionStore {
  private sessions = new Map<string, Session>();

  private getOrCreate(sessionId: string): Session {
    let s = this.sessions.get(sessionId);
    if (!s) {
      s = { messages: [], contextToken: "", lastActivity: Date.now() };
      this.sessions.set(sessionId, s);
    }
    return s;
  }

  getMessages(sessionId: string): ClaudeMessage[] {
    return this.getOrCreate(sessionId).messages;
  }

  addUserMessage(sessionId: string, text: string): void {
    const s = this.getOrCreate(sessionId);
    s.messages.push({ role: "user", content: text });
    s.lastActivity = Date.now();
  }

  addAssistantMessage(sessionId: string, text: string): void {
    const s = this.getOrCreate(sessionId);
    s.messages.push({ role: "assistant", content: text });
    s.lastActivity = Date.now();
  }

  setContextToken(sessionId: string, token: string): void {
    this.getOrCreate(sessionId).contextToken = token;
  }

  getContextToken(sessionId: string): string {
    return this.getOrCreate(sessionId).contextToken;
  }

  setTypingTicket(sessionId: string, ticket: string): void {
    this.getOrCreate(sessionId).typingTicket = ticket;
  }

  getTypingTicket(sessionId: string): string | undefined {
    return this.sessions.get(sessionId)?.typingTicket;
  }

  trimToMaxHistory(sessionId: string, max: number): void {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    if (s.messages.length > max) {
      s.messages = s.messages.slice(-max);
    }
  }
}
