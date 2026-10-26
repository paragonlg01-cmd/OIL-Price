# Security Specification (`security_spec.md`)

## 1. Data Invariants
1. **Default-Deny Catch-All**: Every path not explicitly matched is denied (`allow read, write: if false;`).
2. **Path Variable Hardening**: Document IDs (`{stateId}`) must match `^[a-zA-Z0-9_\-]+$` and be at most 64 characters.
3. **Strict Schema & Key Validation (`isValidSharedBoardState`)**:
   - Required keys: `['stateId', 'defaultEvPrice', 'selectedYear', 'selectedMonth', 'ownerId', 'createdAt', 'updatedAt']`.
   - Allowed keys (`hasOnly`): `['stateId', 'defaultEvPrice', 'selectedYear', 'selectedMonth', 'ownerId', 'createdAt', 'updatedAt']`.
   - `defaultEvPrice`: string, size 1..16, matches `^[0-9]+(\.[0-9]{1,2})?$`.
   - `selectedYear`: int between 2020 and 2035.
   - `selectedMonth`: int between 1 and 12.
   - `ownerId`: string matching `request.auth.uid`, size <= 128.
   - `createdAt` and `updatedAt`: server timestamps (`request.time`).
4. **Verified Identity**: Write operations require `isSignedIn() && request.auth.token.email_verified == true`.
5. **Immutable Fields**: On update, `createdAt`, `stateId`, and `ownerId` must remain unchanged (`incoming().createdAt == existing().createdAt`).

## 2. The "Dirty Dozen" Payloads
1. **Unauthenticated Write**: `auth == null` attempting to create `/sharedBoardState/main`.
2. **Unverified Email Write**: `auth.token.email_verified == false` attempting to write `/sharedBoardState/main`.
3. **Shadow / Ghost Field Injection**: Payload containing `isAdmin: true` or `extraField: "hack"`.
4. **Owner Spoofing on Create**: `ownerId` set to `"another-user-uid"` instead of `request.auth.uid`.
5. **Owner Mutation on Update**: Changing `ownerId` from existing owner to a different UID.
6. **CreatedAt Tampering on Create**: Client passing arbitrary timestamp instead of `request.time`.
7. **CreatedAt Mutation on Update**: Modifying `createdAt` during an update operation.
8. **UpdatedAt Tampering on Update**: Client passing forged `updatedAt` instead of `request.time`.
9. **Path ID Poisoning**: Document ID `stateId` containing >64 chars or invalid characters.
10. **Value Poisoning (`defaultEvPrice`)**: Passing a 1MB string or non-numeric string for `defaultEvPrice`.
11. **Out-of-Range `selectedMonth`**: Passing `selectedMonth: 99` or `"October"`.
12. **Unauthorized Delete**: Attempting to delete `/sharedBoardState/main` when not owner/admin.
