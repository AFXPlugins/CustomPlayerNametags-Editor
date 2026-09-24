/* ==========================================================================
 * 20-bridge.js — everything the editor knows about the "server".
 *
 * The UI only ever talks to a `bridge`. Right now that is the in-memory
 * `MockBridge` below: a blank, in-memory editor (empty global format, no line
 * limit, one "Steve" preview profile) so the editor can be exercised without
 * the plugin. With `?session=` in the URL, RelayBridge (21-relay.js) is used
 * instead and loads a real server's data. Any other backend only has to
 * implement the same methods and be returned from `NT.createBridge()` —
 * nothing else in the editor has to change.
 *
 * ---------------------------------------------------------------- CONTRACT
 * All methods return Promises.
 *
 *   load() -> {
 *     session:      { role: 'admin' | 'player', player: { uuid, name, skin? } },
 *     settings:     { lineMaxCharacters, truncateIndicator, widgetTruncateIndicator,
 *                     crouchEffect: 'NONE'|'DEFAULT'|'HIDE',
 *                     separateBedrockGlobal, separateBedrockGroups,
 *                     bedrockPrefix, bedrockSuffix, affixGlobal, affixPlayer, affixGroup },
 *     placeholders: [ { key, value, title|null } ],       // editor-placeholders.yml
 *     players:      [ { uuid, name, group, hasFormat } ], // online players (admin)
 *     groups:       { java: [name], bedrock: [name] },    // groups with a stored format (admin)
 *   }
 *
 *   loadFormat(target) -> { raw, exists, effectiveRaw }
 *     target = { type: 'global' | 'group' | 'player' | 'self',
 *                id?: groupName | playerUuid,  platform: 'java' | 'bedrock' }
 *     `raw` is the stored format string; `effectiveRaw` is what currently
 *     applies to that player/group/global (used to "start from current").
 *     For type 'self', `raw` is the player's effective format with their own
 *     widget fills already overlaid (NametagManager#getEffectiveRawFormat).
 *
 *   saveFormat(target, raw) -> { ok, error? }          (admin)
 *   saveOwn(raw)            -> { ok, error? }          (player: the server keeps
 *       only the widget fills unless the player already has an individual format)
 *   clearPlayerFormat(uuid) -> { ok }                  (admin)
 *   clearGroupFormat(id, bedrock) -> { ok }             (admin — deletes a group's
 *       custom format entirely, reverting its members to whichever
 *       lower-priority format tier next applies)
 *
 *   previewContext(uuid)    -> { name, values: { key: resolvedString }, lineLimit }
 *       PlaceholderAPI values for that player as the nametag would resolve them,
 *       and their effective per-line character limit (-1 = unlimited).
 *
 *   isMock: true            -> the built-in example editor (no server behind it).
 * ========================================================================== */
