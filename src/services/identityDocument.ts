/**
 * Identity document upload (Aadhaar / PAN / Driver License).
 *
 * Backend = single source of truth for the verified ✓ badge.
 * This client never marks a user as verified locally — it only ships
 * the document for manual admin review and trusts the next `/auth/me`
 * payload to surface `isIdentityVerified`.
 */
import { API } from '../constants/API';
import type { IdentityDocumentValue } from '../constants/validation';
import api from './api';

export type IdentityDocumentStatus = 'pending' | 'verified' | 'rejected';

export type UploadIdentityDocumentInput = {
  documentType: IdentityDocumentValue;
  documentNumber: string;
  /**
   * User-supplied document name, only sent when `documentType === 'other'`
   * (e.g., "Passport", "Voter ID"). Surfaced to the reviewing admin so they
   * know which document the photo and number refer to.
   */
  documentLabel?: string;
  localUri: string;
};

export type UploadIdentityDocumentResult = {
  status: IdentityDocumentStatus;
};

function detectMime(uri: string): { mime: string; ext: string } {
  const lower = uri.toLowerCase();
  if (lower.endsWith('.png')) return { mime: 'image/png', ext: 'png' };
  if (lower.endsWith('.webp')) return { mime: 'image/webp', ext: 'webp' };
  if (lower.endsWith('.heic') || lower.endsWith('.heif')) {
    return { mime: 'image/heic', ext: 'heic' };
  }
  return { mime: 'image/jpeg', ext: 'jpg' };
}

function pickStatus(raw: unknown): IdentityDocumentStatus {
  if (raw && typeof raw === 'object') {
    const r = raw as Record<string, unknown>;
    const candidates = [
      r.status,
      r.identityDocumentStatus,
      r.identity_document_status,
      r.identityVerificationStatus,
      r.identity_verification_status,
      (r.data as Record<string, unknown> | undefined)?.status,
    ];
    for (const c of candidates) {
      if (typeof c === 'string') {
        const v = c.trim().toLowerCase();
        if (v === 'pending' || v === 'verified' || v === 'rejected') return v;
      }
    }
  }
  return 'pending';
}

/**
 * Uploads the identity document. Resolves with the server status
 * (almost always `'pending'` — verification is manual on the backend).
 *
 * Throws if the upload itself fails (network/auth/server). Callers in
 * onboarding flows should treat failures as non-blocking and offer a retry
 * later from Profile rather than gate account creation on this call.
 */
export async function uploadIdentityDocument(
  input: UploadIdentityDocumentInput
): Promise<UploadIdentityDocumentResult> {
  const documentType = input.documentType;
  const documentNumber = input.documentNumber.trim();
  const localUri = input.localUri.trim();
  const documentLabel = (input.documentLabel ?? '').trim();
  if (!documentType || !documentNumber || !localUri) {
    throw new Error('Identity document is missing required fields.');
  }
  if (documentType === 'other' && !documentLabel) {
    throw new Error('Identity document name is required for "Other" documents.');
  }

  const { mime, ext } = detectMime(localUri);
  const filename = `${documentType}-${Date.now()}.${ext}`;

  const form = new FormData();
  form.append('documentType', documentType);
  form.append('documentNumber', documentNumber);
  if (documentType === 'other' && documentLabel) {
    form.append('documentLabel', documentLabel);
  }
  form.append('photo', { uri: localUri, name: filename, type: mime } as unknown as Blob);

  const res = await api.postForm<unknown>(API.endpoints.user.identityDocument, form, {
    timeout: 60000,
  });

  return { status: pickStatus(res) };
}
