import { describe, it, expect, beforeEach } from 'vitest';
import { LobbyManager, LobbyAgent } from '../lobby.js';

function makeAgent(id: string, elo = 1200): LobbyAgent {
  return { id, handle: `agent_${id}`, elo };
}

describe('LobbyManager', () => {
  let lobby: LobbyManager;

  beforeEach(() => {
    lobby = new LobbyManager('test-lobby', 4);
  });

  // --- addAgent / removeAgent ---

  describe('addAgent / removeAgent', () => {
    it('adds an agent to the lobby', () => {
      lobby.addAgent(makeAgent('a1'));
      expect(lobby.agents.has('a1')).toBe(true);
      expect(lobby.agents.size).toBe(1);
    });

    it('removes an agent from the lobby', () => {
      lobby.addAgent(makeAgent('a1'));
      lobby.removeAgent('a1');
      expect(lobby.agents.has('a1')).toBe(false);
    });

    it('removes agent from their team when leaving', () => {
      lobby.addAgent(makeAgent('a1'));
      lobby.addAgent(makeAgent('a2'));
      const result = lobby.proposeTeam('a1', 'a2');
      lobby.acceptTeam('a2', result.teamId!);

      lobby.removeAgent('a2');
      const team = lobby.teams.get(result.teamId!);
      expect(team?.members).toEqual(['a1']);
    });

    it('cleans up empty teams on agent removal', () => {
      lobby.addAgent(makeAgent('a1'));
      lobby.addAgent(makeAgent('a2'));
      const result = lobby.proposeTeam('a1', 'a2');
      // a1 is on the team, a2 is invited
      lobby.removeAgent('a1');
      // team should be gone since it has no members
      expect(lobby.teams.has(result.teamId!)).toBe(false);
    });
  });

  // --- proposeTeam ---

  describe('proposeTeam', () => {
    it('two solos form a team with invite/accept flow', () => {
      lobby.addAgent(makeAgent('a1'));
      lobby.addAgent(makeAgent('a2'));

      const result = lobby.proposeTeam('a1', 'a2');
      expect(result.success).toBe(true);
      expect(result.teamId).toBeDefined();

      const team = lobby.teams.get(result.teamId!)!;
      expect(team.members).toEqual(['a1']);
      expect(team.invites.has('a2')).toBe(true);

      // a2 accepts
      const acceptResult = lobby.acceptTeam('a2', result.teamId!);
      expect(acceptResult.success).toBe(true);
      expect(team.members).toContain('a1');
      expect(team.members).toContain('a2');
      expect(team.invites.has('a2')).toBe(false);
    });

    it('solo invited to existing team', () => {
      lobby.addAgent(makeAgent('a1'));
      lobby.addAgent(makeAgent('a2'));
      lobby.addAgent(makeAgent('a3'));

      // a1 and a2 form a team
      const result = lobby.proposeTeam('a1', 'a2');
      lobby.acceptTeam('a2', result.teamId!);

      // a1 invites a3
      const invite = lobby.proposeTeam('a1', 'a3');
      expect(invite.success).toBe(true);
      expect(invite.teamId).toBe(result.teamId);

      const team = lobby.teams.get(result.teamId!)!;
      expect(team.invites.has('a3')).toBe(true);
    });

    it('solo proposes to agent on a team — gets invited to that team', () => {
      lobby.addAgent(makeAgent('a1'));
      lobby.addAgent(makeAgent('a2'));
      lobby.addAgent(makeAgent('a3'));

      const result = lobby.proposeTeam('a1', 'a2');
      lobby.acceptTeam('a2', result.teamId!);

      // a3 (solo) proposes to a1 (on team) — a3 gets invited to a1's team
      const invite = lobby.proposeTeam('a3', 'a1');
      expect(invite.success).toBe(true);
      expect(invite.teamId).toBe(result.teamId);

      const team = lobby.teams.get(result.teamId!)!;
      expect(team.invites.has('a3')).toBe(true);
    });

    it('errors when team is full', () => {
      lobby.addAgent(makeAgent('a1'));
      lobby.addAgent(makeAgent('a2'));
      lobby.addAgent(makeAgent('a3'));
      lobby.addAgent(makeAgent('a4'));
      lobby.addAgent(makeAgent('a5'));

      const result = lobby.proposeTeam('a1', 'a2');
      lobby.acceptTeam('a2', result.teamId!);
      lobby.proposeTeam('a1', 'a3');
      lobby.acceptTeam('a3', result.teamId!);
      lobby.proposeTeam('a1', 'a4');
      lobby.acceptTeam('a4', result.teamId!);

      // Team is full (4 members), try to invite a5
      const invite = lobby.proposeTeam('a1', 'a5');
      expect(invite.success).toBe(false);
      expect(invite.error).toBe('team is full');
    });

    it('errors when both agents already on teams', () => {
      lobby.addAgent(makeAgent('a1'));
      lobby.addAgent(makeAgent('a2'));
      lobby.addAgent(makeAgent('a3'));
      lobby.addAgent(makeAgent('a4'));

      const t1 = lobby.proposeTeam('a1', 'a2');
      lobby.acceptTeam('a2', t1.teamId!);
      const t2 = lobby.proposeTeam('a3', 'a4');
      lobby.acceptTeam('a4', t2.teamId!);

      const result = lobby.proposeTeam('a1', 'a3');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Both agents are already on teams');
    });
  });

  // --- acceptTeam ---

  describe('acceptTeam', () => {
    it('joins team and is removed from invites', () => {
      lobby.addAgent(makeAgent('a1'));
      lobby.addAgent(makeAgent('a2'));

      const result = lobby.proposeTeam('a1', 'a2');
      const team = lobby.teams.get(result.teamId!)!;
      expect(team.invites.has('a2')).toBe(true);

      const accept = lobby.acceptTeam('a2', result.teamId!);
      expect(accept.success).toBe(true);
      expect(team.members).toContain('a2');
      expect(team.invites.has('a2')).toBe(false);
      expect(lobby.agentTeam.get('a2')).toBe(result.teamId);
    });

    it('errors when not invited', () => {
      lobby.addAgent(makeAgent('a1'));
      lobby.addAgent(makeAgent('a2'));
      lobby.addAgent(makeAgent('a3'));

      const result = lobby.proposeTeam('a1', 'a2');
      const accept = lobby.acceptTeam('a3', result.teamId!);
      expect(accept.success).toBe(false);
      expect(accept.error).toBe('not invited to this team');
    });

    it('errors when team not found', () => {
      lobby.addAgent(makeAgent('a1'));
      const result = lobby.acceptTeam('a1', 'nonexistent');
      expect(result.success).toBe(false);
      expect(result.error).toBe('team not found');
    });
  });

  // --- autoMergeTeams ---

  describe('autoMergeTeams', () => {
    it('fills incomplete teams, forms new ones, orphans leftover', () => {
      // Add 11 agents
      for (let i = 1; i <= 11; i++) {
        lobby.addAgent(makeAgent(`a${i}`));
      }

      // Create a team of 2 (a1, a2)
      const t1 = lobby.proposeTeam('a1', 'a2');
      lobby.acceptTeam('a2', t1.teamId!);

      // Now we have: team of 2 (a1, a2), 9 free agents (a3-a11)
      const result = lobby.autoMergeTeams(4);

      // Should fill the incomplete team to 4, then form 1 more team of 4
      // That uses 2+9=11 agents: fill team (needs 2) + form 1 team (4) = 6 used from free
      // Remaining free: 9-6=3, but 3 < 4 so they're orphans

      // Count total agents in teams
      const teamMembers = result.teams.flatMap((t) => t.members);
      expect(teamMembers.length).toBe(8); // 4+4

      // Find the original team
      const filledTeam = result.teams.find((t) => t.id === t1.teamId);
      expect(filledTeam).toBeDefined();
      expect(filledTeam!.members.length).toBe(4);
      expect(filledTeam!.members).toContain('a1');
      expect(filledTeam!.members).toContain('a2');

      // Orphans
      expect(result.orphans.length).toBe(3);
    });

    it('all agents form complete teams with no orphans', () => {
      for (let i = 1; i <= 8; i++) {
        lobby.addAgent(makeAgent(`a${i}`));
      }

      const result = lobby.autoMergeTeams(4);
      expect(result.teams.length).toBe(2);
      expect(result.orphans.length).toBe(0);
    });

    it('all agents are orphans when fewer than teamSize', () => {
      for (let i = 1; i <= 3; i++) {
        lobby.addAgent(makeAgent(`a${i}`));
      }

      const result = lobby.autoMergeTeams(4);
      expect(result.teams.length).toBe(0);
      expect(result.orphans.length).toBe(3);
    });
  });

  // --- lobbyChat ---

  describe('lobbyChat', () => {
    it('messages are stored and retrievable', () => {
      lobby.addAgent(makeAgent('a1'));
      lobby.addAgent(makeAgent('a2'));

      lobby.lobbyChat('a1', 'hello world');
      lobby.lobbyChat('a2', 'hey there');

      expect(lobby.chat.length).toBe(2);
      expect(lobby.chat[0].from).toBe('a1');
      expect(lobby.chat[0].message).toBe('hello world');
      expect(lobby.chat[1].from).toBe('a2');
      expect(lobby.chat[1].message).toBe('hey there');
    });

    it('chat is included in getLobbyState', () => {
      lobby.addAgent(makeAgent('a1'));
      lobby.lobbyChat('a1', 'test message');

      const state = lobby.getLobbyState('a1');
      expect(state.chat.length).toBe(1);
      expect(state.chat[0].message).toBe('test message');
    });
  });

  // --- getLobbyState ---

  describe('getLobbyState', () => {
    it('returns lobby info with agents and teams', () => {
      lobby.addAgent(makeAgent('a1', 1500));
      lobby.addAgent(makeAgent('a2', 1300));

      const t = lobby.proposeTeam('a1', 'a2');
      lobby.acceptTeam('a2', t.teamId!);

      const state = lobby.getLobbyState('a1');
      expect(state.lobbyId).toBe('test-lobby');
      expect(state.agents.length).toBe(2);

      const a1 = state.agents.find((a) => a.id === 'a1')!;
      expect(a1.elo).toBe(1500);
      expect(a1.team).toBe(t.teamId);

      expect(state.teams[t.teamId!].members).toContain('a1');
      expect(state.teams[t.teamId!].members).toContain('a2');
    });
  });

  // --- chooseClass ---

  describe('chooseClass', () => {
    it('changes class in pre-game', () => {
      lobby.addAgent(makeAgent('a1'));
      lobby.addAgent(makeAgent('a2'));

      lobby.startPreGame(['a1'], ['a2']);

      const result = lobby.chooseClass('a1', 'knight');
      expect(result.success).toBe(true);

      const player = lobby.preGamePlayers.get('a1')!;
      expect(player.unitClass).toBe('knight');
    });

    it('errors when not in pre-game phase', () => {
      lobby.addAgent(makeAgent('a1'));
      const result = lobby.chooseClass('a1', 'knight');
      expect(result.success).toBe(false);
      expect(result.error).toBe('not in pre-game phase');
    });

    it('errors when player not in pre-game', () => {
      lobby.addAgent(makeAgent('a1'));
      lobby.addAgent(makeAgent('a2'));
      lobby.startPreGame(['a1'], ['a2']);

      const result = lobby.chooseClass('a3', 'knight');
      expect(result.success).toBe(false);
      expect(result.error).toBe('player not in pre-game');
    });

    it('allows switching class', () => {
      lobby.addAgent(makeAgent('a1'));
      lobby.addAgent(makeAgent('a2'));
      lobby.startPreGame(['a1'], ['a2']);

      lobby.chooseClass('a1', 'knight');
      lobby.chooseClass('a1', 'mage');
      expect(lobby.preGamePlayers.get('a1')!.unitClass).toBe('mage');
    });
  });

  // --- teamChat ---

  describe('teamChat', () => {
    it('only visible to own team', () => {
      lobby.addAgent(makeAgent('a1'));
      lobby.addAgent(makeAgent('a2'));
      lobby.addAgent(makeAgent('a3'));
      lobby.addAgent(makeAgent('a4'));

      lobby.startPreGame(['a1', 'a2'], ['a3', 'a4']);

      lobby.teamChat('a1', 'team A secret');
      lobby.teamChat('a3', 'team B secret');

      expect(lobby.preGameChat.A.length).toBe(1);
      expect(lobby.preGameChat.A[0].from).toBe('a1');
      expect(lobby.preGameChat.A[0].message).toBe('team A secret');

      expect(lobby.preGameChat.B.length).toBe(1);
      expect(lobby.preGameChat.B[0].from).toBe('a3');
      expect(lobby.preGameChat.B[0].message).toBe('team B secret');
    });

    it('does nothing for non-participants', () => {
      lobby.addAgent(makeAgent('a1'));
      lobby.addAgent(makeAgent('a2'));
      lobby.startPreGame(['a1'], ['a2']);

      lobby.teamChat('a3', 'should not appear');
      expect(lobby.preGameChat.A.length).toBe(0);
      expect(lobby.preGameChat.B.length).toBe(0);
    });
  });

  // --- getTeamState ---

  describe('getTeamState', () => {
    it('returns team info for a player in pre-game', () => {
      lobby.addAgent(makeAgent('a1'));
      lobby.addAgent(makeAgent('a2'));
      lobby.addAgent(makeAgent('a3'));

      lobby.startPreGame(['a1', 'a2'], ['a3']);
      lobby.chooseClass('a1', 'knight');

      const state = lobby.getTeamState('a1');
      expect(state).not.toBeNull();
      expect(state!.teamId).toBe('A');
      expect(state!.members.length).toBe(2);
      expect(state!.members.find((m) => m.id === 'a1')!.unitClass).toBe('knight');
      expect(state!.timeRemainingSeconds).toBeGreaterThanOrEqual(0);
    });

    it('returns null for non-participant', () => {
      lobby.addAgent(makeAgent('a1'));
      lobby.addAgent(makeAgent('a2'));
      lobby.startPreGame(['a1'], ['a2']);

      expect(lobby.getTeamState('a3')).toBeNull();
    });
  });

  // --- createGame ---

  describe('createGame', () => {
    it('produces a valid game state', () => {
      lobby.addAgent(makeAgent('a1'));
      lobby.addAgent(makeAgent('a2'));
      lobby.addAgent(makeAgent('a3'));
      lobby.addAgent(makeAgent('a4'));

      lobby.startPreGame(['a1', 'a2'], ['a3', 'a4']);
      lobby.chooseClass('a1', 'knight');
      lobby.chooseClass('a2', 'mage');
      // a3 and a4 don't choose — should default to rogue

      const { state, players } = lobby.createGame('test-seed');

      expect(state).toBeDefined();
      expect(state.phase).toBe('in_progress');
      expect(state.units.length).toBe(4);

      // Check classes
      const a1Unit = state.units.find((u) => u.id === 'a1')!;
      expect(a1Unit.unitClass).toBe('knight');
      expect(a1Unit.team).toBe('A');

      const a2Unit = state.units.find((u) => u.id === 'a2')!;
      expect(a2Unit.unitClass).toBe('mage');
      expect(a2Unit.team).toBe('A');

      const a3Unit = state.units.find((u) => u.id === 'a3')!;
      expect(a3Unit.unitClass).toBe('rogue');
      expect(a3Unit.team).toBe('B');

      const a4Unit = state.units.find((u) => u.id === 'a4')!;
      expect(a4Unit.unitClass).toBe('rogue');
      expect(a4Unit.team).toBe('B');

      // Players list should match
      expect(players.length).toBe(4);
    });

    it('errors when not in pre-game phase', () => {
      expect(() => lobby.createGame()).toThrow('Cannot create game outside pre-game phase');
    });

    it('sets phase to starting after game creation', () => {
      lobby.addAgent(makeAgent('a1'));
      lobby.addAgent(makeAgent('a2'));
      lobby.startPreGame(['a1'], ['a2']);

      lobby.createGame('seed');
      expect(lobby.phase).toBe('starting');
    });
  });
});