(function (NT) {
  'use strict';
  const M = NT.model;

  const clone = (o) => JSON.parse(JSON.stringify(o));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  /* ------------------------------------------------------------- seed data */
  // A blank editor: no players, no groups, an empty global format and no
  // per-line character limit, so there is nothing to undo before you start
  // building. The lone profile below only exists to give the preview a name,
  // some placeholder values and a head (the real, bundled default Steve skin).

  function seed() {
    return {
      settings: {
        lineMaxCharacters: -1, truncateIndicator: true, widgetTruncateIndicator: true, crouchEffect: 'DEFAULT',
        separateBedrockGlobal: false, separateBedrockGroups: false,
        bedrockPrefix: '', bedrockSuffix: '', affixGlobal: false, affixPlayer: false, affixGroup: false,
      },
      placeholders: [
        { key: 'player_ping', value: '%player_ping%', title: 'Ping (ms)' },
        { key: 'player_health', value: '%player_health%', title: 'Health' },
        { key: 'player_level', value: '%player_level%', title: 'XP level' },
        { key: 'player_world', value: '%player_world%', title: 'World' },
      ],
      profiles: [{
        uuid: 'preview', name: 'Steve', group: 'default', limit: -1, skin: 'assets/steve.png',
        look: { skin: '#c68e63', hair: '#3a2a22', shirt: '#2f9fb0', pants: '#39407a', eyes: '#3b6fd8' },
        values: { player_ping: '48', player_health: '20', player_level: '12', player_world: 'world' },
      }],
      formats: {
        global: { java: '', bedrock: '' },
        group: { java: {}, bedrock: {} },
        player: {},
      },
      fills: {},
      session: { role: 'admin', playerUuid: 'preview' },
    };
  }

  /* ----------------------------------------------------------------- mock */

  class MockBridge {
    constructor() {
      this.isMock = true;
      this.latency = 90;
      this.reset();
    }

    reset() { this.state = seed(); }

    get settings() { return this.state.settings; }
    profileByUuid(uuid) { return this.state.profiles.find((p) => p.uuid === uuid) || null; }

    async load() {
      await wait(this.latency);
      const s = this.state;
      const me = this.profileByUuid(s.session.playerUuid);
      return clone({
        session: { role: s.session.role, player: { uuid: me.uuid, name: me.name, skin: me.skin || null } },
        settings: s.settings,
        placeholders: s.placeholders,
        players: [],
        groups: {
          java: Object.keys(s.formats.group.java),
          bedrock: Object.keys(s.formats.group.bedrock),
        },
      });
    }

    /** The format the server would apply to a player right now (override → group → global). */
    effectiveFor(profile, platform) {
      const s = this.state;
      const bedrock = platform === 'bedrock';
      const own = s.formats.player[profile.uuid];
      let raw;
      let source;
      if (own != null) { raw = own; source = 'player'; }
      else {
        const useBedrockGroups = bedrock && s.settings.separateBedrockGroups;
        const groupFormats = useBedrockGroups ? s.formats.group.bedrock : s.formats.group.java;
        if (groupFormats[profile.group] != null) { raw = groupFormats[profile.group]; source = 'group'; }
        else if (bedrock && s.settings.separateBedrockGlobal) { raw = s.formats.global.bedrock; source = 'global'; }
        else { raw = s.formats.global.java; source = 'global'; }
      }
      const fills = s.fills[profile.uuid];
      return { raw: fills ? M.overlayWidgetFills(raw, fills) : raw, source };
    }

    async loadFormat(target) {
      await wait(this.latency / 2);
      const s = this.state;
      const bedrock = target.platform === 'bedrock';
      if (target.type === 'global') {
        const raw = bedrock ? s.formats.global.bedrock : s.formats.global.java;
        return { raw, exists: true, effectiveRaw: raw };
      }
      if (target.type === 'group') {
        const raw = (bedrock ? s.formats.group.bedrock : s.formats.group.java)[target.id];
        return { raw: raw == null ? '' : raw, exists: raw != null, effectiveRaw: raw == null ? '' : raw };
      }
      if (target.type === 'player') {
        const p = this.profileByUuid(target.id);
        const own = s.formats.player[target.id];
        const eff = this.effectiveFor(p, target.platform);
        return { raw: own == null ? '' : own, exists: own != null, effectiveRaw: eff.raw, effectiveSource: eff.source };
      }
      // self: the player's own applied format, widget fills overlaid
      const me = this.profileByUuid(s.session.playerUuid);
      const eff = this.effectiveFor(me, 'java');
      return { raw: eff.raw, exists: true, effectiveRaw: eff.raw, effectiveSource: eff.source, hasIndividual: s.formats.player[me.uuid] != null };
    }

    async saveFormat(target, raw) {
      await wait(this.latency);
      if (!raw) return { ok: false, error: 'A nametag format cannot be empty.' };
      const s = this.state;
      const bedrock = target.platform === 'bedrock';
      if (target.type === 'global') s.formats.global[bedrock ? 'bedrock' : 'java'] = raw;
      else if (target.type === 'group') s.formats.group[bedrock ? 'bedrock' : 'java'][target.id] = raw;
      else if (target.type === 'player') s.formats.player[target.id] = raw;
      else return { ok: false, error: 'Unknown target.' };
      return { ok: true };
    }

    async saveOwn(raw) {
      await wait(this.latency);
      if (!raw) return { ok: false, error: 'Your nametag format cannot be empty.' };
      const s = this.state;
      const uuid = s.session.playerUuid;
      // Same rule as NametagEditorManager#confirm: a player with an individual
      // format saves it whole; otherwise only their widget fills are kept.
      if (s.formats.player[uuid] != null) s.formats.player[uuid] = raw;
      else s.fills[uuid] = M.extractWidgetContents(raw);
      return { ok: true };
    }

    async clearPlayerFormat(uuid) {
      await wait(this.latency / 2);
      delete this.state.formats.player[uuid];
      return { ok: true };
    }

    async clearGroupFormat(id, bedrock) {
      await wait(this.latency / 2);
      delete this.state.formats.group[bedrock ? 'bedrock' : 'java'][id];
      return { ok: true };
    }

    async previewContext(uuid) {
      const p = this.profileByUuid(uuid) || this.state.profiles[0];
      // profile.limit: null = server default, -1 = unlimited, N = tiered permission
      // (customplayernametags.bypasslinecharacterlimit.N)
      const lineLimit = p.limit == null ? this.state.settings.lineMaxCharacters : p.limit;
      return { name: p.name, values: clone(p.values), lineLimit, look: p.look, group: p.group };
    }
  }

  // A `?session=<id>` in the URL (put there by `/nametags editor web`) means
  // this page should load real server data through RelayBridge (21-relay.js)
  // instead of the built-in demo data — everything else about the app is
  // identical either way, since both bridges implement the same contract.
  NT.createBridge = () => {
    const sessionId = NT.relay && NT.relay.sessionIdFromUrl();
    if (sessionId && NT.RelayBridge) {
      return new NT.RelayBridge(sessionId);
    }
    return new MockBridge();
  };
  NT.MockBridge = MockBridge;
})((globalThis.NT = globalThis.NT || {}));
