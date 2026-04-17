import { API } from '../constants/API';
import api from './api';

export type LegalDocumentCurrent = {
  docType: string;
  version: string;
  required: boolean;
  effectiveAt?: string;
  contentHash?: string;
};

type LegalCurrentEnvelope = {
  documents?: unknown;
  legalDocuments?: unknown;
  requiredDocuments?: unknown;
  data?: unknown;
  message?: unknown;
};

function toDoc(raw: unknown): LegalDocumentCurrent | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const docType = String(r.docType ?? r.doc_type ?? '').trim();
  const version = String(r.version ?? '').trim();
  const required =
    r.required === true ||
    r.isRequired === true ||
    r.is_required === true ||
    String(r.required ?? '').trim().toLowerCase() === 'true';
  if (!docType || !version) return null;
  const effectiveAt = String(r.effectiveAt ?? r.effective_at ?? '').trim();
  const contentHash = String(r.contentHash ?? r.content_hash ?? '').trim();
  return {
    docType,
    version,
    required,
    ...(effectiveAt ? { effectiveAt } : {}),
    ...(contentHash ? { contentHash } : {}),
  };
}

function toArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    if (Array.isArray(o.documents)) return o.documents;
    if (Array.isArray(o.legalDocuments)) return o.legalDocuments;
    if (Array.isArray(o.requiredDocuments)) return o.requiredDocuments;
    if (Array.isArray(o.data)) return o.data;
  }
  return [];
}

export async function fetchCurrentLegalDocuments(): Promise<LegalDocumentCurrent[]> {
  const raw = await api.get<LegalCurrentEnvelope | unknown[]>(API.endpoints.legal.current);
  const arr = toArray(raw);
  return arr.map(toDoc).filter((x): x is LegalDocumentCurrent => Boolean(x));
}

export async function fetchRequiredTermsPrivacyVersion(): Promise<string | null> {
  const docs = await fetchCurrentLegalDocuments();
  const hit = docs.find((d) => d.docType === 'terms_privacy' && d.required);
  return hit?.version ?? null;
}

export async function acceptTermsPrivacyVersion(args: {
  version: string;
  appVersion?: string;
  platform?: string;
}): Promise<void> {
  const version = args.version.trim();
  if (!version) throw new Error('Missing legal version');
  const payload: Record<string, unknown> = {
    acceptances: [
      {
        docType: 'terms_privacy',
        version,
      },
    ],
  };
  if (args.appVersion?.trim()) payload.appVersion = args.appVersion.trim();
  if (args.platform?.trim()) payload.platform = args.platform.trim();

  try {
    await api.post(API.endpoints.legal.accept, payload);
  } catch (e: unknown) {
    const status =
      e && typeof e === 'object' && 'status' in e
        ? Number((e as { status?: unknown }).status)
        : NaN;
    if (status === 409) {
      // Idempotent outcome: already accepted server-side.
      return;
    }
    throw e;
  }
}

export function extractLegalAcceptanceRequiredVersion(error: unknown): string | null {
  const e = error as { status?: unknown; data?: unknown } | undefined;
  if (!e || Number(e.status) !== 403) return null;
  const data = e.data as Record<string, unknown> | undefined;
  if (!data) return null;
  const code = String(data.code ?? '').trim().toUpperCase();
  if (code !== 'LEGAL_ACCEPTANCE_REQUIRED') return null;

  const required = data.required as Record<string, unknown> | undefined;
  if (required) {
    const direct = String(required.terms_privacy ?? required.termsPrivacy ?? '').trim();
    if (direct) return direct;
  }

  const arr = toArray(data.requiredDocuments ?? data.documents ?? data.legalDocuments);
  for (const item of arr) {
    const doc = toDoc(item);
    if (doc && doc.docType === 'terms_privacy') return doc.version;
  }
  return null;
}
