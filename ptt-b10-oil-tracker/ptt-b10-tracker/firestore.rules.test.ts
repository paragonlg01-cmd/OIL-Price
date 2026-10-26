/**
 * Firestore Security Rules Verification Suite (Dirty Dozen Payloads)
 */
export interface TestPayloadCase {
  id: number;
  name: string;
  auth: { uid: string; email_verified: boolean } | null;
  operation: 'get' | 'create' | 'update' | 'delete';
  path: string;
  payload?: Record<string, unknown>;
  expectedResult: 'PERMISSION_DENIED';
}

export const DIRTY_DOZEN_CASES: TestPayloadCase[] = [
  {
    id: 1,
    name: 'Unauthenticated Write',
    auth: null,
    operation: 'create',
    path: '/sharedBoardState/main',
    payload: {
      stateId: 'main',
      defaultEvPrice: '9.60',
      selectedYear: 2026,
      selectedMonth: 10,
      ownerId: 'user_1',
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 2,
    name: 'Unverified Email Write',
    auth: { uid: 'user_1', email_verified: false },
    operation: 'create',
    path: '/sharedBoardState/main',
    payload: {
      stateId: 'main',
      defaultEvPrice: '9.60',
      selectedYear: 2026,
      selectedMonth: 10,
      ownerId: 'user_1',
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 3,
    name: 'Shadow / Ghost Field Injection',
    auth: { uid: 'user_1', email_verified: true },
    operation: 'create',
    path: '/sharedBoardState/main',
    payload: {
      stateId: 'main',
      defaultEvPrice: '9.60',
      selectedYear: 2026,
      selectedMonth: 10,
      ownerId: 'user_1',
      isAdmin: true,
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 4,
    name: 'Owner Spoofing on Create',
    auth: { uid: 'user_1', email_verified: true },
    operation: 'create',
    path: '/sharedBoardState/main',
    payload: {
      stateId: 'main',
      defaultEvPrice: '9.60',
      selectedYear: 2026,
      selectedMonth: 10,
      ownerId: 'user_2',
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 5,
    name: 'Owner Mutation on Update',
    auth: { uid: 'user_1', email_verified: true },
    operation: 'update',
    path: '/sharedBoardState/main',
    payload: {
      stateId: 'main',
      defaultEvPrice: '9.60',
      selectedYear: 2026,
      selectedMonth: 10,
      ownerId: 'user_2',
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 6,
    name: 'CreatedAt Tampering on Create',
    auth: { uid: 'user_1', email_verified: true },
    operation: 'create',
    path: '/sharedBoardState/main',
    payload: {
      stateId: 'main',
      defaultEvPrice: '9.60',
      selectedYear: 2026,
      selectedMonth: 10,
      ownerId: 'user_1',
      createdAt: '2020-01-01T00:00:00Z',
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 7,
    name: 'CreatedAt Mutation on Update',
    auth: { uid: 'user_1', email_verified: true },
    operation: 'update',
    path: '/sharedBoardState/main',
    payload: {
      stateId: 'main',
      defaultEvPrice: '9.75',
      selectedYear: 2026,
      selectedMonth: 10,
      ownerId: 'user_1',
      createdAt: '2026-10-20T00:00:00Z',
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 8,
    name: 'UpdatedAt Tampering on Update',
    auth: { uid: 'user_1', email_verified: true },
    operation: 'update',
    path: '/sharedBoardState/main',
    payload: {
      stateId: 'main',
      defaultEvPrice: '9.75',
      selectedYear: 2026,
      selectedMonth: 10,
      ownerId: 'user_1',
      updatedAt: '2099-01-01T00:00:00Z',
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 9,
    name: 'Path ID Poisoning',
    auth: { uid: 'user_1', email_verified: true },
    operation: 'create',
    path: `/sharedBoardState/${'x'.repeat(100)}`,
    payload: {
      stateId: 'x'.repeat(100),
      defaultEvPrice: '9.60',
      selectedYear: 2026,
      selectedMonth: 10,
      ownerId: 'user_1',
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 10,
    name: 'Value Poisoning (defaultEvPrice)',
    auth: { uid: 'user_1', email_verified: true },
    operation: 'update',
    path: '/sharedBoardState/main',
    payload: {
      stateId: 'main',
      defaultEvPrice: 'INVALID_PRICE_STRING',
      selectedYear: 2026,
      selectedMonth: 10,
      ownerId: 'user_1',
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 11,
    name: 'Out-of-Range selectedMonth',
    auth: { uid: 'user_1', email_verified: true },
    operation: 'update',
    path: '/sharedBoardState/main',
    payload: {
      stateId: 'main',
      defaultEvPrice: '9.60',
      selectedYear: 2026,
      selectedMonth: 99,
      ownerId: 'user_1',
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 12,
    name: 'Unauthorized Delete by Non-Owner',
    auth: { uid: 'attacker_uid', email_verified: true },
    operation: 'delete',
    path: '/sharedBoardState/main',
    expectedResult: 'PERMISSION_DENIED',
  },
];
