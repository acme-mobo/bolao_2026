/**
 * Limpa usuários, palpites, memberships e bolões do store e do Firebase Auth.
 * Times e jogos são preservados.
 *
 * Uso: node src/purge-users.js
 */
import { getAdminAuth } from './firebase-admin.js';
import { store } from './store.js';
import { config } from './config.js';

await store.load();

await store.transaction((db) => {
  const nUsers       = db.users.length;
  const nPredictions = db.predictions.length;
  const nMemberships = db.memberships.length;
  const nPools       = db.pools.length;

  db.users       = [];
  db.predictions = [];
  db.memberships = [];
  db.pools       = [];

  console.log(`Store (${store.kind}):`);
  console.log(`  usuarios    removidos: ${nUsers}`);
  console.log(`  apostas     removidas: ${nPredictions}`);
  console.log(`  memberships removidas: ${nMemberships}`);
  console.log(`  boloes      removidos: ${nPools}`);
  console.log(`  times e jogos: preservados`);

  return null;
});

// Remove os usuários do Firebase Auth (quando usa Firestore)
if (['firestore', 'firebase'].includes(config.dataStore)) {
  let pageToken;
  let totalDeleted = 0;

  do {
    const list = await getAdminAuth().listUsers(1000, pageToken);

    if (list.users.length > 0) {
      const uids = list.users.map((u) => u.uid);
      const result = await getAdminAuth().deleteUsers(uids);
      totalDeleted += result.successCount;

      if (result.errors.length > 0) {
        for (const err of result.errors) {
          console.warn(`  Erro ao deletar uid ${err.index}:`, err.error.message);
        }
      }
    }

    pageToken = list.pageToken;
  } while (pageToken);

  console.log(`Firebase Auth: ${totalDeleted} usuario(s) deletado(s).`);
} else {
  console.log('Firebase Auth: ignorado (store local).');
}

console.log('Pronto.');
