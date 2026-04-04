import { describe, it, expect, beforeEach } from 'vitest';
import {
  createBasicChatPlugin,
  getNewMessages,
  setPhase,
  setTeams,
} from '../index.js';
import type { AgentInfo } from '@lobster/platform';

describe('BasicChatPlugin', () => {
  let plugin: ReturnType<typeof createBasicChatPlugin>;
  const alice: AgentInfo = { id: '1', handle: 'alice', team: 'A' };
  const bob: AgentInfo = { id: '2', handle: 'bob', team: 'A' };
  const carol: AgentInfo = { id: '3', handle: 'carol', team: 'B' };

  beforeEach(() => {
    plugin = createBasicChatPlugin();
  });

  it('has correct plugin metadata', () => {
    expect(plugin.id).toBe('basic-chat');
    expect(plugin.purity).toBe('stateful');
    expect(plugin.modes).toHaveLength(1);
    expect(plugin.modes[0].provides).toContain('messaging');
    expect(plugin.tools).toHaveLength(1);
    expect(plugin.tools![0].name).toBe('chat');
  });

  it('sends a message', () => {
    const result = plugin.handleCall!('chat', { message: 'hello' }, alice);
    expect(result).toEqual({ success: true, scope: 'all' });

    const data = plugin.handleData('messaging', new Map());
    const messages = data.get('messaging');
    expect(messages).toHaveLength(1);
    expect(messages[0].body).toBe('hello');
    expect(messages[0].from).toBe(1);
  });

  it('rejects empty message', () => {
    const result = plugin.handleCall!('chat', { message: '' }, alice);
    expect(result).toHaveProperty('error');
  });

  it('rejects unknown tool', () => {
    const result = plugin.handleCall!('unknown', {}, alice);
    expect(result).toHaveProperty('error');
  });

  describe('phase-aware routing', () => {
    it('sends as "all" during lobby', () => {
      setPhase(plugin, 'lobby');
      const result = plugin.handleCall!('chat', { message: 'hey' }, alice);
      expect(result).toEqual({ success: true, scope: 'all' });

      const messages = plugin.handleData('messaging', new Map()).get('messaging');
      expect(messages[0].scope).toBe('all');
    });

    it('sends as "team" during game', () => {
      setPhase(plugin, 'in_progress');
      const result = plugin.handleCall!('chat', { message: 'rush flag' }, alice);
      expect(result).toEqual({ success: true, scope: 'team' });

      const messages = plugin.handleData('messaging', new Map()).get('messaging');
      expect(messages[0].scope).toBe('team');
    });

    it('sends as "team" during pre_game', () => {
      setPhase(plugin, 'pre_game');
      const result = plugin.handleCall!('chat', { message: 'pick mage' }, alice);
      expect(result).toEqual({ success: true, scope: 'team' });
    });
  });

  describe('message cursor tracking', () => {
    it('returns only new messages since last check', () => {
      plugin.init!({ gameType: 'test', gameId: 'g1', turnCursor: 0, relay: { send() {}, receive() { return []; } }, playerId: '1' });
      plugin.init!({ gameType: 'test', gameId: 'g1', turnCursor: 0, relay: { send() {}, receive() { return []; } }, playerId: '2' });

      plugin.handleCall!('chat', { message: 'first' }, alice);
      plugin.handleCall!('chat', { message: 'second' }, bob);

      const msgs1 = getNewMessages(plugin, '1');
      expect(msgs1).toHaveLength(2);

      // Second call should return empty (cursor advanced)
      const msgs2 = getNewMessages(plugin, '1');
      expect(msgs2).toHaveLength(0);

      // New message appears after cursor
      plugin.handleCall!('chat', { message: 'third' }, alice);
      const msgs3 = getNewMessages(plugin, '1');
      expect(msgs3).toHaveLength(1);
      expect(msgs3[0].body).toBe('third');
    });

    it('cursors are per-agent', () => {
      plugin.init!({ gameType: 'test', gameId: 'g1', turnCursor: 0, relay: { send() {}, receive() { return []; } }, playerId: '1' });
      plugin.init!({ gameType: 'test', gameId: 'g1', turnCursor: 0, relay: { send() {}, receive() { return []; } }, playerId: '2' });

      plugin.handleCall!('chat', { message: 'hello' }, alice);

      const msgs1 = getNewMessages(plugin, '1');
      expect(msgs1).toHaveLength(1);

      // Agent 2 hasn't checked yet, should still see the message
      const msgs2 = getNewMessages(plugin, '2');
      expect(msgs2).toHaveLength(1);
    });
  });

  describe('team filtering during gameplay', () => {
    it('filters messages by team during in_progress', () => {
      setPhase(plugin, 'in_progress');
      setTeams(plugin, new Map([['1', 'A'], ['2', 'A'], ['3', 'B']]));

      plugin.init!({ gameType: 'test', gameId: 'g1', turnCursor: 0, relay: { send() {}, receive() { return []; } }, playerId: '1' });
      plugin.init!({ gameType: 'test', gameId: 'g1', turnCursor: 0, relay: { send() {}, receive() { return []; } }, playerId: '3' });

      plugin.handleCall!('chat', { message: 'team A msg' }, alice);
      plugin.handleCall!('chat', { message: 'team B msg' }, carol);

      // Alice (team A) should see team A message but not team B
      const aliceMsgs = getNewMessages(plugin, '1', 'A');
      expect(aliceMsgs).toHaveLength(1);
      expect(aliceMsgs[0].body).toBe('team A msg');

      // Carol (team B) should see team B message but not team A
      const carolMsgs = getNewMessages(plugin, '3', 'B');
      expect(carolMsgs).toHaveLength(1);
      expect(carolMsgs[0].body).toBe('team B msg');
    });
  });

  it('handleData returns all messages', () => {
    plugin.handleCall!('chat', { message: 'one' }, alice);
    plugin.handleCall!('chat', { message: 'two' }, bob);

    const data = plugin.handleData('messaging', new Map());
    const messages = data.get('messaging');
    expect(messages).toHaveLength(2);
  });

  it('messages include tags bag', () => {
    plugin.handleCall!('chat', { message: 'tagged' }, alice);

    const messages = plugin.handleData('messaging', new Map()).get('messaging');
    expect(messages[0].tags).toBeDefined();
    expect(messages[0].tags.source).toBe('basic-chat');
  });
});
