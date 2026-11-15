// @ts-nocheck (script de génération exécuté par vitest sous Node)
// Génère test/fixtures/sync_scenario.json (GEN=1 npx vitest run fixture),
// relu par test/sync_core_test.dart pour vérifier que l'app Windows fusionne
// exactement comme l'app web.
import { writeFileSync } from 'node:fs';
import { describe, it } from 'vitest';
import { applyLocal, baseFrom, canonicalJson, emptyBase, emptyDoc, mergeDocs, project, syncKey, type LocalView } from '../src/lib/synccore';

describe.runIf(process.env.GEN)('fixture', () => {
  it('écrit le scénario', () => {
    const known = new Set(['a.mp3', 'b.mp3', 'c.mp3', 'd.mp3', 'e.mp3']);
    const mk = (p: Partial<LocalView>): LocalView => ({ likes: [], playlists: [], plays: {}, known, ...p });
    let pc = applyLocal(emptyDoc(), emptyBase(), mk({ likes: ['a.mp3', 'b.mp3'], playlists: [{ id: 'p1', name: 'Route', createdAt: 5, keys: ['a.mp3', 'c.mp3'] }, { id: 'p2', name: 'Vieux', createdAt: 6, keys: ['e.mp3'] }], plays: { 'a.mp3': { count: 3, last: 50 } } }), 'pc', 100);
    const pcBase = baseFrom(project(pc, known));
    let phone = applyLocal(emptyDoc(), emptyBase(), mk({ likes: ['d.mp3'], plays: { 'a.mp3': { count: 2, last: 70 } } }), 'phone', 110);
    phone = mergeDocs(phone, pc);
    const phoneProj = project(phone, known);
    const phoneBase = baseFrom(phoneProj);
    // Le téléphone insère b au milieu, retire un favori, supprime p2, renomme p1.
    phone = applyLocal(phone, phoneBase, mk({ likes: ['d.mp3', 'a.mp3'], playlists: [{ id: 'p1', name: 'Route 66', createdAt: 5, keys: ['a.mp3', 'b.mp3', 'c.mp3'] }], plays: { 'a.mp3': { count: 6, last: 90 } } }), 'phone', 120);
    // Le PC, sans le savoir, ajoute d à la fin.
    pc = applyLocal(pc, pcBase, mk({ likes: ['a.mp3', 'b.mp3'], playlists: [{ id: 'p1', name: 'Route', createdAt: 5, keys: ['a.mp3', 'c.mp3', 'd.mp3'] }, { id: 'p2', name: 'Vieux', createdAt: 6, keys: ['e.mp3'] }], plays: { 'a.mp3': { count: 3, last: 50 } } }), 'pc', 115);
    const merged = mergeDocs(pc, phone);
    const keys = ['Rock\\Noir Désir\\01 - Le Vent.MP3', 'Été/Œuvre.mp3', 'Café/a.mp3', 'AC:DC/Back?.mp3', 'Ça  /  Ira .flac', 'Ñandú/ß.ogg'];
    writeFileSync(
      '../test/fixtures/sync_scenario.json',
      JSON.stringify(
        {
          keys: keys.map((k) => [k, syncKey(k)]),
          docs: [pc, phone],
          known: [...known],
          merged: canonicalJson(merged),
          projection: project(merged, known),
        },
        null,
        1,
      ) + '\n',
    );
  });
});
