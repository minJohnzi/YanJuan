import { type FirebaseApp, getApps, initializeApp } from 'firebase/app';
import {
  type Auth,
  GoogleAuthProvider,
  type User,
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import {
  type Firestore,
  doc,
  getFirestore,
  setDoc,
} from 'firebase/firestore';

const apiKey = import.meta.env.VITE_FIREBASE_API_KEY?.trim();
const authDomain = import.meta.env.VITE_FIREBASE_AUTH_DOMAIN?.trim();
const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID?.trim();
const appId = import.meta.env.VITE_FIREBASE_APP_ID?.trim();

export const isFirebaseConfigured = Boolean(apiKey && authDomain && projectId);

let firebaseApp: FirebaseApp | null = null;
let firebaseAuth: Auth | null = null;
let firestoreDb: Firestore | null = null;

if (isFirebaseConfigured) {
  try {
    const existing = getApps();
    firebaseApp =
      existing.length > 0
        ? existing[0]
        : initializeApp({
            apiKey,
            authDomain,
            projectId,
            appId: appId || undefined,
          });
    firebaseAuth = getAuth(firebaseApp);
    firestoreDb = getFirestore(firebaseApp);
  } catch (err) {
    console.warn('[Firebase Optional Init] Falling back to local mode:', err);
  }
}

export async function signInWithGooglePopup(): Promise<User | null> {
  if (!isFirebaseConfigured || !firebaseAuth) {
    throw new Error('当前环境未配置 Firebase 认证参数，系统已自动启用本地存储模式。');
  }
  const provider = new GoogleAuthProvider();
  const result = await signInWithPopup(firebaseAuth, provider);
  return result.user;
}

export async function signOutFirebaseUser(): Promise<void> {
  if (firebaseAuth) {
    await signOut(firebaseAuth);
  }
}

export function subscribeAuthState(callback: (user: User | null) => void): () => void {
  if (!isFirebaseConfigured || !firebaseAuth) {
    callback(null);
    return () => {};
  }
  return onAuthStateChanged(firebaseAuth, callback);
}

export async function syncRecordToFirestore(
  uid: string,
  subcollection: 'attempts' | 'subjectiveVersions' | 'reviewItems' | 'profile',
  docId: string,
  data: Record<string, unknown>
): Promise<void> {
  if (!isFirebaseConfigured || !firestoreDb || !uid) return;
  try {
    const ref = doc(firestoreDb, 'users', uid, subcollection, docId);
    await setDoc(
      ref,
      {
        ...data,
        uid,
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );
  } catch (err) {
    console.warn('[Firestore Sync Warning]', err);
  }
}

export async function getCurrentFirebaseIdToken(): Promise<string | null> {
  if (!isFirebaseConfigured || !firebaseAuth || !firebaseAuth.currentUser) {
    return null;
  }
  try {
    return await firebaseAuth.currentUser.getIdToken();
  } catch {
    return null;
  }
}

export async function buildApiAuthHeaders(
  extraHeaders: Record<string, string> = {}
): Promise<Record<string, string>> {
  const idToken = await getCurrentFirebaseIdToken();
  if (idToken) {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
      ...extraHeaders,
    };
  }
  return {
    'Content-Type': 'application/json',
    Authorization: 'Bearer local-guest-token',
    ...extraHeaders,
  };
}
