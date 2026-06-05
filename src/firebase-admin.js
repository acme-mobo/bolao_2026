import { cert, getApps, initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { config } from './config.js';

function credentialFromConfig() {
  if (config.firebaseServiceAccountJson) {
    return cert(JSON.parse(config.firebaseServiceAccountJson));
  }

  if (config.firebaseProjectId && config.firebaseClientEmail && config.firebasePrivateKey) {
    return cert({
      projectId: config.firebaseProjectId,
      clientEmail: config.firebaseClientEmail,
      privateKey: config.firebasePrivateKey,
    });
  }

  return applicationDefault();
}

export function getAdminApp() {
  return (
    getApps().find((app) => app.name === 'bolao26') ??
    initializeApp(
      {
        credential: credentialFromConfig(),
        projectId: config.firebaseProjectId || config.firebaseWebProjectId || undefined,
      },
      'bolao26',
    )
  );
}

export function getAdminAuth() {
  return getAuth(getAdminApp());
}

export function getAdminFirestore() {
  return getFirestore(getAdminApp(), config.firestoreDatabaseId);
}
