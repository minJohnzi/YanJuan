# Firestore Security Specification (`security_spec.md`)

## 1. Data Invariants
1. **Strict User Isolation**: Every user subcollection under `/users/{uid}/...` can only be read or written when `request.auth != null`, `request.auth.uid == uid`, and `request.auth.token.email_verified == true`.
2. **Identity Match on Payload**: Every created or updated document under `/users/{uid}/...` must contain `data.uid == request.auth.uid`.
3. **Immutable Subjective Answer Versions**: Documents in `/users/{uid}/answer-versions/{versionId}` are immutable once created (`allow update: if false;`), guaranteeing historical versions V1, V2, V3 can never be overwritten in place.
4. **Total Client Denial on Encrypted Credentials**: `/private-provider-credentials/{uid}/providers/{providerId}` denies all client reads and writes (`allow read, write: if false;`), restricting access exclusively to the Node.js server via Firebase Admin SDK.
5. **Path ID & Volumetric Bounds**: All document IDs must match `^[a-zA-Z0-9_\-]+$` with length `<= 128`. String fields are strictly size-bounded.

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Unauthenticated Read**: `auth = null`, `GET /users/user_a/attempts/att_1` -> `PERMISSION_DENIED`
2. **Cross-User Read (IDOR)**: `auth.uid = "user_b"`, `GET /users/user_a/attempts/att_1` -> `PERMISSION_DENIED`
3. **Cross-User Write**: `auth.uid = "user_b"`, `CREATE /users/user_a/attempts/att_1` -> `PERMISSION_DENIED`
4. **Unverified Email Write**: `auth.uid = "user_a", email_verified = false`, `CREATE /users/user_a/attempts/att_1` -> `PERMISSION_DENIED`
5. **Payload UID Spoofing**: `auth.uid = "user_a"`, `CREATE /users/user_a/attempts/att_1` with `{ uid: "user_b" }` -> `PERMISSION_DENIED`
6. **Shadow Field Injection**: `auth.uid = "user_a"`, `CREATE /users/user_a/profile/main` with `{ isAdmin: true }` -> `PERMISSION_DENIED`
7. **In-Place Overwrite of Subjective Answer Version**: `auth.uid = "user_a"`, `UPDATE /users/user_a/answer-versions/ver_1` -> `PERMISSION_DENIED`
8. **Client Read of Private Provider Key**: `auth.uid = "user_a"`, `GET /private-provider-credentials/user_a/providers/gemini` -> `PERMISSION_DENIED`
9. **Client Write of Private Provider Key**: `auth.uid = "user_a"`, `CREATE /private-provider-credentials/user_a/providers/gemini` -> `PERMISSION_DENIED`
10. **Oversized Content DoS**: `auth.uid = "user_a"`, `CREATE /users/user_a/answer-versions/ver_1` with `content.size() > 15000` -> `PERMISSION_DENIED`
11. **ID Poisoning Attack**: `auth.uid = "user_a"`, `CREATE /users/user_a/attempts/bad..id$%` -> `PERMISSION_DENIED`
12. **Immutable createdAt Tampering**: `auth.uid = "user_a"`, `UPDATE /users/user_a/attempts/att_1` modifying `createdAt` -> `PERMISSION_DENIED`
