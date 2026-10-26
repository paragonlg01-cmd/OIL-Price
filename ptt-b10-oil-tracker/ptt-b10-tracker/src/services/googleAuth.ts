import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  User,
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDoc,
  getDocFromServer,
  setDoc,
  updateDoc,
  onSnapshot,
  serverTimestamp,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

export const SCOPES = ['https://www.googleapis.com/auth/gmail.send'];

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
testConnection();

export async function syncSharedBoardStateToFirestore(params: {
  defaultEvPrice: string;
  selectedYear: number;
  selectedMonth: number;
}): Promise<void> {
  const currentUser = auth.currentUser;
  if (!currentUser || !currentUser.emailVerified) return;

  const stateId = currentUser.uid.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || 'main';
  const path = `sharedBoardState/${stateId}`;
  const priceStr = String(params.defaultEvPrice || '9.60').slice(0, 16);
  if (!/^[0-9]+(\.[0-9]{1,2})?$/.test(priceStr)) return;
  if (params.selectedYear < 2020 || params.selectedYear > 2035) return;
  if (params.selectedMonth < 1 || params.selectedMonth > 12) return;

  const docRef = doc(db, 'sharedBoardState', stateId);
  try {
    const snap = await getDoc(docRef);
    if (!snap.exists()) {
      await setDoc(docRef, {
        stateId,
        defaultEvPrice: priceStr,
        selectedYear: params.selectedYear,
        selectedMonth: params.selectedMonth,
        ownerId: currentUser.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else if (snap.data()?.ownerId === currentUser.uid) {
      await updateDoc(docRef, {
        defaultEvPrice: priceStr,
        selectedYear: params.selectedYear,
        selectedMonth: params.selectedMonth,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    if (errMsg.includes('Quota limit exceeded') || errMsg.includes('Quota exceeded')) {
      console.warn(
        '[Firestore Quota Notice] Free daily read units quota reached. Real-time sync continues seamlessly via Server API and Server-Sent Events.'
      );
      return;
    }
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export function subscribeSharedBoardState(
  onUpdate: (data: { defaultEvPrice: string; selectedYear: number; selectedMonth: number }) => void
): () => void {
  let unsubSnapshot: (() => void) | null = null;
  const unsubAuth = onAuthStateChanged(auth, (currentUser) => {
    if (unsubSnapshot) {
      unsubSnapshot();
      unsubSnapshot = null;
    }
    if (currentUser && currentUser.emailVerified) {
      const stateId = currentUser.uid.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || 'main';
      const path = `sharedBoardState/${stateId}`;
      unsubSnapshot = onSnapshot(
        doc(db, 'sharedBoardState', stateId),
        (snap) => {
          if (snap.exists()) {
            const d = snap.data();
            if (
              typeof d.defaultEvPrice === 'string' &&
              typeof d.selectedYear === 'number' &&
              typeof d.selectedMonth === 'number'
            ) {
              onUpdate({
                defaultEvPrice: d.defaultEvPrice,
                selectedYear: d.selectedYear,
                selectedMonth: d.selectedMonth,
              });
            }
          }
        },
        (error) => {
          const errMsg = error instanceof Error ? error.message : String(error);
          if (errMsg.includes('Quota limit exceeded') || errMsg.includes('Quota exceeded')) {
            console.warn(
              '[Firestore Quota Notice] Free daily read units quota reached. Real-time sync is actively handled by Server SSE.'
            );
            return;
          }
          try {
            handleFirestoreError(error, OperationType.GET, path);
          } catch {
            // logged via handleFirestoreError
          }
        }
      );
    }
  });

  return () => {
    unsubAuth();
    if (unsubSnapshot) unsubSnapshot();
  };
}

const provider = new GoogleAuthProvider();
SCOPES.forEach((scope) => provider.addScope(scope));

// Flag to indicate if we are in the middle of a sign-in flow.
let isSigningIn = false;
// Cache the access token in memory ONLY (never in localStorage/sessionStorage).
let cachedAccessToken: string | null = null;

export const initAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) => {
  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user) {
      if (cachedAccessToken) {
        if (onAuthSuccess) onAuthSuccess(user, cachedAccessToken);
      } else if (!isSigningIn) {
        cachedAccessToken = null;
        if (onAuthFailure) onAuthFailure();
      }
    } else {
      cachedAccessToken = null;
      if (onAuthFailure) onAuthFailure();
    }
  });
};

export const googleSignIn = async (): Promise<{ user: User; accessToken: string } | null> => {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Failed to get access token from Firebase Auth');
    }

    cachedAccessToken = credential.accessToken;
    return { user: result.user, accessToken: cachedAccessToken };
  } catch (error) {
    console.error('Sign in error:', error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

export const getAccessToken = async (): Promise<string | null> => {
  return cachedAccessToken;
};

export const logout = async () => {
  await auth.signOut();
  cachedAccessToken = null;
};

function encodeUtf8Base64Url(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function encodeMimeHeaderUtf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return `=?UTF-8?B?${btoa(binary)}?=`;
}

export interface SendGmailParams {
  to: string[];
  cc?: string[];
  subject: string;
  htmlBody: string;
}

export async function sendGmailMessage(params: SendGmailParams): Promise<{ id: string; threadId: string }> {
  const token = await getAccessToken();
  if (!token) {
    throw new Error('กรุณาเข้าสู่ระบบด้วย Google (Sign in with Google) ก่อนส่งอีเมล');
  }

  const toHeader = params.to.map((e) => e.trim()).filter(Boolean).join(', ');
  const ccList = (params.cc || []).map((e) => e.trim()).filter(Boolean);

  if (!toHeader) {
    throw new Error('กรุณาระบุอีเมลผู้รับอย่างน้อย 1 รายการ');
  }

  const headers = [
    `To: ${toHeader}`,
    ...(ccList.length > 0 ? [`Cc: ${ccList.join(', ')}`] : []),
    `Subject: ${encodeMimeHeaderUtf8(params.subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
  ];

  const rawMime = `${headers.join('\r\n')}\r\n\r\n${params.htmlBody}`;
  const rawEncoded = encodeUtf8Base64Url(rawMime);

  const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw: rawEncoded }),
  });

  if (!response.ok) {
    const errBody = await response.json().catch(() => ({}));
    const msg =
      errBody?.error?.message || `ส่งอีเมลไม่สำเร็จ (HTTP ${response.status})`;
    throw new Error(msg);
  }

  return response.json();
}
