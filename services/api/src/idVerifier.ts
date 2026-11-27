import { createHash } from 'node:crypto';

/**
 * Adapter for Jay's ID Check service (id-verifier).
 * Budbroz keeps only the result: never the raw barcode or ID images.
 */
export interface IdCheckResult {
  verdict: 'pass' | 'warn' | 'fail';
  /** True only when the issuing state confirmed the license (AAMVA DLDV, live mode). */
  stateConfirmed: boolean;
  dateOfBirth: string | null;
  expiryDate: string | null;
  issuingState: string | null;
  lastName: string | null;
  firstName: string | null;
  /** Salted SHA-256 of the license number, used to match the ID at the door. */
  documentHash: string | null;
}

export interface IdVerifier {
  /** Signup: scan plus optional state records check (requires the customer's consent). */
  verifyForSignup(barcode: string, consentToStateCheck: boolean): Promise<IdCheckResult>;
  /** Door: scan only, to compare against the pre-verified record. */
  verifyAtDoor(barcode: string): Promise<IdCheckResult>;
}

export function hashDocument(state: string | null, number: string | null, salt: string): string | null {
  if (!number) return null;
  return createHash('sha256').update(`${salt}:${state ?? ''}:${number.toUpperCase()}`).digest('hex');
}

interface IdCheckFields {
  issuer?: string;
  documentNumber?: string | null;
  dateOfBirth?: string | null;
  expiryDate?: string | null;
  lastName?: string | null;
  firstName?: string | null;
}

/** Calls a running ID Check server: POST /api/verify and POST /api/confirm-license. */
export class HttpIdVerifier implements IdVerifier {
  constructor(
    private baseUrl: string,
    private salt: string,
    private apiKey?: string,
  ) {}

  private async post(path: string, body: unknown): Promise<any> {
    const res = await fetch(new URL(path, this.baseUrl), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify(body),
    });
    if (!res.ok && res.status !== 422) throw new Error(`ID service returned ${res.status}`);
    return res.json();
  }

  private map(scan: { verdict: IdCheckResult['verdict']; fields?: IdCheckFields }, stateConfirmed: boolean): IdCheckResult {
    const f = scan.fields ?? {};
    return {
      verdict: scan.verdict,
      stateConfirmed,
      dateOfBirth: f.dateOfBirth ?? null,
      expiryDate: f.expiryDate ?? null,
      issuingState: f.issuer ?? null,
      lastName: f.lastName ?? null,
      firstName: f.firstName ?? null,
      documentHash: hashDocument(f.issuer ?? null, f.documentNumber ?? null, this.salt),
    };
  }

  async verifyAtDoor(barcode: string): Promise<IdCheckResult> {
    const scan = await this.post('/api/verify', { data: barcode, kind: 'aamva' });
    return this.map(scan, false);
  }

  async verifyForSignup(barcode: string, consentToStateCheck: boolean): Promise<IdCheckResult> {
    const scan = await this.post('/api/verify', { data: barcode, kind: 'aamva' });
    if (scan.verdict === 'fail' || !consentToStateCheck) return this.map(scan, false);
    const confirm = await this.post('/api/confirm-license', { data: barcode, consent: true });
    const verdict = confirm.verdict === 'fail' ? 'fail' : scan.verdict;
    return this.map({ ...scan, verdict }, Boolean(confirm.authenticated));
  }
}

/**
 * Development stand-in. Accepts a pipe-separated fake barcode:
 * "MOCK|<state>|<number>|<last>|<first>|<dob YYYY-MM-DD>|<expiry YYYY-MM-DD>".
 * Anything else fails.
 */
export class MockIdVerifier implements IdVerifier {
  constructor(private salt = 'dev-salt') {}

  private parse(barcode: string): IdCheckResult {
    const parts = barcode.split('|');
    if (parts.length !== 7 || parts[0] !== 'MOCK') {
      return {
        verdict: 'fail',
        stateConfirmed: false,
        dateOfBirth: null,
        expiryDate: null,
        issuingState: null,
        lastName: null,
        firstName: null,
        documentHash: null,
      };
    }
    const [, state, number, last, first, dob, expiry] = parts;
    return {
      verdict: 'pass',
      stateConfirmed: false,
      dateOfBirth: dob,
      expiryDate: expiry,
      issuingState: state,
      lastName: last,
      firstName: first,
      documentHash: hashDocument(state, number, this.salt),
    };
  }

  async verifyAtDoor(barcode: string) {
    return this.parse(barcode);
  }

  async verifyForSignup(barcode: string, consent: boolean) {
    const r = this.parse(barcode);
    return { ...r, stateConfirmed: r.verdict === 'pass' && consent };
  }
}

export function idVerifierFromEnv(env = process.env): IdVerifier {
  const salt = env.ID_HASH_SALT ?? 'dev-salt';
  if (env.ID_SERVICE_URL) return new HttpIdVerifier(env.ID_SERVICE_URL, salt, env.ID_SERVICE_API_KEY);
  return new MockIdVerifier(salt);
}
